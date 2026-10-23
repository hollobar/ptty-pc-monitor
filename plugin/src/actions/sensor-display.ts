import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { type Background, frameAt, loadBackground, loadThumbnail, MIN_FRAME_INTERVAL_MS } from "../backgrounds";
import { helper } from "../helper-client";
import { language, t } from "../i18n";
import {
	DEFAULT_METRIC,
	type FanDisplay,
	findFan,
	type GraphSpec,
	type GraphUnit,
	graphUnitOf,
	isMetricId,
	type Metric,
	METRICS,
	type MetricId,
	type RamPrimary,
} from "../metrics";
import { colorsFor, type GraphView, graphRatios, renderKey, textMetrics, textParts, type KeyView } from "../render";
import { sensorClient, type Snapshot } from "../sensor-client";
import {
	type BackgroundPlacement,
	DEFAULT_STYLE,
	type KeyStyle,
	resolvePlacement,
	resolveStyle,
	type StyleSettings,
} from "../style";

type SensorSettings = StyleSettings & {
	metric?: MetricId;
	/** Fan sensor id from the service, used when metric is "fan". */
	fanId?: string;
	/** Which RAM figure is shown large, used when metric is "ram". */
	ramPrimary?: RamPrimary;
	/** Fan value on the key: RPM or duty %. */
	fanDisplay?: FanDisplay;
	/** Graph / range unit: "percent" (range limited to 0–100) or "actual" (sensor unit, no limits). */
	graphUnit?: GraphUnit;
	/** false = show only the big value, without the second line (e.g. RAM "51% / 32GB"). */
	showDetail?: boolean | string;
	/** Optional custom label shown at the top of the key. */
	label?: string;
};

/** Per-key state: settings plus the (possibly animated) background being played. */
type KeyState = {
	settings: SensorSettings;
	bgPath?: string;
	/** Path + placement of the decoded background, so moving the image re-decodes it. */
	bgKey?: string;
	background?: Background | null;
	animation?: NodeJS.Timeout;
	animationStart: number;
};

/** Number of samples kept for the background graph (one per second). */
const HISTORY_LENGTH = 30;

/**
 * Key that shows one PC sensor value (chosen in the property inspector) with a short history graph,
 * custom colors and an optional still or animated background image.
 */
@action({ UUID: "com.hollobar.ptty-pc-monitor.sensor" })
export class SensorDisplay extends SingletonAction<SensorSettings> {
	private readonly keys = new Map<string, KeyState>();
	/** Keyed by {@link seriesKey}, so each fan keeps its own history. */
	private readonly history = new Map<string, number[]>();
	/** `undefined` until the first poll completes, `null` when the service is unreachable. */
	private latest: Snapshot | null | undefined;
	private unsubscribe: (() => void) | undefined;

