import type { GraphUnit, Metric } from "./metrics";
import type { KeyStyle } from "./style";

const SIZE = 144;
const COLORS = { ok: "#4ade80", warn: "#fbbf24", danger: "#f87171", neutral: "#60a5fa", muted: "#9ca3af" };

/** The graph drawn behind a value: recent samples in the chosen unit, and its default range. */
export type GraphView = {
	history: number[];
	unit: GraphUnit;
	/** Default ceiling (raw units) when the user leaves "max" empty; undefined = scale to the recent peak. */
	defaultMax?: number;
	/** Raw units per user-facing range unit (e.g. bytes/s per Mbps). */
	factor: number;
};

export type KeyView =
	| {
			kind: "value";
			metric: Metric;
			label: string;
			value: string;
			unit: string;
			detail?: string;
			unitInline?: boolean;
			raw: number;
			graph: GraphView;
	  }
	| { kind: "message"; label: string; message: string };

export type RenderOptions = {
	/** Base64 PNG (already key-sized) drawn under everything. */
	backgroundPng?: string;
	/** Leave out the label and value text; used by the layout editor, which draws its own draggable text. */
	hideText?: boolean;
};

/** Renders a 144x144 key image as an SVG data URL. */
export function renderKey(view: KeyView, style: KeyStyle, options: RenderOptions = {}): string {
	const { backgroundPng, hideText } = options;
	const body = view.kind === "value" ? valueBody(view, style, hideText) : messageBody(view, style, hideText);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
		`<rect width="${SIZE}" height="${SIZE}" fill="${style.bgColor}"/>` +
		(backgroundPng
			? `<image width="${SIZE}" height="${SIZE}" href="data:image/png;base64,${backgroundPng}" xlink:href="data:image/png;base64,${backgroundPng}"/>` +
				(style.bgDim > 0 ? `<rect width="${SIZE}" height="${SIZE}" fill="#000" fill-opacity="${style.bgDim}"/>` : "")
			: "") +
		body +
		`</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Sizes and second-line position actually used for a view, after applying the automatic defaults. */
export function textMetrics(view: KeyView, style: KeyStyle) {
	const labelSize = style.labelSize ?? (view.label.length > 8 ? 17 : 21);
	const value = view.kind === "value" ? view.value : "--";
	const autoValueSize = view.kind === "message" ? 44 : value.length > 6 ? 30 : value.length > 4 ? 40 : 50;
	const valueSize = style.valueSize ?? autoValueSize;
	const unitSize = Math.round(valueSize * 0.4);
	const detailSize = style.detailSize ?? Math.max(10, Math.round(valueSize * 0.34));
	// The second line (unit / RAM detail / status message) follows the value unless placed on its own.
	const detailOffset = Math.round(valueSize * 0.68);
	const detailX = style.detailX ?? style.valueX;
	const detailY = style.detailY ?? Math.min(SIZE - 2, style.valueY + detailOffset);
	return { labelSize, valueSize, unitSize, detailSize, detailX, detailY, detailOffset };
}

/** The strings drawn for a view: the value, the unit beside it (if it fits) and the second line. */
export function textParts(view: KeyView): { value: string; unit: string; detail?: string } {
	if (view.kind === "message") return { value: "--", unit: "", detail: view.message };
	// Long units (Mbps, RPM) don't fit beside the number, so they go on their own line.
	const unitBelow = !view.unitInline && view.value.length + view.unit.length > 6;
	return { value: view.value, unit: unitBelow ? "" : view.unit, detail: view.detail ?? (unitBelow ? view.unit : undefined) };
}

/** Value / graph colors after applying automatic (threshold) coloring. */
export function colorsFor(view: KeyView, style: KeyStyle): { value: string; line: string; fill: string } {
	if (view.kind === "message") return { value: COLORS.muted, line: style.lineColor, fill: style.fillColor };
	if (!style.autoColor) return { value: style.valueColor, line: style.lineColor, fill: style.fillColor };
	const auto = autoColor(view.metric, view.raw);
	return { value: auto, line: auto, fill: auto };
}

/** History mapped onto 0 (graph min) … 1 (graph max), clamped. */
export function graphRatios(view: KeyView, style: KeyStyle): number[] {
	if (view.kind !== "value") return [];
	const [min, max] = graphRange(view.graph, style);
	return view.graph.history.map((v) => Math.min(Math.max((v - min) / (max - min), 0), 1));
}

function valueBody(view: Extract<KeyView, { kind: "value" }>, style: KeyStyle, hideText?: boolean): string {
	const colors = colorsFor(view, style);
	const graph = sparkline(graphRatios(view, style), style, colors.line, colors.fill);
	if (hideText) return graph;

	const m = textMetrics(view, style);
	const parts = textParts(view);

	return (
		graph +
		label(view.label, style, m.labelSize) +
		`<text x="${style.valueX}" y="${style.valueY}" text-anchor="middle" font-family="${style.valueFont}" fill="${colors.value}">` +
		`<tspan font-size="${m.valueSize}" font-weight="700">${escape(parts.value)}</tspan>` +
		(parts.unit ? `<tspan font-size="${m.unitSize}" font-weight="600" dx="2">${escape(parts.unit)}</tspan>` : "") +
		`</text>` +
		(parts.detail ? smallText(parts.detail, style, m.detailSize, m.detailX, m.detailY) : "")
	);
}

function messageBody(view: Extract<KeyView, { kind: "message" }>, style: KeyStyle, hideText?: boolean): string {
	if (hideText) return "";
	const m = textMetrics(view, style);
	return (
		label(view.label, style, m.labelSize) +
		`<text x="${style.valueX}" y="${style.valueY - 6}" text-anchor="middle" font-family="${style.valueFont}" font-size="${m.valueSize}" font-weight="700" fill="${COLORS.muted}">--</text>` +
		smallText(view.message, style, m.detailSize, m.detailX, m.detailY)
	);
}

function label(text: string, style: KeyStyle, size: number): string {
	return `<text x="${style.labelX}" y="${style.labelY}" text-anchor="middle" font-family="${style.labelFont}" font-size="${size}" font-weight="700" fill="${style.labelColor}">${escape(text)}</text>`;
}

/** Second line (units, RAM detail, status messages) in a dimmed label color, using the label font. */
function smallText(text: string, style: KeyStyle, size: number, x: number, y: number): string {
	return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${style.labelFont}" font-size="${size}" fill="${style.labelColor}" fill-opacity="0.75">${escape(text)}</text>`;
}

