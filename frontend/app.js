
"use strict";

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 40;


// Demo OCR results pool — realistic math scenarios
const DEMO_SCENARIOS = [
  {
    latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
    solution: `## Quadratic Formula

This is the **quadratic formula**, used to solve any equation of the form $ax^2 + bx + c = 0$.

### Derivation by Completing the Square

Starting from:
$$ax^2 + bx + c = 0$$

**Step 1:** Divide through by $a$:
$$x^2 + \\frac{b}{a}x + \\frac{c}{a} = 0$$

**Step 2:** Move the constant term:
$$x^2 + \\frac{b}{a}x = -\\frac{c}{a}$$

**Step 3:** Complete the square by adding $\\left(\\frac{b}{2a}\\right)^2$ to both sides:
$$\\left(x + \\frac{b}{2a}\\right)^2 = \\frac{b^2 - 4ac}{4a^2}$$

**Step 4:** Take the square root and solve for $x$:
$$\\boxed{x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}}$$

The term $\\Delta = b^2 - 4ac$ is called the **discriminant**.
- $\\Delta > 0$: two distinct real roots
- $\\Delta = 0$: one repeated real root
- $\\Delta < 0$: two complex conjugate roots`,
  },
  {
    latex: "\\int_0^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
    solution: `## Gaussian Integral

This is the famous **Gaussian integral**, a cornerstone of probability and physics.

### Proof via Polar Coordinates

Let $I = \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx$. Then:

**Step 1:** Consider $I^2$:
$$I^2 = \\left(\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx\\right)\\left(\\int_{-\\infty}^{\\infty} e^{-y^2}\\,dy\\right) = \\iint_{\\mathbb{R}^2} e^{-(x^2+y^2)}\\,dx\\,dy$$

**Step 2:** Convert to polar coordinates $(r, \\theta)$:
$$I^2 = \\int_0^{2\\pi}\\int_0^{\\infty} e^{-r^2} r\\,dr\\,d\\theta = 2\\pi \\cdot \\frac{1}{2} = \\pi$$

**Step 3:** Therefore $I = \\sqrt{\\pi}$, and by symmetry:
$$\\boxed{\\int_0^{\\infty} e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}}$$`,
  },
  {
    latex: "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
    solution: `## Basel Problem

The sum $\\displaystyle\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$ is known as the **Basel problem**, first solved by Euler in 1734.

### Euler's Elegant Proof

**Step 1:** Start with the Taylor series for $\\sin x$:
$$\\sin x = x - \\frac{x^3}{3!} + \\frac{x^5}{5!} - \\cdots$$

**Step 2:** Divide by $x$:
$$\\frac{\\sin x}{x} = 1 - \\frac{x^2}{6} + \\frac{x^4}{120} - \\cdots$$

**Step 3:** The roots of $\\frac{\\sin x}{x} = 0$ are $x = \\pm\\pi, \\pm 2\\pi, \\cdots$, so factor as infinite product:
$$\\frac{\\sin x}{x} = \\prod_{n=1}^{\\infty}\\left(1 - \\frac{x^2}{n^2\\pi^2}\\right)$$

**Step 4:** Compare the coefficient of $x^2$:
$$-\\frac{1}{6} = -\\sum_{n=1}^{\\infty} \\frac{1}{n^2\\pi^2}$$

**Therefore:**
$$\\boxed{\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6} \\approx 1.6449}$$`,
  },
  {
    latex: "e^{i\\pi} + 1 = 0",
    solution: `## Euler's Identity

Often called "the most beautiful equation in mathematics", $e^{i\\pi} + 1 = 0$ connects the five most fundamental constants.

### Derivation via Euler's Formula

**Step 1:** Euler's formula states:
$$e^{i\\theta} = \\cos\\theta + i\\sin\\theta$$

This follows from the Taylor series of $e^x$, $\\cos x$, and $\\sin x$.

**Step 2:** Substitute $\\theta = \\pi$:
$$e^{i\\pi} = \\cos\\pi + i\\sin\\pi = -1 + i(0) = -1$$

**Step 3:** Add 1 to both sides:
$$\\boxed{e^{i\\pi} + 1 = 0}$$

### The Five Constants
| Symbol | Meaning |
|--------|---------|
| $e \\approx 2.718$ | Base of natural logarithm |
| $i = \\sqrt{-1}$ | Imaginary unit |
| $\\pi \\approx 3.14159$ | Circle constant |
| $1$ | Multiplicative identity |
| $0$ | Additive identity |`,
  },
];


