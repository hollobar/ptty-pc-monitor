import type { Language } from "./i18n";

/** Appearance settings shared by the sensor key settings and the renderer. */
export type StyleSettings = {
	labelColor?: string;
	/** When true (default), value and graph colors follow the warn/danger thresholds. */
	autoColor?: boolean;
	valueColor?: string;
	lineColor?: string;
	fillColor?: string;
	/** 0–100 */
	fillOpacity?: number;
	bgColor?: string;
	/** Path of a PNG/JPEG/GIF/WebP file chosen in the property inspector. */
	bgImage?: string;
	/** 0–90: black overlay on top of the background image so text stays readable. */
	bgDim?: number;

	/** Installed font family name; empty means the default. */
	labelFont?: string;
	/** Font size in key pixels (key is 144x144); unset means automatic. */
	labelSize?: number;
	/** Text anchor (center) x and baseline y in key pixels. */
	labelX?: number;
	labelY?: number;
	valueFont?: string;
	valueSize?: number;
	valueX?: number;
	valueY?: number;
	/** Second line (e.g. RAM "51% / 32GB"); unset = follows the value. */
	detailX?: number | string;
	detailY?: number | string;
	/** Second line font size; unset = scales with the value size. */
	detailSize?: number | string;

	/** Graph range in the metric's own unit (e.g. °C); unset means the metric default. */
	graphMin?: number | string;
	graphMax?: number | string;

	/** Graph area in key pixels: the max value reaches graphTop, the min value sits on graphBottom. */
	graphLeft?: number | string;
	graphTop?: number | string;
	graphRight?: number | string;
	graphBottom?: number | string;

	/** Background image placement: percent of "cover" size, and center offset in key pixels. */
	bgScale?: number | string;
	bgOffsetX?: number | string;
	bgOffsetY?: number | string;
	/** Part of the image to show, in percent (0–100) of its width/height; applied before placement. */
	bgCropLeft?: number | string;
	bgCropTop?: number | string;
	bgCropRight?: number | string;
	bgCropBottom?: number | string;
};

/** Where and how large the background image is drawn; crop values are fractions (0–1) of the image. */
export type BackgroundPlacement = {
	scale: number;
	offsetX: number;
	offsetY: number;
	cropLeft: number;
	cropTop: number;
	cropRight: number;
	cropBottom: number;
};

/** Smallest crop span in percent, so the crop box can't collapse. */
const MIN_CROP_SPAN = 1;

export function resolvePlacement(s: StyleSettings): BackgroundPlacement {
	const left = clampOptional(s.bgCropLeft, 0, 100 - MIN_CROP_SPAN) ?? 0;
	const top = clampOptional(s.bgCropTop, 0, 100 - MIN_CROP_SPAN) ?? 0;
	const right = clampOptional(s.bgCropRight, left + MIN_CROP_SPAN, 100) ?? 100;
	const bottom = clampOptional(s.bgCropBottom, top + MIN_CROP_SPAN, 100) ?? 100;
	return {
		scale: (clampOptional(s.bgScale, 10, 500) ?? 100) / 100,
		offsetX: clampOptional(s.bgOffsetX, -432, 432) ?? 0,
		offsetY: clampOptional(s.bgOffsetY, -432, 432) ?? 0,
		cropLeft: left / 100,
		cropTop: top / 100,
		cropRight: right / 100,
		cropBottom: bottom / 100,
	};
}

export type KeyStyle = {
	labelColor: string;
	autoColor: boolean;
	valueColor: string;
	lineColor: string;
	fillColor: string;
	fillOpacity: number;
	bgColor: string;
	bgDim: number;

	labelFont: string;
	labelSize?: number;
	labelX: number;
	labelY: number;
	valueFont: string;
	valueSize?: number;
	valueX: number;
	valueY: number;
	detailX?: number;
	detailY?: number;
	detailSize?: number;

	graphMin?: number;
	graphMax?: number;
	graphLeft: number;
	graphTop: number;
	graphRight: number;
	graphBottom: number;
};

/** Default font stacks per language; each keeps the other as a fallback for mixed text (e.g. fan names). */
const FONT_STACKS: Record<Language, { label: string; value: string }> = {
	ko: {
		label: "Malgun Gothic, Segoe UI, sans-serif",
		value: "Segoe UI, Malgun Gothic, sans-serif",
	},
	en: {
		label: "Segoe UI, Malgun Gothic, sans-serif",
		value: "Segoe UI, Malgun Gothic, sans-serif",
	},
};
const DEFAULT_LABEL_FONT = FONT_STACKS.ko.label;
const DEFAULT_VALUE_FONT = FONT_STACKS.ko.value;

