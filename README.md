# OCR Math Solver — AWS Serverless + Multi-AZ

> **Upload a photo of any math equation → Cognito auth → OCR on ECS Fargate → solve it step-by-step with Claude 3 on Amazon Bedrock**

A production-grade hybrid serverless + container AWS application. Converts handwritten or printed mathematical expressions into structured LaTeX, then uses Amazon Bedrock (Claude 3 Haiku) to provide detailed step-by-step solutions — secured with Cognito, distributed across multiple Availability Zones, and auto-scaled based on queue depth.

---

## 🏗️ AWS Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser  (Vanilla JS + KaTeX · Demo Mode & Live Mode)                  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ HTTPS + Bearer JWT
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Amazon Cognito                                                          │
│  User Pool · JWT Access Tokens · Email Verification · Refresh Tokens    │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Cognito Authorizer (JWT validation)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Amazon API Gateway  (REST)                                              │
│  POST /upload        GET /solve        GET /health (public)             │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Lambda Proxy
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Lambda: api_handler  (Python 3.11 · 256 MB · 30s timeout)              │
│  • Validates + stores image → S3 input bucket                           │
│  • Creates PENDING job record → DynamoDB                                │
│  • Enqueues message → SQS Job Queue                                     │
│  • Polls DynamoDB and returns LaTeX + solution to client                │
└──────┬──────────────────────────────────────────┬───────────────────────┘
       │ PutObject                                │ GetItem / UpdateItem
       ▼                                          ▼
┌─────────────────┐                       ┌────────────────────┐
│   Amazon S3     │                       │   DynamoDB         │
│   uploads/ ─── │── 7-day lifecycle ──►  │   ocr-chat-jobs    │
│   results/      │                       │   TTL: 24h         │
└─────────────────┘                       └────────────────────┘
       │
       │ SendMessage
       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Amazon SQS  (Standard Queue)                                            │
│  Long polling (20s) · maxReceiveCount: 3 → Dead Letter Queue            │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ CloudWatch Alarm (queue depth ≥ 1)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ApplicationAutoScaling  (SQS Depth → Step Scaling)                     │
│  queue ≥ 1 → +1 task  │  queue ≥ 5 → +2 tasks  │  queue ≥ 20 → +4     │
│  queue = 0 (3 checks) → scale in                Cooldown: 120s          │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ Scale ECS Service
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Application Load Balancer  (internet-facing · AZ-1 + AZ-2)             │
│  Health check: GET /health  →  ECS Target Group  →  30s deregistration  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ FARGATE_SPOT preferred (70% cheaper)
                             ▼
┌──────────────────────────────── VPC  10.0.0.0/16 ──────────────────────┐
│                                                                          │
│  Public Subnets          │  Private Subnets                             │
│  AZ-1: 10.0.0.0/24  ─── NAT Gateway ──► AZ-1: 10.0.10.0/24           │
│  AZ-2: 10.0.1.0/24            │         AZ-2: 10.0.11.0/24            │
│  (ALB lives here)             │         (ECS tasks live here)           │
│                               └──────────────────────┐                  │
│              ┌────────────────────────┐  ┌───────────────────────────┐ │
│              │  ECS Fargate  AZ-1     │  │  ECS Fargate  AZ-2        │ │
│              │  ocr-worker container  │  │  ocr-worker container     │ │
│              │  2 vCPU · 8 GB RAM     │  │  2 vCPU · 8 GB RAM        │ │
│              │  SQS polling loop      │  │  SQS polling loop         │ │
│              │  /health on port 8080  │  │  /health on port 8080     │ │
│              └───────────┬────────────┘  └────────────┬──────────────┘ │
└──────────────────────────┼──────────────────────────  ┼ ───────────────┘
                           │                             │
                           └──────────┬──────────────────┘
                                      │ InvokeModel
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Amazon Bedrock  —  Claude 3 Haiku                                       │
│  Solves extracted LaTeX step-by-step · ~$0.00025 / 1K input tokens      │
│  + Texify OCR model (Donut · im2latex-100K) baked into ECS image        │
└─────────────────────────────────────────────────────────────────────────┘
                                      │ Result
                                      ▼
                    DynamoDB job updated → status: DONE
                    S3 results/<job_id>.json written
                    Client polling /solve → 200 OK
