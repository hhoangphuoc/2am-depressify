// The roster's 14-day sleep sparkline as SVG (`Sparkline` in design/clinician/src/Charts.jsx). The
// geometry is the pure `sparkline()` in js/lib/design-view.js; this file only draws it.
const NS = "http://www.w3.org/2000/svg";
let counter = 0;

/** @param {string} tag @param {Record<string, string | number>} [attrs] */
function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * @param {import("../lib/design-view.js").SparklineModel} model
 * @returns {SVGSVGElement}
 */
export function drawSparkline(model) {
  const { width: w, height: h } = model;
  const root = /** @type {SVGSVGElement} */ (svg("svg", { class: "sparkline", width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": model.label }));
  const id = `spark-hatch-${++counter}`;
  const defs = svg("defs");
  const pattern = svg("pattern", { id, width: 4, height: 4, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pattern.append(svg("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 4 }));
  defs.append(pattern);
  root.append(defs);
  for (const gap of model.gaps) root.append(svg("rect", { x: gap.x, y: 0, width: gap.width, height: h, fill: `url(#${id})` }));
  if (model.baselineY !== null) root.append(svg("line", { class: "spark-baseline", x1: 0, x2: w, y1: model.baselineY, y2: model.baselineY }));
  for (const segment of model.segments) {
    root.append(svg("polyline", { class: "spark-line", points: segment.map((p) => p.join(",")).join(" ") }));
  }
  if (model.last) root.append(svg("circle", { class: "spark-dot", cx: model.last.x, cy: model.last.y, r: 2.4 }));
  return root;
}
