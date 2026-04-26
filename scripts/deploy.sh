#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/deploy.sh — One-command deploy for OCR Math Solver on AWS
#
# Prerequisites:
#   - AWS CLI configured: aws configure
#   - AWS SAM CLI: brew install aws-sam-cli
#   - Docker (running): for building the OCR worker container image
#
# Usage:
#   ./scripts/deploy.sh [dev|staging|prod]
#
# What it does:
#   1. Creates an ECR repository (if not exists)
#   2. Builds the OCR worker Docker image (includes model download)
#   3. Pushes the image to ECR
#   4. Runs sam build + sam deploy (CloudFormation stack)
#   5. Outputs the live API Gateway URL
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENVIRONMENT="${1:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="ocr-chat-${ENVIRONMENT}"
ECR_REPO_NAME="ocr-chat-ocr-worker"
SAM_S3_BUCKET="ocr-chat-sam-artifacts-${ENVIRONMENT}"

# Colours
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }

echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│  OCR Math Solver — AWS Deployment           │${NC}"
echo -e "${GREEN}│  Environment : ${ENVIRONMENT}                         │${NC}"
echo -e "${GREEN}│  Region      : ${AWS_REGION}                  │${NC}"
echo -e "${GREEN}└─────────────────────────────────────────────┘${NC}"
echo ""

# ── Step 0: Verify dependencies ───────────────────────────────────────────────
info "Checking required tools…"
for cmd in aws sam docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "❌ $cmd is not installed. Aborting."; exit 1; }
done
success "aws, sam, docker all found."

# ── Step 1: Get AWS account ID ────────────────────────────────────────────────
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}"
info "AWS Account: ${AWS_ACCOUNT_ID}"

# ── Step 2: Create ECR repo (idempotent) ──────────────────────────────────────
info "Ensuring ECR repository exists: ${ECR_REPO_NAME}"
aws ecr describe-repositories --repository-names "${ECR_REPO_NAME}" \
    --region "${AWS_REGION}" >/dev/null 2>&1 \
  || aws ecr create-repository \
       --repository-name "${ECR_REPO_NAME}" \
       --region "${AWS_REGION}" \
       --image-scanning-configuration scanOnPush=true \
       --output table
success "ECR repository ready."

# ── Step 3: Build Docker image ────────────────────────────────────────────────
info "Building OCR worker Docker image (this may take ~10min — model is baked in)…"
docker build \
  --platform linux/amd64 \
  -t "${ECR_REPO_NAME}:latest" \
  -f lambdas/ocr_worker/Dockerfile \
  lambdas/ocr_worker/
success "Docker image built."

# ── Step 4: Push to ECR ───────────────────────────────────────────────────────
info "Authenticating Docker to ECR…"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

info "Tagging and pushing image to ECR…"
docker tag "${ECR_REPO_NAME}:latest" "${ECR_URI}:latest"
docker push "${ECR_URI}:latest"
success "Image pushed: ${ECR_URI}:latest"

# ── Step 5: Create SAM artifacts S3 bucket (idempotent) ──────────────────────
info "Ensuring SAM artifacts bucket: ${SAM_S3_BUCKET}"
aws s3api head-bucket --bucket "${SAM_S3_BUCKET}" 2>/dev/null \
  || aws s3 mb "s3://${SAM_S3_BUCKET}" --region "${AWS_REGION}"
success "SAM bucket ready."

# ── Step 6: SAM build ─────────────────────────────────────────────────────────
info "Running sam build…"
sam build \
  --template infrastructure/template.yaml \
  --use-container
success "SAM build complete."

# ── Step 7: SAM deploy ────────────────────────────────────────────────────────
info "Deploying CloudFormation stack: ${STACK_NAME}"
sam deploy \
  --stack-name "${STACK_NAME}" \
  --s3-bucket "${SAM_S3_BUCKET}" \
  --region "${AWS_REGION}" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --parameter-overrides Environment="${ENVIRONMENT}" \
  --no-fail-on-empty-changeset

# ── Step 8: Print outputs ─────────────────────────────────────────────────────
echo ""
success "Deployment complete! Stack outputs:"
echo ""
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs" \
  --output table

API_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text)

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🚀 API Gateway URL:${NC}"
echo -e "     ${BLUE}${API_URL}${NC}"
echo -e ""
echo -e "${GREEN}  Open frontend/index.html, toggle off Demo Mode,${NC}"
echo -e "${GREEN}  and paste the URL above to use live AWS.${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