let state = {
  isDemoMode: true,
  apiUrl: "",
  uploadedFile: null,
  imageUrl: null,
  selection: null,
  isDrawing: false,
  drawStart: null,
  currentJobId: null,
  pollCount: 0,
  pollTimer: null,
  isAuthenticated: false,
  userEmail: null,
  accessToken: null,
};



const $ = id => document.getElementById(id);

const bgCanvas        = $("bg-canvas");
const demoSwitch      = $("demo-mode-switch");
const apiStatusBadge  = $("api-status-badge");
const dropZone        = $("drop-zone");
const fileInput       = $("file-input");
const previewWrap     = $("preview-wrap");
const previewCanvas   = $("preview-canvas");
const selCanvas       = $("selection-canvas");
const solveBtn        = $("solve-btn");
const clearBtn        = $("clear-btn");
const configRow       = $("config-row");
const apiUrlInput     = $("api-url-input");

const resultIdle       = $("result-idle");
const resultProcessing = $("result-processing");
const resultDone       = $("result-done");
const resultError      = $("result-error");

const pipelineSteps    = $("pipeline-steps");
const progressBar      = $("progress-bar");
const processingEta    = $("processing-eta");

const jobIdBadge   = $("job-id-badge");
const jobIdText    = $("job-id-text");
const latexDisplay = $("latex-rendered");
const latexRaw     = $("latex-raw");
const solutionDiv  = $("solution-content");
const elapsedEl    = $("elapsed-time");
const errMsgEl     = $("error-message");

const tabBtns   = document.querySelectorAll(".result-tab");
const tabPanels = document.querySelectorAll(".tab-panel");


const authModal    = $("auth-modal");
const signinForm   = $("signin-form");
const signupForm   = $("signup-form");
const signinError  = $("signin-error");
const signupError  = $("signup-error");

function syncAuthModal() {
  if (state.isDemoMode || state.isAuthenticated) {
    authModal.classList.add("hidden");
  } else {
    authModal.classList.remove("hidden");
  }
}

document.querySelectorAll(".auth-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const form = btn.dataset.form;
    signinForm.classList.toggle("hidden",  form !== "signin");
    signupForm.classList.toggle("hidden",  form !== "signup");
  });
});

signinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = $("signin-email").value.trim();
  const password = $("signin-password").value;
  signinError.classList.add("hidden");
  $("signin-btn").disabled = true;
  $("signin-btn").textContent = "Signing in…";

  try {

    await sleep(900);
    if (!email || !password) throw new Error("Please fill in all fields.");
    if (password.length < 8)  throw new Error("Password must be at least 8 characters.");


    state.isAuthenticated = true;
    state.userEmail = email;
    state.accessToken = `eyJhbGciOiJSUzI1NiJ9.demo.${btoa(email)}`; 
    showUserIndicator(email);
    syncAuthModal();
  } catch (err) {
    signinError.textContent = err.message;
    signinError.classList.remove("hidden");
  } finally {
    $("signin-btn").disabled = false;
    $("signin-btn").textContent = "Sign In";
  }
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = $("signup-email").value.trim();
  const password = $("signup-password").value;
  signupError.classList.add("hidden");
  $("signup-btn").disabled = true;
  $("signup-btn").textContent = "Creating account…";

  try {
    await sleep(1100);
    if (!email)              throw new Error("Please enter your email.");
    if (password.length < 8) throw new Error("Password must be at least 8 characters.");
    if (!/[A-Z]/.test(password)) throw new Error("Password must contain at least one uppercase letter.");
    if (!/[0-9]/.test(password)) throw new Error("Password must contain at least one number.");

    state.isAuthenticated = true;
    state.userEmail = email;
    state.accessToken = `eyJhbGciOiJSUzI1NiJ9.demo.${btoa(email)}`;
    showUserIndicator(email);
    syncAuthModal();
  } catch (err) {
    signupError.textContent = err.message;
    signupError.classList.remove("hidden");
  } finally {
    $("signup-btn").disabled = false;
    $("signup-btn").textContent = "Create Account";
  }
});

function showUserIndicator(email) {
  const initial = email[0].toUpperCase();
  const wrap = document.querySelector(".demo-toggle-wrap");
  if (!wrap) return;
  if (!$("user-indicator")) {
    const ui = document.createElement("div");
    ui.id = "user-indicator";
    ui.className = "user-indicator";
    ui.innerHTML = `
      <div class="user-avatar">${initial}</div>
      <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${email}</span>
      <button class="signout-btn" id="signout-btn">Sign out</button>`;
    wrap.parentElement.insertBefore(ui, wrap);
    $("signout-btn").addEventListener("click", () => {
      state.isAuthenticated = false;
      state.userEmail = null;
      state.accessToken = null;
      ui.remove();
      if (!state.isDemoMode) syncAuthModal();
    });
  }
}