/**
 * Graph bounds: user-set min/max win, then the default ceiling, then the recent peak.
 * In "percent" units the user's range is limited to 0–100; "actual" units are not limited.
 * E.g. CPU temperature with min 40 / max 90 maps 40–90 °C onto the full graph height.
 */
function graphRange(graph: GraphView, style: KeyStyle): [number, number] {
	const limit = (v: number | undefined) =>
		v === undefined || graph.unit !== "percent" ? v : Math.min(100, Math.max(0, v));
	const userMin = limit(style.graphMin);
	const userMax = limit(style.graphMax);

	const min = (userMin ?? 0) * graph.factor;
	const peak = graph.history.length ? Math.max(...graph.history) : min + 1;
	let max = userMax !== undefined ? userMax * graph.factor : (graph.defaultMax ?? min + Math.max(peak - min, 1) * 1.15);
	if (max <= min) max = min + 1;
	return [min, max];
}

/** Filled area graph of recent values inside the configured graph area (bottom of the key by default). */
function sparkline(ratios: number[], style: KeyStyle, line: string, fill: string): string {
	if (ratios.length < 2) return "";

	const { graphLeft: left, graphTop: top, graphRight: right, graphBottom: bottom } = style;
	const step = (right - left) / (ratios.length - 1);
	const points = ratios.map((r, i) => `${(left + i * step).toFixed(1)},${(bottom - r * (bottom - top)).toFixed(1)}`);

	return (
		`<polygon points="${left},${bottom} ${points.join(" ")} ${right},${bottom}" fill="${fill}" fill-opacity="${style.fillOpacity}"/>` +
		`<polyline points="${points.join(" ")}" fill="none" stroke="${line}" stroke-opacity="0.8" stroke-width="2"/>`
	);
}

function autoColor(metric: Metric, value: number): string {
	if (metric.danger === undefined || metric.warn === undefined) return COLORS.neutral;
	if (value >= metric.danger) return COLORS.danger;
	if (value >= metric.warn) return COLORS.warn;
	return COLORS.ok;
}

function escape(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
