"use strict";
const $ = (s) => document.querySelector(s);
let selectedFile = null,
  previewUrl = null,
  busy = false,
  lastAnswer = "",
  cooldownUntil = 0;
const examples = {
  quadratic: "x^2 - 5x + 6 = 0",
  linear: "3x + 7 = 22",
  calculus: "Find the derivative of f(x) = x^3 + 2x.",
};
function status(message, error = false) {
  $("#status").textContent = message;
  $("#status").classList.toggle("error", error);
}
function stage(name, state) {
  $("#stage-" + name).className = state;
}
function lock(value) {
  busy = value;
  $("#solve").disabled = value;
  $("#read-image").disabled = value || !selectedFile;
  $("#equation").disabled = value;
  $("#image").disabled = value;
  $("#remove-image").disabled = value;
  $("#sample-image").disabled = value;
  document
    .querySelectorAll("[data-example]")
    .forEach((b) => (b.disabled = value));
}
async function call(path, options) {
  if (Date.now() < cooldownUntil)
    throw Error(
      "Please wait " +
        Math.ceil((cooldownUntil - Date.now()) / 1000) +
        " seconds before trying again.",
    );
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 100000);
  try {
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json();
    if (response.status === 429)
      cooldownUntil =
        Date.now() +
        Math.min(
          300,
          Math.max(1, Number(response.headers.get("Retry-After")) || 60),
        ) *
          1000;
    if (!response.ok)
      throw Error(data.error || "The request could not be completed.");
    return data;
  } catch (e) {
    if (e.name === "AbortError")
      throw Error("The request timed out. Please try again later.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
function math(element, latex) {
  element.replaceChildren();
  if (window.katex) {
    try {
      katex.render(latex, element, {
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 200,
        maxSize: 12,
        output: "mathml",
        displayMode: true,
      });
    } catch {
      element.textContent = latex;
    }
  } else element.textContent = latex;
}
async function choose(file) {
  if (busy) return;
  if (!file || !["image/png", "image/jpeg"].includes(file.type))
    throw Error("Choose a PNG or JPEG image.");
  if (file.size > 1572864)
    throw Error("That image is too large. Choose one smaller than 1.5 MB.");
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  if (width > 2048 || height > 2048)
    throw Error("Choose an image no larger than 2048 pixels on each side.");
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  selectedFile = file;
  $("#preview").src = previewUrl;
  $("#preview").hidden = false;
  $("#upload-empty").hidden = true;
  $("#image-controls").hidden = false;
  $("#filename").textContent = file.name;
  $("#read-image").disabled = false;
  stage("read", "");
  status("Image ready. Click Read equation to transcribe it.");
}
$("#image").addEventListener("change", (e) =>
  choose(e.target.files[0]).catch((e) => status(e.message, true)),
);
$("#remove-image").addEventListener("click", () => {
  if (busy) return;
  selectedFile = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("#preview").removeAttribute("src");
  $("#preview").hidden = true;
  $("#upload-empty").hidden = false;
  $("#image-controls").hidden = true;
  $("#image").value = "";
  $("#read-image").disabled = true;
  stage("read", "");
  status("");
});
for (const name of ["dragenter", "dragover"])
  $("#dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("#dropzone").classList.add("drag");
  });
for (const name of ["dragleave", "drop"])
  $("#dropzone").addEventListener(name, (e) => {
    e.preventDefault();
    $("#dropzone").classList.remove("drag");
  });
$("#dropzone").addEventListener("drop", (e) =>
  choose(e.dataTransfer.files[0]).catch((e) => status(e.message, true)),
);
$("#sample-image").addEventListener("click", async () => {
  try {
    const response = await fetch("/samples/quadratic.png");
    const blob = await response.blob();
    await choose(new File([blob], "quadratic.png", { type: "image/png" }));
  } catch (e) {
    status(e.message, true);
  }
});
$("#read-image").addEventListener("click", async () => {
  if (busy || !selectedFile) return;
  lock(true);
  stage("read", "active");
  stage("solve", "");
  stage("check", "");
  status("Reading your image with the vision model…");
  try {
    const body = new FormData();
    body.append("image", selectedFile);
    const data = await call("/api/ocr", { method: "POST", body });
    $("#equation").value = data.equation;
    $("#ocr-note").textContent = data.uncertainties.length
      ? "Please check: " + data.uncertainties.join("; ")
      : "Transcribed. Check the symbols, then click Work it out.";
    stage("read", "done");
    status("Equation transcribed. Review and edit it before solving.");
    $("#equation").focus();
  } catch (e) {
    stage("read", "");
    status(e.message, true);
  } finally {
    lock(false);
  }
});
$("#solve").addEventListener("click", async () => {
  if (busy) return;
  const equation = $("#equation").value.trim();
  if (!equation) {
    status("Enter or read an equation first.", true);
    return;
  }
  lock(true);
  stage("solve", "active");
  stage("check", "active");
  status("Solver and reviewer are working on your confirmed equation…");
  $("#result").hidden = true;
  $("#empty-result").hidden = false;
  $("#copy").hidden = true;
  try {
    const data = await call("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ equation }),
    });
    render(data);
    stage("solve", "done");
    stage("check", data.review.verdict === "unavailable" ? "" : "done");
    status("Solution ready. Review the steps and the check below.");
  } catch (e) {
    stage("solve", "");
    stage("check", "");
    status(e.message, true);
  } finally {
    lock(false);
  }
});
function render(data) {
  $("#empty-result").hidden = true;
  $("#result").hidden = false;
  $("#copy").hidden = false;
  $("#problem-type").textContent = data.solution.title;
  $("#timing").textContent =
    (data.elapsed_ms / 1000).toFixed(1) + "s · Workers AI";
  $("#recognized").textContent = data.equation;
  $("#steps").replaceChildren();
  for (const step of data.solution.steps) {
    const li = document.createElement("li"),
      p = document.createElement("p"),
      formula = document.createElement("div");
    p.textContent = step.explanation;
    formula.className = "step-math";
    math(formula, step.latex);
    li.append(p, formula);
    $("#steps").append(li);
  }
  math($("#answer"), data.solution.answer);
  lastAnswer = data.solution.answer;
  const check = $("#verification");
  check.replaceChildren();
  check.className = "verification " + data.check.status;
  const title = document.createElement("strong");
  title.textContent =
    data.check.status === "passed"
      ? "✓ Independent root check passed"
      : data.check.status === "failed"
        ? "Review needed · root check failed"
        : "Independent check not available";
  check.append(title, document.createTextNode(data.check.summary));
  const review = $("#review");
  review.replaceChildren();
  const label = document.createElement("strong");
  label.textContent =
    data.review.verdict === "consistent"
      ? "Model review · no issue reported"
      : data.review.verdict === "needs_review"
        ? "Model review · review needed"
        : "Model review unavailable";
  review.append(label, document.createTextNode(data.review.note));
  $("#assumptions").textContent = data.solution.assumptions.length
    ? "Assumptions: " + data.solution.assumptions.join(" · ")
    : "";
}
for (const button of document.querySelectorAll("[data-example]"))
  button.addEventListener("click", () => {
    if (busy) return;
    $("#equation").value = examples[button.dataset.example];
    $("#ocr-note").textContent =
      "Typed example · sends a real request to Workers AI.";
    stage("read", "");
    status("Example ready. Click Work it out.");
  });
$("#copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastAnswer);
    $("#copy").textContent = "Copied";
    setTimeout(() => ($("#copy").textContent = "Copy answer"), 2000);
  } catch {
    status(
      "Clipboard access is unavailable. Select and copy the answer.",
      true,
    );
  }
});
fetch("/api/health")
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((data) => {
    if (!data.live) throw Error();
    $("#connection").textContent = "Workers AI connected";
    $("#connection").classList.add("live");
  })
  .catch(() => {
    $("#connection").textContent = "AI connection unavailable";
    status(
      "The model service is not connected. You can still explore the interface.",
      true,
    );
  });