window.addEventListener("DOMContentLoaded", syncAuthModal);


(function initParticles() {
  const ctx = bgCanvas.getContext("2d");
  let W, H, particles;

  const COLORS = ["99,102,241", "139,92,246", "6,182,212", "16,185,129"];

  function resize() {
    W = bgCanvas.width  = window.innerWidth;
    H = bgCanvas.height = window.innerHeight;
  }

  function createParticles(n = 60) {
    return Array.from({length: n}, () => ({
      x:    Math.random() * W,
      y:    Math.random() * H,
      r:    Math.random() * 2.5 + 0.5,
      vx:   (Math.random() - 0.5) * 0.3,
      vy:   (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * 0.4 + 0.1,
    }));
  }

  resize();
  particles = createParticles();
  window.addEventListener("resize", () => { resize(); particles = createParticles(); });

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

demoSwitch.addEventListener("change", () => {
  state.isDemoMode = demoSwitch.checked;
  if (state.isDemoMode) {
    apiStatusBadge.textContent = "Demo Mode";
    apiStatusBadge.className = "status-badge status-demo";
    configRow.classList.add("hidden");
    authModal.classList.add("hidden");  
  } else {
    apiStatusBadge.textContent = "Live — AWS";
    apiStatusBadge.className = "status-badge status-live";
    configRow.classList.remove("hidden");
    syncAuthModal();                     
  }
});


dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

function loadFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file (PNG, JPG, JPEG, GIF, WebP).");
    return;
  }
  state.uploadedFile = file;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = URL.createObjectURL(file);
  state.selection = null;

  const img = new Image();
  img.onload = () => {
    const maxW = previewWrap.clientWidth || 500;
    const scale = Math.min(1, maxW / img.width);
    const dw = img.width  * scale;
    const dh = img.height * scale;

    previewCanvas.width  = dw;
    previewCanvas.height = dh;
    selCanvas.width      = dw;
    selCanvas.height     = dh;

    previewCanvas.getContext("2d").drawImage(img, 0, 0, dw, dh);
    clearSelCanvas();

    dropZone.classList.add("hidden");
    previewWrap.classList.remove("hidden");
    solveBtn.classList.remove("hidden");
  };
  img.src = state.imageUrl;
}

function clearSelCanvas() {
  selCanvas.getContext("2d").clearRect(0, 0, selCanvas.width, selCanvas.height);
}

function getCanvasPos(e) {
  const rect = selCanvas.getBoundingClientRect();
  const scaleX = selCanvas.width  / rect.width;
  const scaleY = selCanvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

selCanvas.addEventListener("mousedown",  e => { state.isDrawing = true;  state.drawStart = getCanvasPos(e); });
selCanvas.addEventListener("touchstart", e => { state.isDrawing = true;  state.drawStart = getCanvasPos(e); e.preventDefault(); }, {passive:false});

selCanvas.addEventListener("mousemove",  e => { if (state.isDrawing) drawRect(getCanvasPos(e)); });
selCanvas.addEventListener("touchmove",  e => { if (state.isDrawing) drawRect(getCanvasPos(e)); e.preventDefault(); }, {passive:false});

selCanvas.addEventListener("mouseup",    e => finishRect(getCanvasPos(e)));
selCanvas.addEventListener("touchend",   e => finishRect(getCanvasPos(e.changedTouches[0])));

function drawRect(pos) {
  const ctx = selCanvas.getContext("2d");
  ctx.clearRect(0, 0, selCanvas.width, selCanvas.height);
  const x = Math.min(state.drawStart.x, pos.x);
  const y = Math.min(state.drawStart.y, pos.y);
  const w = Math.abs(pos.x - state.drawStart.x);
  const h = Math.abs(pos.y - state.drawStart.y);
  ctx.strokeStyle = "#6366f1";
  ctx.lineWidth   = 2;
  ctx.setLineDash([6, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "rgba(99,102,241,0.08)";
  ctx.fillRect(x, y, w, h);
}

function finishRect(pos) {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  const x = Math.min(state.drawStart.x, pos.x);
  const y = Math.min(state.drawStart.y, pos.y);
  const w = Math.abs(pos.x - state.drawStart.x);
  const h = Math.abs(pos.y - state.drawStart.y);
  if (w > 10 && h > 10) state.selection = {x, y, w, h};
}

clearBtn.addEventListener("click", () => {
  state.uploadedFile = null;
  state.selection    = null;
  if (state.imageUrl) { URL.revokeObjectURL(state.imageUrl); state.imageUrl = null; }
  fileInput.value = "";
  previewWrap.classList.add("hidden");
  dropZone.classList.remove("hidden");
  solveBtn.classList.add("hidden");
  showState("idle");
});

solveBtn.addEventListener("click", startProcessing);

async function startProcessing() {
  if (!state.uploadedFile) return;
  solveBtn.disabled = true;
  showState("processing");
  resetPipeline();

  if (state.isDemoMode) {
    await runDemoMode();
  } else {
    await runLiveMode();
  }
  solveBtn.disabled = false;
}

const STEPS = ["upload", "ocr", "bedrock", "done"];

function resetPipeline() {
  progressBar.style.width = "0%";
  processingEta.textContent = "Estimating…";
  STEPS.forEach(s => setStep(s, "pending"));
}

function setStep(name, status) {
  const el = document.querySelector(`[data-step="${name}"]`);
  if (!el) return;
  el.classList.remove("step-active", "step-complete");
  const statusEl = el.querySelector(".step-status");
  if (status === "active")    { el.classList.add("step-active");    statusEl.textContent = "⟳"; statusEl.classList.add("spinning"); }
  if (status === "complete")  { el.classList.add("step-complete");  statusEl.textContent = "✓"; statusEl.classList.remove("spinning"); }
  if (status === "pending")   { statusEl.textContent = "—"; statusEl.classList.remove("spinning"); }
  if (status === "error")     { statusEl.textContent = "✗"; statusEl.classList.remove("spinning"); }
}

function setProgress(pct, etaText = "") {
  progressBar.style.width = `${pct}%`;
  if (etaText) processingEta.textContent = etaText;
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

async function runDemoMode() {
  const scenario = DEMO_SCENARIOS[Math.floor(Math.random() * DEMO_SCENARIOS.length)];
  const fakeJobId = `demo-${crypto.randomUUID().slice(0,8)}`;
  const fakeAz    = ["us-east-1a", "us-east-1b"][Math.floor(Math.random() * 2)];
  state.currentJobId = fakeJobId;
  showJobId(fakeJobId);

  setStep("upload", "active");
  setProgress(8, "Auth verified (Cognito JWT) · Uploading to S3…");
  await sleep(600);
  setStep("upload", "complete");

  setProgress(20, "Job enqueued to SQS · Waiting for ECS worker…");
  await sleep(700);

  setStep("ocr", "active");
  setProgress(38, `ECS Fargate (${fakeAz}) · Running Texify OCR…`);
  await sleep(2000);
  setStep("ocr", "complete");

  setStep("bedrock", "active");
  setProgress(72, "Amazon Bedrock (Claude 3 Haiku) solving equation…");
  await sleep(1700);
  setStep("bedrock", "complete");

  setStep("done", "active");
  setProgress(100, "Writing result to S3 · Updating DynamoDB…");
  await sleep(500);
  setStep("done", "complete");

  showResult({
    latex:    scenario.latex,
    solution: scenario.solution,
    elapsed:  (Math.random() * 4 + 3).toFixed(1),
    workerAz: fakeAz,
  });
}


async function runLiveMode() {
  const apiUrl = (apiUrlInput.value || "").replace(/\/$/, "");
  if (!apiUrl) {
    showError("Please enter your API Gateway URL in the configuration field below.");
    return;
  }

  setStep("upload", "active");
  setProgress(10, "Uploading to S3 via API Gateway…");

  let jobId;
  try {
    const b64 = await fileToBase64(state.uploadedFile);
    const resp = await fetch(`${apiUrl}/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_b64: b64 }),
    });
    if (!resp.ok) throw new Error(`Upload failed: HTTP ${resp.status}`);
    const data = await resp.json();
    jobId = data.job_id;
    state.currentJobId = jobId;
    showJobId(jobId);
  } catch (err) {
    setStep("upload", "error");
    showError(`Upload failed: ${err.message}`);
    return;
  }

  setStep("upload", "complete");
  setStep("ocr", "active");
  setProgress(25, "OCR worker processing image…");

  state.pollCount = 0;
  await pollJob(apiUrl, jobId);
}

async function pollJob(apiUrl, jobId) {
  if (state.pollCount > MAX_POLLS) {
    showError("Job timed out after 100 seconds. Please try again.");
    return;
  }
  state.pollCount++;

  let data;
  try {
    const resp = await fetch(`${apiUrl}/solve?job_id=${jobId}`);
    data = await resp.json();
  } catch (err) {
    showError(`Polling failed: ${err.message}`);
    return;
  }

  if (data.status === "PROCESSING") {
    setProgress(40 + state.pollCount * 1.5, "Bedrock is solving…");
    if (state.pollCount > 8) setStep("bedrock", "active");
  }

  if (data.status === "DONE") {
    setStep("ocr", "complete");
    setStep("bedrock", "complete");
    setStep("done", "complete");
    setProgress(100, "Complete!");
    showResult({
      latex:    data.latex,
      solution: data.solution,
      elapsed:  data.elapsed_seconds,
      workerAz: data.worker_az,
    });
    return;
  }


  if (data.status === "ERROR") {
    setStep("ocr", "error");
    showError(data.error_message || "Worker error.");
    return;
  }

  state.pollTimer = setTimeout(() => pollJob(apiUrl, jobId), POLL_INTERVAL_MS);
}

function showResult({latex, solution, elapsed, workerAz}) {
  showState("done");

  latexRaw.textContent = latex;

  latexDisplay.innerHTML = "";
  const display = document.createElement("div");
  display.textContent = `$$${latex}$$`;
  latexDisplay.appendChild(display);

  if (window.renderMathInElement) {
    renderMathInElement(latexDisplay, {
      delimiters: [{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],
      throwOnError: false,
    });
  }

  solutionDiv.innerHTML = markdownToHtml(solution);

  if (window.renderMathInElement) {
    renderMathInElement(solutionDiv, {
      delimiters: [{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],
      throwOnError: false,
    });
  }

  elapsedEl.textContent = elapsed;

  const azBadge = $("az-badge");
  const azName  = $("az-name");
  if (workerAz && azBadge && azName) {
    azName.textContent = workerAz;
    azBadge.style.display = "flex";
    const az1 = document.querySelector(".arch-node-ecs-az1");
    const az2 = document.querySelector(".arch-node-ecs-az2");
    if (az1 && az2) {
      const isAz1 = workerAz.endsWith("a") || workerAz.endsWith("-1");
      (isAz1 ? az1 : az2).style.boxShadow = "0 0 20px rgba(99,102,241,0.5)";
      (isAz1 ? az2 : az1).style.boxShadow = "none";
    }
  }

  switchTab("rendered");
}


function showJobId(id) {
  jobIdText.textContent = id;
  jobIdBadge.classList.remove("hidden");
}

tabBtns.forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.id.replace("tab-", "")));
});

function switchTab(name) {
  tabBtns.forEach(b => {
    const active = b.id === `tab-${name}`;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active);
  });
  tabPanels.forEach(p => {
    p.classList.toggle("hidden", !p.id.includes(name));
    p.classList.toggle("active", p.id.includes(name));
  });
}

$("copy-latex-btn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(latexRaw.textContent);
    $("copy-latex-btn").textContent = "✓ Copied!";
    setTimeout(() => { $("copy-latex-btn").textContent = "📋 Copy"; }, 2000);
  } catch { /* clipboard blocked */ }
});

$("reset-btn").addEventListener("click", reset);
$("retry-btn").addEventListener("click", reset);

function reset() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.currentJobId = null;
  state.pollCount    = 0;
  jobIdBadge.classList.add("hidden");
  showState("idle");
  solveBtn.disabled = false;
}

function showState(name) {
  resultIdle.classList.toggle(      "hidden", name !== "idle");
  resultProcessing.classList.toggle("hidden", name !== "processing");
  resultDone.classList.toggle(      "hidden", name !== "done");
  resultError.classList.toggle(     "hidden", name !== "error");
}

function showError(msg) {
  errMsgEl.textContent = msg;
  showState("error");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function markdownToHtml(md) {
  return md
    .replace(/^### (.+)$/gm,   "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,    "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,     "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`]+)`/g,     "<code>$1</code>")
    .replace(/^\|(.+)\|$/gm, (_, row) => {
      if (row.trim().match(/^[-| ]+$/)) return "";      
      const cells = row.split("|").map(c => `<td>${c.trim()}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .replace(/^\d+\. (.+)$/gm,  "<li>$1</li>")
    .replace(/((<li>.*<\/li>\n?)+)/g, "<ol>$1</ol>")
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\$\$(.+?)\$\$/gs, (_, m) => `$$${m}$$`)  
    .replace(/\$(.+?)\$/g,      (_, m) => `$${m}$`);   
}
