// Bounded polynomial grammar, never eval or execute model-generated code.
// Only constant coefficients, x, +, -, *, /constant, parentheses and ^0..2.
export function polynomial(input) {
  let s = input
    .toLowerCase()
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot|\\times|×|·/g, "*")
    .replace(/−/g, "-")
    .replace(/[{}]/g, (m) => (m === "{" ? "(" : ")"))
    .replace(/\s+/g, "");
  if (
    s.length > 240 ||
    !/^[0-9.x+*/^()=\-]+$/.test(s) ||
    (s.match(/=/g) || []).length !== 1
  )
    return null;
  const tokens = s.match(/(?:\d+(?:\.\d*)?|\.\d+)|[x+*/^()=\-]/g);
  let pos = 0,
    operations = 0;
  const add = (a, b, k = 1) => a.map((v, i) => v + k * b[i]);
  const mul = (a, b) => {
    let r = [0, 0, 0];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        if (i + j > 2 && Math.abs(a[i] * b[j]) > 1e-12) throw Error();
        if (i + j < 3) r[i + j] += a[i] * b[j];
      }
    return r;
  };
  const bounded = (a) => {
    if (
      ++operations > 200 ||
      a.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e12)
    )
      throw Error();
    return a;
  };
  function atom() {
    let t = tokens[pos++],
      v;
    if (t === "+" || t === "-") {
      v = atom();
      return t === "-" ? v.map((x) => -x) : v;
    }
    if (t === "(") {
      v = sum();
      if (tokens[pos++] !== ")") throw Error();
    } else if (t === "x") v = [0, 1, 0];
    else if (t && /^\d|^\./.test(t)) v = [Number(t), 0, 0];
    else throw Error();
    if (tokens[pos] === "^") {
      pos++;
      let p = tokens[pos++];
      if (!["0", "1", "2"].includes(p)) throw Error();
      v = p === "0" ? [1, 0, 0] : p === "2" ? mul(v, v) : v;
    }
    return bounded(v);
  }
  function product() {
    let v = atom();
    while (pos < tokens.length) {
      let t = tokens[pos];
      if (t === "*" || t === "/") {
        pos++;
        let b = atom();
        if (t === "/") {
          if (b[1] || b[2] || !b[0]) throw Error();
          v = v.map((x) => x / b[0]);
        } else v = mul(v, b);
      } else if (t === "x" || t === "(") v = mul(v, atom());
      else break;
      v = bounded(v);
    }
    return v;
  }
  function sum() {
    let v = product();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      let k = tokens[pos++] === "+" ? 1 : -1;
      v = bounded(add(v, product(), k));
    }
    return v;
  }
  try {
    let a = sum();
    if (tokens[pos++] !== "=") return null;
    let b = sum();
    if (pos !== tokens.length) return null;
    return bounded(add(a, b, -1));
  } catch {
    return null;
  }
}
export function checkRoots(equation, roots) {
  const p = polynomial(equation);
  if (!p)
    return {
      status: "not_supported",
      summary:
        "Independent checking supports real linear and quadratic equations in x. This solution has not been independently verified.",
    };
  const [c, b, a] = p;
  let expected;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12)
      return {
        status: "not_supported",
        summary: "Degenerate equations need manual review.",
      };
    expected = [-c / b];
  } else {
    let d = b * b - 4 * a * c;
    if (d < 0)
      return {
        status: "not_supported",
        summary: "Complex roots need manual review.",
      };
    expected =
      d === 0
        ? [-b / (2 * a)]
        : [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
  }
  if (
    !Array.isArray(roots) ||
    !roots.length ||
    roots.length > 2 ||
    roots.some((x) => typeof x !== "number" || !Number.isFinite(x))
  )
    return {
      status: "failed",
      summary:
        "The model did not provide a complete set of numeric real roots.",
    };
  const unique = roots.filter(
    (v, i) => roots.findIndex((x) => Math.abs(x - v) < 1e-7) === i,
  );
  const ok =
    unique.length === expected.length &&
    expected.every((x) =>
      unique.some((y) => Math.abs(x - y) <= 1e-7 * Math.max(1, Math.abs(x))),
    ) &&
    roots.every(
      (x) =>
        Math.abs(a * x * x + b * x + c) <=
        1e-7 * Math.max(1, Math.abs(a * x * x), Math.abs(b * x), Math.abs(c)),
    );
  return {
    status: ok ? "passed" : "failed",
    summary: ok
      ? "All real roots match an independent polynomial calculation and satisfy the original equation."
      : "The proposed roots do not match the original equation. Review this solution before using it.",
    coefficients: p,
  };
}