```

---

## 🛠️ AWS Services

| Service | Purpose | Cost Note |
|---|---|---|
| **Amazon Cognito** | User Pool · JWT auth · email verification | Free up to 50K MAU |
| **Amazon API Gateway** | REST API — Cognito Authorizer + CORS | 1M req/mo free |
| **AWS Lambda** | Lightweight API handler (upload + poll) | Scales to zero |
| **Amazon SQS** | Job queue + Dead Letter Queue | 1M req/mo free |
| **Amazon ECS Fargate** | Long-running OCR worker — no Lambda timeouts | Fargate Spot: 70% off |
| **Application Load Balancer** | Multi-AZ · health checks · fast deregistration | ~$16/mo base |
| **ApplicationAutoScaling** | SQS depth → step-scale ECS tasks (0–5) | Free |
| **Amazon VPC** | Private subnets · single NAT GW · security groups | NAT: ~$32/mo |
| **Amazon S3** | Image input + JSON results · lifecycle rules | 5 GB free |
| **Amazon DynamoDB** | Job tracking · TTL · PAY_PER_REQUEST | 25 GB free |
| **Amazon Bedrock** | Claude 3 Haiku math solver | ~$0.001 per solve |
| **Amazon ECR** | Docker image registry for ECS container | 500 MB free |
| **AWS IAM** | Least-privilege roles per service | Free |
| **AWS SAM / CloudFormation** | Full Infrastructure as Code | Free |

---

## 🌟 Key Features

- **Cognito Auth**: Sign In / Sign Up with email — JWT validated at API Gateway before any Lambda runs
- **Multi-AZ**: ECS tasks deployed across 2 AZs in private subnets — survives a full AZ failure
- **Auto Scaling**: ECS service scales from **0 → 5 tasks** based on SQS queue depth; scales back to zero when idle
- **Fargate Spot**: 70% cheaper than on-demand; SIGTERM-aware worker handles spot interruptions gracefully
- **SQS Decoupling**: Upload is instant (just enqueues); worker picks up asynchronously — no timeouts
- **Dead Letter Queue**: Jobs that fail 3 times automatically move to DLQ for analysis
- **Single NAT Gateway**: Shared across both AZs — saves ~$32/month vs one per AZ
- **Canvas Selection**: Draw a bounding box to OCR a specific region of the image
- **Demo Mode**: Full pipeline simulation runs in-browser — no AWS account needed

---

## 🚀 Running the Demo (No AWS Account Required)

```bash
git clone https://github.com/PrkRaju2003/ocr_chat.git
cd ocr_chat
open frontend/index.html
```

1. **Demo Mode** toggle is ON by default — no login required
2. Upload any image of a math equation (or draw a bounding box region)
3. Click **Solve with AWS**
4. Watch the animated pipeline: **Cognito JWT → SQS enqueue → ECS Fargate (AZ-1 or AZ-2) → Bedrock Claude 3 → Done**
5. Results show which AZ processed the job — the architecture diagram highlights it

To test the **Cognito login flow**:
- Toggle Demo Mode **OFF**
- The Cognito modal appears — sign in or create an account (simulated in demo)

---

## ☁️ Deploying to AWS

### Prerequisites
```bash
# AWS CLI configured
brew install awscli && aws configure

# AWS SAM CLI
brew install aws-sam-cli

# Docker (for ECS worker image build)
# https://docs.docker.com/desktop/mac/

