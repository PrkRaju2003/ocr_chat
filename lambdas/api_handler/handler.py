"""
lambdas/api_handler/handler.py
──────────────────────────────
API Handler Lambda — updated for SQS-based async dispatch.

Architecture:
  POST /upload  → store image in S3 → enqueue job to SQS → ECS worker picks it up
  GET  /solve   → poll DynamoDB for job status / result
  GET  /health  → public health check (no Cognito auth required)

Cognito JWT is validated by API Gateway before this Lambda is invoked,
so we can trust the `authorizer.claims` context for user identity.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
import uuid
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3        = boto3.client("s3")
dynamodb  = boto3.resource("dynamodb")
sqs       = boto3.client("sqs")


INPUT_BUCKET   = os.environ["INPUT_BUCKET"]
RESULTS_BUCKET = os.environ["RESULTS_BUCKET"]
JOBS_TABLE     = os.environ["JOBS_TABLE"]
JOB_QUEUE_URL  = os.environ["JOB_QUEUE_URL"]
JOB_TTL_SECS   = 60 * 60 * 24   # 24 h


def _resp(code: int, body: dict) -> dict:
    return {
        "statusCode": code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin":  "*",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        },
        "body": json.dumps(body),
    }


def _get_user_id(event: dict) -> str | None:
    """Extract Cognito sub (user ID) from the JWT claims injected by API GW."""
    try:
        return event["requestContext"]["authorizer"]["claims"]["sub"]
    except (KeyError, TypeError):
        return None   # Public endpoint or demo mode


def handle_health(_event: dict) -> dict:
    return _resp(200, {"status": "healthy", "service": "ocr-chat-api-handler"})



def handle_upload(event: dict) -> dict:
    """
    1. Decode Base64 image from request body
    2. Store to S3 (input bucket, uploads/<job_id>.png)
    3. Create DynamoDB job record (status: PENDING)
    4. Enqueue job message to SQS → ECS worker picks it up asynchronously
    """
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(400, {"error": "Invalid JSON body."})

    image_b64 = body.get("image_b64")
    if not image_b64:
        return _resp(400, {"error": "Missing field: image_b64"})

    try:
        image_bytes = base64.b64decode(image_b64)
    except Exception:
        return _resp(400, {"error": "image_b64 is not valid Base64."})

    if len(image_bytes) < 1024:
        return _resp(400, {"error": "Image too small (min 1 KB)."})

    job_id   = str(uuid.uuid4())
    user_id  = _get_user_id(event) or "anonymous"
    s3_key   = f"uploads/{job_id}.png"

    # ── 1. Upload to S3 ───────────────────────────────────────────────────────
    try:
        s3.put_object(
            Bucket=INPUT_BUCKET,
            Key=s3_key,
            Body=image_bytes,
            ContentType="image/png",
            Metadata={"job_id": job_id, "user_id": user_id},
        )
        logger.info("Stored image → s3://%s/%s", INPUT_BUCKET, s3_key)
    except ClientError as exc:
        logger.error("S3 upload error: %s", exc)
        return _resp(500, {"error": "Failed to store image."})

    # ── 2. Create DynamoDB job record ─────────────────────────────────────────
    table = dynamodb.Table(JOBS_TABLE)
    ttl   = int(time.time()) + JOB_TTL_SECS
    try:
        table.put_item(Item={
            "job_id":       job_id,
            "user_id":      user_id,
            "status":       "PENDING",
            "s3_input_key": s3_key,
            "created_at":   int(time.time()),
            "ttl":          ttl,
        })
    except ClientError as exc:
        logger.error("DynamoDB put_item error: %s", exc)
        return _resp(500, {"error": "Failed to register job."})

    # ── 3. Enqueue to SQS → ECS worker consumes ───────────────────────────────
    message = {
        "job_id":       job_id,
        "s3_bucket":    INPUT_BUCKET,
        "s3_key":       s3_key,
        "user_id":      user_id,
        "submitted_at": int(time.time()),
    }
    try:
        sqs.send_message(
            QueueUrl=JOB_QUEUE_URL,
            MessageBody=json.dumps(message),
            MessageAttributes={
                "job_id": {"StringValue": job_id, "DataType": "String"},
            },
        )
        logger.info("Enqueued job %s to SQS", job_id)
    except ClientError as exc:
        logger.error("SQS send_message error: %s", exc)
        # Job is already in DynamoDB; ECS can be manually triggered if needed
        return _resp(500, {"error": "Failed to enqueue job. Please retry."})

    return _resp(201, {
        "job_id":   job_id,
        "status":   "PENDING",
        "message":  f"Job enqueued. Poll GET /solve?job_id={job_id} for results.",
        "user_id":  user_id,
    })



def handle_solve(event: dict) -> dict:
    """
    Poll DynamoDB for job status.
    Returns 202 while PENDING/PROCESSING, 200 when DONE, 500 on ERROR.
    """
    params = event.get("queryStringParameters") or {}
    job_id = params.get("job_id")
    if not job_id:
        return _resp(400, {"error": "Missing query param: job_id"})

    table = dynamodb.Table(JOBS_TABLE)
    try:
        result = table.get_item(Key={"job_id": job_id})
    except ClientError as exc:
        logger.error("DynamoDB get_item error: %s", exc)
        return _resp(500, {"error": "Failed to retrieve job."})

    item = result.get("Item")
    if not item:
        return _resp(404, {"error": f"No job found: {job_id}"})

    status = item.get("status", "UNKNOWN")

    if status == "DONE":
        return _resp(200, {
            "job_id":          job_id,
            "status":          "DONE",
            "latex":           item.get("latex_output", ""),
            "solution":        item.get("llm_solution", ""),
            "elapsed_seconds": item.get("elapsed_seconds"),
            "worker_az":       item.get("worker_az"),   # Which AZ the ECS task ran in
        })

    if status == "ERROR":
        return _resp(500, {
            "job_id":        job_id,
            "status":        "ERROR",
            "error_message": item.get("error_message", "Unknown error."),
        })

    return _resp(202, {
        "job_id":  job_id,
        "status":  status,
        "message": "Processing. Poll again in 3 seconds.",
    })



def lambda_handler(event: dict, context: Any) -> dict:
    method = event.get("httpMethod", "")
    path   = event.get("path", "")
    logger.info("%s %s  user=%s", method, path, _get_user_id(event))

    if method == "OPTIONS":
        return _resp(200, {})

    if method == "GET"  and path == "/health":
        return handle_health(event)
    if method == "POST" and path == "/upload":
        return handle_upload(event)
    if method == "GET"  and path == "/solve":
        return handle_solve(event)

    return _resp(404, {"error": f"Route not found: {method} {path}"})
