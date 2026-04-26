from __future__ import annotations

import io
import json
import logging
import os
import signal
import socket
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import NoReturn

import boto3
from PIL import Image
from botocore.exceptions import ClientError

from ocr_text.inference import batch_inference
from ocr_text.model.model import load_model
from ocr_text.model.processor import load_processor
from ocr_text.output import replace_katex_invalid


logging.basicConfig(level=logging.INFO,format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",)
logger = logging.getLogger("ocr_worker")

s3       = boto3.client("s3")
dynamodb = boto3.resource("dynamodb")
sqs      = boto3.client("sqs")
bedrock  = boto3.client("bedrock-runtime",region_name=os.environ.get("AWS_REGION", "us-east-1"))

INPUT_BUCKET   = os.environ["INPUT_BUCKET"]
RESULTS_BUCKET = os.environ["RESULTS_BUCKET"]
JOBS_TABLE     = os.environ["JOBS_TABLE"]
JOB_QUEUE_URL  = os.environ["JOB_QUEUE_URL"]
BEDROCK_MODEL  = os.environ.get("BEDROCK_MODEL",
                                "anthropic.claude-3-haiku-20240307-v1:0")
WORKER_PORT    = int(os.environ.get("PORT", "8080"))


_METADATA_URL = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", "")


def _get_task_az() -> str:
    try:
        with urllib.request.urlopen(f"{_METADATA_URL}/task", timeout=2) as resp:
            data = json.loads(resp.read())
            return data.get("AvailabilityZone", "unknown")
    except Exception:
        return socket.gethostname()  


WORKER_AZ = _get_task_az()
logger.info("ECS worker starting in AZ: %s", WORKER_AZ)

logger.info("Loading OCR model…")
_model     = load_model()
_processor = load_processor()
logger.info("OCR model ready.")

_SYSTEM = """You are MathSolverAI, an expert mathematics tutor.
When given a LaTeX expression, solve it step-by-step, showing all work.
Format your response in Markdown with LaTeX ($...$ for inline, $$...$$ for display math)."""

_USER_TMPL = "Solve step-by-step:\n\nLaTeX: `{latex}`"



class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            body = json.dumps({
                "status": "healthy",
                "az":     WORKER_AZ,
                "model":  "texify-loaded",
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", len(body))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):  
        if "/health" not in args[0]:
            logger.debug(fmt, *args)


def _start_health_server():
    server = HTTPServer(("0.0.0.0", WORKER_PORT), HealthHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    logger.info("Health server listening on port %d", WORKER_PORT)


def _update_job(job_id: str, status: str, **fields):
    table = dynamodb.Table(JOBS_TABLE)
    set_parts = ["#s = :status", "worker_az = :az"]
    names     = {"#s": "status"}
    values    = {":status": status, ":az": WORKER_AZ}
    for k, v in fields.items():
        set_parts.append(f"{k} = :{k}")
        values[f":{k}"] = v
    table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )



def run_ocr(image: Image.Image) -> str:
    outputs = batch_inference([image], _model, _processor, temperature=0.0)
    latex = replace_katex_invalid(outputs[0].strip())
    logger.info("OCR → %d chars | preview: %s…", len(latex), latex[:60])
    return latex


def call_bedrock(latex: str) -> str:
    payload = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "system":  _SYSTEM,
        "messages": [{"role": "user", "content": _USER_TMPL.format(latex=latex)}],
    }
    resp = bedrock.invoke_model(
        modelId=BEDROCK_MODEL,
        contentType="application/json",
        accept="application/json",
        body=json.dumps(payload),
    )
    body = json.loads(resp["body"].read())
    return body["content"][0]["text"]


def process_job(msg: dict) -> None:
    body    = json.loads(msg["Body"])
    job_id  = body["job_id"]
    s3_key  = body["s3_key"]
    receipt = msg["ReceiptHandle"]

    logger.info("Processing job %s from s3://%s/%s  (AZ: %s)",
                job_id, INPUT_BUCKET, s3_key, WORKER_AZ)
    start = time.time()
    _update_job(job_id, "PROCESSING")

    try:
        obj    = s3.get_object(Bucket=INPUT_BUCKET, Key=s3_key)
        image  = Image.open(io.BytesIO(obj["Body"].read())).convert("RGB")
        logger.info("Image: %dx%d px", image.width, image.height)

        latex  = run_ocr(image)

        solution = call_bedrock(latex)

        elapsed  = round(time.time() - start, 2)

        result_key = f"results/{job_id}.json"
        s3.put_object(
            Bucket=RESULTS_BUCKET,
            Key=result_key,
            Body=json.dumps({"job_id": job_id, "latex_output": latex,
                             "llm_solution": solution, "elapsed": elapsed,
                             "worker_az": WORKER_AZ}, indent=2),
            ContentType="application/json",
        )

        _update_job(job_id, "DONE",
                    latex_output=latex,
                    llm_solution=solution,
                    elapsed_seconds=str(elapsed),
                    result_s3_key=result_key,
                    completed_at=str(int(time.time())))

        sqs.delete_message(QueueUrl=JOB_QUEUE_URL, ReceiptHandle=receipt)
        logger.info("Job %s done in %.2fs", job_id, elapsed)

    except Exception as exc:
        logger.exception("Job %s failed: %s", job_id, exc)
        _update_job(job_id, "ERROR", error_message=str(exc))
        # Do NOT delete the SQS message — it will retry up to maxReceiveCount,
        # then move to the Dead Letter Queue automatically.



_running = True

def _handle_sigterm(*_):
    global _running
    logger.info("SIGTERM received — draining current job then stopping.")
    _running = False

signal.signal(signal.SIGTERM, _handle_sigterm)
signal.signal(signal.SIGINT,  _handle_sigterm)


def run_worker() -> NoReturn:
    _start_health_server()
    logger.info("Worker polling SQS: %s", JOB_QUEUE_URL)

    while _running:
        try:
            resp = sqs.receive_message(
                QueueUrl=JOB_QUEUE_URL,
                MaxNumberOfMessages=1,
                WaitTimeSeconds=20,      
                VisibilityTimeout=360,        
                MessageAttributeNames=["All"],
            )
        except ClientError as exc:
            logger.error("SQS receive error: %s — retrying in 5s", exc)
            time.sleep(5)
            continue

        messages = resp.get("Messages", [])
        if not messages:
            logger.debug("Queue empty — waiting for next message")
            continue

        process_job(messages[0])

    logger.info("Worker exiting cleanly.")


if __name__ == "__main__":
    run_worker()