# Enable Bedrock: AWS Console → Bedrock → Model Access → Request Claude 3 Haiku
```

### One-Command Deploy
```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh dev     # dev environment
./scripts/deploy.sh prod    # production (enables ALB deletion protection)
```

The script:
1. Creates an ECR repository
2. Builds the ECS worker Docker image (model weights baked in, ~10 min)
3. Pushes image to ECR
4. Runs `sam build && sam deploy` (creates the full CloudFormation stack)
5. Prints API Gateway URL, ALB DNS, Cognito hosted UI URL

### After Deploy
1. Open `frontend/index.html`
2. Toggle **Demo Mode** OFF
3. Enter your API Gateway URL
4. Register with Cognito, upload, solve!

### Cognito Hosted UI (optional)
The SAM template provisions a Cognito domain automatically. You can use the hosted UI instead of the custom login by navigating to the `CognitoHostedUiUrl` stack output.

---

## 📁 Project Structure

```
ocr_chat/
├── infrastructure/
│   └── template.yaml           # AWS SAM — VPC, ALB, ECS, SQS, Cognito, Lambda, DynamoDB, S3
├── lambdas/
│   └── api_handler/
│       ├── handler.py          # POST /upload (→ S3 + SQS) · GET /solve (← DynamoDB)
│       └── requirements.txt
├── ecs_worker/
│   ├── worker.py               # SQS consumer · OCR · Bedrock · /health server
│   ├── Dockerfile              # Python 3.11-slim · model weights pre-baked
│   └── requirements.txt
├── frontend/
│   ├── index.html              # Dark-mode SPA with Cognito modal + arch diagram
│   ├── app.js                  # Auth flow · demo/live mode · AZ indicator
│   └── style.css               # Glassmorphism · VPC box · AZ badges
├── scripts/
│   └── deploy.sh               # One-command ECR + SAM deploy
├── ocr_app.py                  # (Original) Streamlit prototype
└── ocr_image.py                # (Original) CLI OCR tool
```

---

## 💰 Cost Estimate

### Resume / Demo Traffic (< 100 solves/month)

| Service | Free Tier | Estimated Cost |
|---|---|---|
| Lambda | 1M req/mo | ~$0 |
| API Gateway | 1M req/mo | ~$0 |
| Cognito | 50K MAU | ~$0 |
| SQS | 1M req/mo | ~$0 |
| S3 | 5 GB / 20K req | ~$0 |
| DynamoDB | 25 GB + 25 WCU/RCU | ~$0 |
| ECR | 500 MB/mo | ~$0 |
| ECS Fargate (Spot) | Pay per use | ~$0.05 (idle = $0) |
| **ALB** | — | **~$16/mo** ← main cost |
| **NAT Gateway** | — | **~$32/mo** |
| Bedrock (Haiku) | Pay per token | ~$0.001/solve |

> **💡 Cost tip for resume/demo:** Stop the ECS service when not in use (`ecs update-service --desired-count 0`) and delete the NAT Gateway. ECS scales to zero automatically; the NAT GW is the biggest fixed cost.

**Typical 1-month resume demo: ~$48 (ALB + NAT GW) + $0.10 (Bedrock) = ~$48.10**

---

## 🏛️ Architecture Decisions

| Decision | Reason |
|---|---|
| **Lambda for API, ECS for OCR** | Lambda has a 15-min max timeout and 10 GB RAM limit. Texify model needs 8 GB and OCR can take minutes. ECS Fargate has no timeout, any memory size. |
| **SQS between Lambda and ECS** | Decouples upload speed from processing speed. Client gets instant job ID; ECS picks up at its own pace. DLQ handles failures automatically. |
| **ALB over API Gateway for ECS** | ALB is more cost-effective at sustained traffic; supports health checks needed by ECS; handles WebSocket if needed later. |
| **Single NAT Gateway** | One NAT GW in AZ-1 serves both private subnets. Saves ~$32/mo vs one per AZ. Trade-off: outbound traffic fails if AZ-1 goes down. Acceptable for portfolio/dev. |
| **Fargate Spot** | OCR is batch-style, not latency-sensitive. Spot interruptions are handled via SIGTERM → graceful drain → SQS message becomes visible again automatically. |
| **Cognito over custom auth** | Zero infrastructure for auth, handles JWT rotation, refresh tokens, MFA-ready, and integrates directly with API Gateway — no code needed for token validation. |
| **Bedrock over OpenAI** | All credentials stay in AWS IAM. Claude 3 Haiku has strong LaTeX reasoning at the lowest per-token cost on Bedrock. |

---

*Built by [PrkRaju2003](https://github.com/PrkRaju2003) · AWS SAM · ECS Fargate · Cognito · ALB · Auto Scaling · Bedrock · OCR*