export const DEFAULT_STYLE: KeyStyle = {
	labelColor: "#e5e7eb",
	autoColor: true,
	valueColor: "#4ade80",
	lineColor: "#4ade80",
	fillColor: "#4ade80",
	fillOpacity: 0.18,
	bgColor: "#0d1117",
	bgDim: 0.4,

	labelFont: DEFAULT_LABEL_FONT,
	labelX: 72,
	labelY: 30,
	valueFont: DEFAULT_VALUE_FONT,
	valueX: 72,
	valueY: 92,

	graphLeft: 0,
	graphTop: 70,
	graphRight: 144,
	graphBottom: 144,
};

/** Smallest graph width/height, so the area can't collapse. */
const MIN_GRAPH_SPAN = 4;

/**
 * Validates user settings; anything malformed falls back to the default (values end up inside SVG markup).
 * `lang` picks the default font stack for the display language.
 */
export function resolveStyle(s: StyleSettings, lang: Language = "ko"): KeyStyle {
	const fonts = FONT_STACKS[lang];
	return {
		labelColor: color(s.labelColor, DEFAULT_STYLE.labelColor),
		autoColor: s.autoColor !== false && (s.autoColor as unknown) !== "false",
		valueColor: color(s.valueColor, DEFAULT_STYLE.valueColor),
		lineColor: color(s.lineColor, DEFAULT_STYLE.lineColor),
		fillColor: color(s.fillColor, DEFAULT_STYLE.fillColor),
		fillOpacity: fraction(s.fillOpacity, 100, DEFAULT_STYLE.fillOpacity),
		bgColor: color(s.bgColor, DEFAULT_STYLE.bgColor),
		bgDim: fraction(s.bgDim, 90, DEFAULT_STYLE.bgDim),

		labelFont: font(s.labelFont, fonts.label),
		labelSize: clampOptional(s.labelSize, 6, 100),
		labelX: clampOptional(s.labelX, 0, 144) ?? DEFAULT_STYLE.labelX,
		labelY: clampOptional(s.labelY, 0, 144) ?? DEFAULT_STYLE.labelY,
		valueFont: font(s.valueFont, fonts.value),
		valueSize: clampOptional(s.valueSize, 6, 120),
		valueX: clampOptional(s.valueX, 0, 144) ?? DEFAULT_STYLE.valueX,
		valueY: clampOptional(s.valueY, 0, 144) ?? DEFAULT_STYLE.valueY,
		detailX: clampOptional(s.detailX, 0, 144),
		detailY: clampOptional(s.detailY, 0, 144),
		detailSize: clampOptional(s.detailSize, 6, 80),

		graphMin: clampOptional(s.graphMin, -1e12, 1e12),
		graphMax: clampOptional(s.graphMax, -1e12, 1e12),
		...graphArea(s),
	};
}

function graphArea(s: StyleSettings) {
	const left = clampOptional(s.graphLeft, 0, 144 - MIN_GRAPH_SPAN) ?? DEFAULT_STYLE.graphLeft;
	const top = clampOptional(s.graphTop, 0, 144 - MIN_GRAPH_SPAN) ?? DEFAULT_STYLE.graphTop;
	const right = clampOptional(s.graphRight, left + MIN_GRAPH_SPAN, 144) ?? Math.max(DEFAULT_STYLE.graphRight, left + MIN_GRAPH_SPAN);
	const bottom = clampOptional(s.graphBottom, top + MIN_GRAPH_SPAN, 144) ?? Math.max(DEFAULT_STYLE.graphBottom, top + MIN_GRAPH_SPAN);
	return { graphLeft: left, graphTop: top, graphRight: right, graphBottom: bottom };
}

function color(value: unknown, fallback: string): string {
	return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function fraction(value: unknown, max: number, fallback: number): number {
	const n = clampOptional(value, 0, max);
	return n === undefined ? fallback : n / 100;
}

/** A chosen family first, with the default stack as fallback for missing glyphs (e.g. Hangul). */
function font(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	const name = value.replace(/["'<>&;{}\\]/g, "").trim().slice(0, 64);
	return name ? `'${name}', ${fallback}` : fallback;
}

/** Parses numbers that may arrive as strings from text inputs; blank or invalid means "not set". */
function clampOptional(value: unknown, min: number, max: number): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}
