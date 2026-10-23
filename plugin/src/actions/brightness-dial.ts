import streamDeck, {
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type SendToPluginEvent,
	SingletonAction,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { type StringKey, t } from "../i18n";
import { ALL_MONITORS, type Feature, monitorStore } from "../monitors";

type DialSettings = {
	/** Monitor id from the helper, or "all". */
	monitor?: string;
	feature?: Feature;
	/** Percentage points per dial tick. */
	step?: number;
};

const FEATURE_LABEL: Record<Feature, StringKey> = { brightness: "dial.brightness", contrast: "dial.contrast" };

const MIN_RENDER_INTERVAL_MS = 100;

/**
 * Stream Deck + dial that adjusts monitor brightness / contrast over DDC/CI.
 * Turn: adjust. Press: switch brightness <-> contrast. Touch: re-read values from the monitors.
 */
@action({ UUID: "com.hollobar.ptty-pc-monitor.brightness" })
export class BrightnessDial extends SingletonAction<DialSettings> {
	private readonly settingsByAction = new Map<string, DialSettings>();
	private lastRenderAll = 0;
	private pendingRenderAll: NodeJS.Timeout | undefined;

	constructor() {
		super();
		monitorStore.onChange(() => this.scheduleRenderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<DialSettings>): Promise<void> {
		this.settingsByAction.set(ev.action.id, ev.payload.settings);
		await this.render(ev.action.id);
		await monitorStore.ensureLoaded();
	}

	override onWillDisappear(ev: WillDisappearEvent<DialSettings>): void {
		this.settingsByAction.delete(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<DialSettings>): Promise<void> {
		this.settingsByAction.set(ev.action.id, ev.payload.settings);
		await this.render(ev.action.id);
	}

	override onDialRotate(ev: DialRotateEvent<DialSettings>): void {
		const settings = this.settingsByAction.get(ev.action.id) ?? ev.payload.settings;
		const feature = featureOf(settings);
		const step = clampStep(settings.step);
		monitorStore.adjust(monitorStore.targets(settings.monitor, feature), feature, ev.payload.ticks * step);
	}

	override async onDialDown(ev: DialDownEvent<DialSettings>): Promise<void> {
		const settings = this.settingsByAction.get(ev.action.id) ?? ev.payload.settings;
		const next: DialSettings = { ...settings, feature: featureOf(settings) === "brightness" ? "contrast" : "brightness" };
		this.settingsByAction.set(ev.action.id, next);
		await ev.action.setSettings(next);
		await this.render(ev.action.id);
	}

	override async onTouchTap(): Promise<void> {
		await monitorStore.refresh();
	}

	/** Supplies the monitor dropdown in the property inspector (sdpi-select datasource="getMonitors"). */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, DialSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getMonitors") return;

		await monitorStore.refresh();
		await streamDeck.ui.sendToPropertyInspector({
			event: "getMonitors",
			items: [
				{ value: ALL_MONITORS, label: t("dial.allMonitors") },
				...monitorStore.monitors.map((m) => ({
					value: m.id,
					label: m.brightness || m.contrast ? m.name : `${m.name} (${t("dial.noDdc")})`,
				})),
			],
		});
	}

	/**
	 * A fast spin changes values many times per second; Elgato's guidelines allow at most 10 updates per
	 * second, so repaint immediately at most every 100 ms and fold the rest into one trailing repaint.
	 */
	private scheduleRenderAll(): void {
		if (this.pendingRenderAll) return;
		const wait = Math.max(0, this.lastRenderAll + MIN_RENDER_INTERVAL_MS - Date.now());
		this.pendingRenderAll = setTimeout(() => {
			this.pendingRenderAll = undefined;
			this.lastRenderAll = Date.now();
			void this.renderAll();
		}, wait);
	}

	private async renderAll(): Promise<void> {
		await Promise.all([...this.settingsByAction.keys()].map((id) => this.render(id)));
	}

	private async render(actionId: string): Promise<void> {
		const action = this.actions.find((a) => a.id === actionId);
		const settings = this.settingsByAction.get(actionId);
		if (!action?.isDial() || !settings) return;

		const feature = featureOf(settings);
		const targets = monitorStore.targets(settings.monitor, feature);
		const percent = monitorStore.percent(targets, feature);
		const where =
			!settings.monitor || settings.monitor === ALL_MONITORS
				? t("dial.all")
				: (monitorStore.monitors.find((m) => m.id === settings.monitor)?.name ?? t("dial.noMonitor"));

		await action.setFeedback({
			title: `${t(FEATURE_LABEL[feature])} · ${where}`,
			value: percent === null ? "--" : `${Math.round(percent)}%`,
			indicator: { value: percent ?? 0 },
			icon: featureIcon(feature),
		});
	}
}

function featureOf(settings: DialSettings): Feature {
	return settings.feature === "contrast" ? "contrast" : "brightness";
}

function clampStep(step: unknown): number {
	const n = Number(step);
	return Number.isFinite(n) && n >= 1 ? Math.min(20, Math.round(n)) : 2;
}

/** Sun for brightness, half-filled circle for contrast. */
function featureIcon(feature: Feature): string {
	const body =
		feature === "brightness"
			? `<circle cx="36" cy="36" r="12" fill="#fde047"/>` +
				Array.from({ length: 8 }, (_, i) => {
					const a = (i * Math.PI) / 4;
					const [x1, y1, x2, y2] = [36 + Math.cos(a) * 18, 36 + Math.sin(a) * 18, 36 + Math.cos(a) * 26, 36 + Math.sin(a) * 26];
					return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fde047" stroke-width="5" stroke-linecap="round"/>`;
				}).join("")
			: `<circle cx="36" cy="36" r="24" fill="none" stroke="#e5e7eb" stroke-width="5"/><path d="M36 12a24 24 0 0 1 0 48z" fill="#e5e7eb"/>`;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72">${body}</svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}