	override async onWillAppear(ev: WillAppearEvent<SensorSettings>): Promise<void> {
		this.unsubscribe ??= sensorClient.subscribe((snapshot) =>
			this.onSnapshot(snapshot).catch((err) => streamDeck.logger.error(`sensor update failed: ${err}`)),
		);
		await this.applySettings(ev.action.id, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<SensorSettings>): void {
		clearInterval(this.keys.get(ev.action.id)?.animation);
		this.keys.delete(ev.action.id);
		if (this.keys.size === 0) {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
			this.latest = undefined;
			this.history.clear();
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SensorSettings>): Promise<void> {
		await this.applySettings(ev.action.id, ev.payload.settings);
	}

	/**
	 * Requests from the property inspector:
	 * - getFans / getFonts: dropdown items (sdpi-select datasource)
	 * - getPreview: the key without text plus everything the layout editor needs to draw draggable text
	 * - getStatus: service / PawnIO state, for the PawnIO guide in the property inspector
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SensorSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		switch (payload?.event) {
			case "getFans": {
				const fans = sensorClient.latest?.fans ?? [];
				await streamDeck.ui.sendToPropertyInspector({
					event: "getFans",
					items: fans.map((f) => ({ value: f.id, label: `${f.name} · ${f.hardware} (${Math.round(f.rpm)} RPM)` })),
				});
				break;
			}
			case "getFonts": {
				const fonts = await helper.listFonts().catch(() => [] as string[]);
				await streamDeck.ui.sendToPropertyInspector({
					event: "getFonts",
					items: [{ value: "", label: t("font.default") }, ...fonts.map((f) => ({ value: f, label: f }))],
				});
				break;
			}
			case "getStatus": {
				const s = sensorClient.latest;
				await streamDeck.ui.sendToPropertyInspector({
					event: "getStatus",
					connected: s !== null,
					// null when unknown: no data yet, or a service build that doesn't report it
					pawnIO: s?.pawnIO ?? null,
				});
				break;
			}
			case "getPreview": {
				const state = this.keys.get(ev.action.id);
				if (state) await streamDeck.ui.sendToPropertyInspector({ event: "getPreview", ...(await this.preview(state)) });
				break;
			}
		}
	}

	/** Everything the layout editor (ui/layout.html) needs to redraw the key with draggable parts. */
	private async preview(state: KeyState) {
		const view = this.viewFor(state.settings);
		const style = resolveStyle(state.settings, language());
		const placement = resolvePlacement(state.settings);
		const m = textMetrics(view, style);
		const parts = textParts(view);
		const colors = colorsFor(view, style);
		const thumbnail = state.bgPath ? await loadThumbnail(state.bgPath) : null;

		const percent = (fraction: number) => Math.round(fraction * 1000) / 10;
		const layout = (s: KeyStyle, p: BackgroundPlacement) => ({
			labelX: s.labelX,
			labelY: s.labelY,
			// null = automatic size
			labelSize: s.labelSize ?? null,
			valueX: s.valueX,
			valueY: s.valueY,
			valueSize: s.valueSize ?? null,
			// null = the second line follows the value / scales with it
			detailX: s.detailX ?? null,
			detailY: s.detailY ?? null,
			detailSize: s.detailSize ?? null,
			graphLeft: s.graphLeft,
			graphTop: s.graphTop,
			graphRight: s.graphRight,
			graphBottom: s.graphBottom,
			bgScale: Math.round(p.scale * 100),
			bgOffsetX: p.offsetX,
			bgOffsetY: p.offsetY,
			bgCropLeft: percent(p.cropLeft),
			bgCropTop: percent(p.cropTop),
			bgCropRight: percent(p.cropRight),
			bgCropBottom: percent(p.cropBottom),
		});
		// Sizes the renderer picks when the size is left on automatic.
		const auto = textMetrics(view, { ...style, labelSize: undefined, valueSize: undefined });

		return {
			lang: language(),
			// Lets the layout editor name the big value per metric (RAM: "usage").
			metric: isMetricId(state.settings.metric) ? state.settings.metric : DEFAULT_METRIC,
			bgColor: style.bgColor,
			bgDim: style.bgDim,
			background: thumbnail,
			autoSizes: { label: auto.labelSize, value: auto.valueSize },
			graph: { ratios: graphRatios(view, style), line: colors.line, fill: colors.fill, fillOpacity: style.fillOpacity },
			layout: layout(style, placement),
			defaults: layout(DEFAULT_STYLE, resolvePlacement({})),
			label: { text: view.label, x: style.labelX, y: style.labelY, size: m.labelSize, font: style.labelFont, color: style.labelColor },
			value: {
				text: parts.value,
				unit: parts.unit,
				unitSize: m.unitSize,
				x: style.valueX,
				y: style.valueY,
				size: m.valueSize,
				font: style.valueFont,
				color: colors.value,
			},
			detail: parts.detail
				? {
						text: parts.detail,
						x: m.detailX,
						y: m.detailY,
						// Where the line sits relative to the value while it follows it.
						offset: m.detailOffset,
						size: m.detailSize,
						font: style.labelFont,
						color: style.labelColor,
					}
				: null,
		};
	}

	private async applySettings(actionId: string, settings: SensorSettings): Promise<void> {
		const state = this.keys.get(actionId) ?? { settings, animationStart: Date.now() };
		state.settings = settings;
		this.keys.set(actionId, state);

		const bgPath = settings.bgImage?.trim() || undefined;
		const placement = resolvePlacement(settings);
		const bgKey = bgPath && `${bgPath}|${JSON.stringify(placement)}`;
		if (bgKey !== state.bgKey) {
			const pathChanged = bgPath !== state.bgPath;
			state.bgPath = bgPath;
			state.bgKey = bgKey;
			if (pathChanged || !bgPath) {
				// A new image (or none): drop the old one right away. A placement-only change keeps showing
				// the old frames until the re-positioned ones are ready, to avoid flicker.
				this.setBackground(actionId, state, undefined);
				await this.render(actionId);
			}

			if (!bgPath) return;
			const background = await loadBackground(bgPath, placement);
			// Settings may have changed again (or the key gone) while the image was decoding.
			if (this.keys.get(actionId) !== state || state.bgKey !== bgKey) return;
			this.setBackground(actionId, state, background);
		}

		await this.render(actionId);
	}

	private setBackground(actionId: string, state: KeyState, background: Background | null | undefined): void {
		clearInterval(state.animation);
		state.animation = undefined;
		state.background = background;
		this.startAnimation(actionId, state);
	}

	private startAnimation(actionId: string, state: KeyState): void {
		const frames = state.background?.frames;
		if (!frames || frames.length < 2) return;

		const shortest = Math.min(...frames.map((f) => f.delay));
		state.animationStart = Date.now();
		state.animation = setInterval(() => void this.render(actionId), Math.max(MIN_FRAME_INTERVAL_MS, shortest));
	}

	private async onSnapshot(snapshot: Snapshot | null): Promise<void> {
		this.latest = snapshot;
		if (snapshot) this.record(snapshot);
		// Animated keys repaint on their own timer and pick up the new values there.
		await Promise.all([...this.keys].filter(([, s]) => !s.animation).map(([id]) => this.render(id)));
	}

	/** Records every graph unit of every metric (and every fan), so switching units shows history at once. */
	private record(snapshot: Snapshot): void {
		for (const [id, metric] of Object.entries(METRICS) as [MetricId, Metric][]) {
			if (id === "fan") continue;
			for (const [unit, spec] of graphEntries(metric)) this.push(seriesKey(id, unit), spec.read(snapshot));
		}
		for (const fan of snapshot.fans) {
			for (const [unit, spec] of graphEntries(METRICS.fan)) this.push(seriesKey("fan", unit, fan.id), spec.read(snapshot, fan));
		}
	}

	private push(key: string, value: number | null): void {
		if (value === null) return;
		const samples = this.history.get(key) ?? [];
		samples.push(value);
		if (samples.length > HISTORY_LENGTH) samples.shift();
		this.history.set(key, samples);
	}

	private async render(actionId: string): Promise<void> {
		const action = this.actions.find((a) => a.id === actionId);
		const state = this.keys.get(actionId);
		if (!action?.isKey() || !state) return;

		await action.setImage(
			renderKey(this.viewFor(state.settings), resolveStyle(state.settings, language()), {
				backgroundPng: this.currentFrame(state),
			}),
		);
	}

	private currentFrame(state: KeyState): string | undefined {
		const background = state.background;
		return background ? background.frames[frameAt(background, Date.now() - state.animationStart)].png : undefined;
	}

	private viewFor(settings: SensorSettings): KeyView {
		const metricId = isMetricId(settings.metric) ? settings.metric : DEFAULT_METRIC;
		const metric = METRICS[metricId];
		const snapshot = this.latest;
		const custom = settings.label?.trim();
		const options = { fanId: settings.fanId, ramPrimary: settings.ramPrimary, fanDisplay: settings.fanDisplay };

		const defaultLabel = t(metric.label);
		if (snapshot === undefined) return { kind: "message", label: custom || defaultLabel, message: t("status.connecting") };
		if (snapshot === null) return { kind: "message", label: custom || defaultLabel, message: t("status.serviceOff") };

		const label = custom || metric.labelFor?.(snapshot, options) || defaultLabel;
		const raw = metric.read(snapshot, options);
		if (raw === null) {
			return { kind: "message", label, message: t(metric.missingHint?.(snapshot, options) ?? "status.noValue") };
		}

		const unit = graphUnitOf(metric, settings.graphUnit);
		const spec = metric.graphs[unit]!;
		const fanId = metricId === "fan" ? findFan(snapshot, settings.fanId)?.id : undefined;
		const graph: GraphView = {
			history: this.history.get(seriesKey(metricId, unit, fanId)) ?? [],
			unit,
			defaultMax: typeof spec.max === "function" ? spec.max(snapshot) : spec.max,
			factor: spec.factor ?? 1,
		};

		const formatted = metric.format(raw, snapshot, options);
		// "Big value only": drop the second line (a unit moved below a long number is part of the value, so it stays).
		const showDetail = settings.showDetail !== false && settings.showDetail !== "false";
		return { kind: "value", metric, label, raw, graph, ...formatted, detail: showDetail ? formatted.detail : undefined };
	}
}

function seriesKey(metricId: MetricId, unit: GraphUnit, fanId?: string): string {
	return fanId ? `${metricId}:${unit}:${fanId}` : `${metricId}:${unit}`;
}

function graphEntries(metric: Metric): [GraphUnit, GraphSpec][] {
	return Object.entries(metric.graphs) as [GraphUnit, GraphSpec][];
}
