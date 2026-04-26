"""
lambdas/ocr_worker/handler.py
─────────────────────────────
AWS Lambda OCR Worker — triggered by S3 ObjectCreated events.

Pipeline:
  1. Download image from S3 (input bucket)
  2. Run Math OCR using the Texify model (Donut architecture, baked into Docker image)
  3. Call Amazon Bedrock (Claude 3 Haiku) to solve the extracted LaTeX equation
  4. Write JSON result to S3 (results bucket)
  5. Update DynamoDB job record → DONE

Environment variables (set by SAM template):
  INPUT_BUCKET   — S3 bucket for uploaded images
  RESULTS_BUCKET — S3 bucket for JSON results
  JOBS_TABLE     — DynamoDB table name
  BEDROCK_MODEL  — Bedrock model ID (default: claude-3-haiku)
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
from typing import Any

import boto3
from PIL import Image
from botocore.exceptions import ClientError

from texify.inference import batch_inference
from texify.model.model import load_model
from texify.model.processor import load_processor

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))

INPUT_BUCKET = os.environ["INPUT_BUCKET"]
RESULTS_BUCKET = os.environ["RESULTS_BUCKET"]
JOBS_TABLE = os.environ["JOBS_TABLE"]
BEDROCK_MODEL = os.environ.get("BEDROCK_MODEL", "anthropic.claude-3-haiku-20240307-v1:0")

logger.info("Loading OCR model (cold start)...")
_model = load_model()
_processor = load_processor()
logger.info("OCR model ready.")


def run_ocr(image: Image.Image) -> str:
    """
    Run the Texify math OCR model on a PIL image.
    Returns the extracted LaTeX string.
    """
    outputs = batch_inference([image], _model, _processor, temperature=0.0)
    latex = outputs[0].strip()
    logger.info("OCR output (%d chars): %s...", len(latex), latex[:80])
    return latex


MATH_SOLVER_SYSTEM_PROMPT = """You are MathSolverAI, an expert mathematics tutor with deep knowledge of LaTeX.
When given a LaTeX mathematical expression or equation, you:
1. Parse and interpret the expression correctly
2. Solve it step-by-step, showing all intermediate work
3. Provide the final answer in clear notation
4. Format your response in Markdown with LaTeX (using $...$ for inline and $$...$$ for display math)
Always be precise and educational."""

MATH_SOLVER_USER_TEMPLATE = """Please solve the following mathematical expression extracted via OCR from an image:

LaTeX: `{latex}`

Provide a clear, step-by-step solution."""


def call_bedrock(latex: str) -> str:
    """
    Call Amazon Bedrock (Claude 3 Haiku) with the extracted LaTeX.
    Returns the LLM's step-by-step solution as a Markdown string.
    """
    prompt = MATH_SOLVER_USER_TEMPLATE.format(latex=latex)

    payload = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "system": MATH_SOLVER_SYSTEM_PROMPT,
        "messages": [
            {"role": "user", "content": prompt}
        ],
    }

    try:
        response = bedrock.invoke_model(
            modelId=BEDROCK_MODEL,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(payload),
        )
        body = json.loads(response["body"].read())
        solution = body["content"][0]["text"]
        logger.info("Bedrock returned %d chars", len(solution))
        return solution
    except ClientError as exc:
        error_code = exc.response["Error"]["Code"]
        logger.error("Bedrock invocation failed (%s): %s", error_code, exc)
        raise


def _update_job_status(job_id: str, status: str, **extra_fields):
    """Update a job record in DynamoDB with new status and optional fields."""
    table = dynamodb.Table(JOBS_TABLE)

    update_expr = "SET #s = :status"
    expr_names = {"#s": "status"}
    expr_values = {":status": status}

    for key, val in extra_fields.items():
        placeholder = f":{key}"
        update_expr += f", {key} = {placeholder}"
        expr_values[placeholder] = val

    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )


def lambda_handler(event: dict, context: Any) -> dict:
    """
    Entry point for S3-triggered Lambda events.
    Each S3 upload (under uploads/*.png) triggers this function.
    """
    for record in event.get("Records", []):
        s3_event = record.get("s3", {})
        bucket = s3_event["bucket"]["name"]
        key = s3_event["object"]["key"]

        # Extract job_id from the S3 key (uploads/<job_id>.png)
        job_id = key.split("/")[-1].replace(".png", "")
        logger.info("Processing job %s from s3://%s/%s", job_id, bucket, key)

        start_time = time.time()

        # Mark as PROCESSING
        _update_job_status(job_id, "PROCESSING")

        try:
            # ── Step 1: Download image from S3 ────────────────────────────────
            obj = s3.get_object(Bucket=bucket, Key=key)
            image_bytes = obj["Body"].read()
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            logger.info("Downloaded image: %dx%d px", image.width, image.height)

            # ── Step 2: OCR ───────────────────────────────────────────────────
            latex_output = run_ocr(image)

            # ── Step 3: Call Bedrock ──────────────────────────────────────────
            llm_solution = call_bedrock(latex_output)

            elapsed = round(time.time() - start_time, 2)

            # ── Step 4: Save result to S3 ─────────────────────────────────────
            result_payload = {
                "job_id": job_id,
                "latex_output": latex_output,
                "llm_solution": llm_solution,
                "elapsed_seconds": elapsed,
            }
            result_key = f"results/{job_id}.json"
            s3.put_object(
                Bucket=RESULTS_BUCKET,
                Key=result_key,
                Body=json.dumps(result_payload, indent=2),
                ContentType="application/json",
            )

            # ── Step 5: Mark DONE in DynamoDB ─────────────────────────────────
            _update_job_status(
                job_id,
                "DONE",
                latex_output=latex_output,
                llm_solution=llm_solution,
                elapsed_seconds=str(elapsed),
                result_s3_key=result_key,
                completed_at=str(int(time.time())),
            )

            logger.info("Job %s completed in %.2fs", job_id, elapsed)

        except Exception as exc:
            logger.exception("Worker failed for job %s: %s", job_id, exc)
            _update_job_status(
                job_id,
                "ERROR",
                error_message=str(exc),
            )
            # Re-raise so Lambda marks invocation as failed (enables DLQ)
            raise

    return {"statusCode": 200, "body": "OK"}
