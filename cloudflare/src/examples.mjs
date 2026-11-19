import quadratic from "../examples/quadratic.json" with { type: "json" };
import linear from "../examples/linear.json" with { type: "json" };
import calculus from "../examples/calculus.json" with { type: "json" };
export const examples = {
  quadratic: {
    ...quadratic,
    image: "/samples/quadratic.png",
    image_sha256:
      "c4029ce8a4cbeaa573ff22c53a60a83494bddcf8e521ff6f42b95cb847f6383e",
  },
  linear: {
    ...linear,
    image: "/samples/linear.png",
    image_sha256:
      "bea6fd51d2b6221f6fb1c7487b86c5654b02cc58a7368ef02a8bf58cdfd8fc61",
  },
  calculus: {
    ...calculus,
    image: "/samples/calculus.png",
    image_sha256:
      "d0dddefd71ea025294468e19c2ad1d5bcf6946ce1b3217c2a543120d9712331e",
  },
};
const normalize = (s) => s.replace(/\s/g, "").replace(/−/g, "-");
export function cachedSolution(equation) {
  return (
    Object.values(examples).find(
      (e) => normalize(e.equation) === normalize(equation),
    ) || null
  );
}
export async function cachedImage(bytes) {
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const item = Object.values(examples).find((e) => e.image_sha256 === digest);
  return item
    ? {
        equation: item.equation,
        latex: item.equation,
        uncertainties: [],
        model: item.model,
        cache: item.cache,
      }
    : null;
}
