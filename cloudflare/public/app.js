"use strict";
const $ = (s) => document.querySelector(s);
let selectedFile = null,
  previewUrl = null,
  busy = false,
  lastAnswer = "",
  cooldownUntil = 0;
let selectedExample = null;
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
async function choose(file, owned = false) {
  if (busy && !owned) return;
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
  selectedExample = null;
  $("#equation").value = "";
  $("#result").hidden = true;
  $("#empty-result").hidden = false;
  $("#copy").hidden = true;
  document
    .querySelectorAll("[data-example]")
    .forEach((b) => b.setAttribute("aria-pressed", "false"));
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
$("#read-image").addEventListener("click", async () => {
  if (busy || !selectedFile) return;
  if (selectedExample) {
    $("#equation").value = selectedExample.equation;
    stage("read", "done");
    status("Cached image example recognized. No live AI quota used.");
    return;
  }
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
    status(
      data.cache
        ? "Cached image example recognized. No live AI quota used."
        : "Equation transcribed. Review and edit it before solving.",
    );
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
  if (selectedExample && equation === selectedExample.equation) {
    render({ ...selectedExample, elapsed_ms: 0 });
    stage("solve", "done");
    stage("check", "done");
    status("Recorded AI example · no live inference used.");
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
    status(
      data.cache
        ? "Recorded AI example · no live inference used."
        : "Solution ready. Review the steps and the check below.",
    );
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
  $("#timing").textContent = data.cache
    ? "Cached example · no live inference"
    : (data.elapsed_ms / 1000).toFixed(1) + "s · Workers AI";
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
  button.addEventListener("click", async () => {
    if (busy) return;
    lock(true);
    try {
      const id = button.dataset.example;
      const response = await fetch("/api/examples/" + id);
      if (!response.ok) throw Error("Could not load this example.");
      const item = await response.json();
      const image = await fetch(item.image);
      if (!image.ok) throw Error("Could not load the example image.");
      await choose(
        new File([await image.blob()], id + ".png", { type: "image/png" }),
        true,
      );
      selectedExample = item;
      $("#equation").value = item.equation;
      $("#ocr-note").textContent =
        "Recorded image example. Edit the equation to try live inference.";
      stage("read", "done");
      stage("solve", "");
      stage("check", "");
      button.setAttribute("aria-pressed", "true");
      status(
        "Image example ready. Click Work it out; no live AI quota will be used.",
      );
    } catch (e) {
      status(e.message, true);
    } finally {
      lock(false);
    }
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
