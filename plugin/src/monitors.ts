import streamDeck from "@elgato/streamdeck";

import { helper, type MonitorInfo } from "./helper-client";

export type Feature = "brightness" | "contrast";

/** DDC/CI VCP codes. */
const VCP_CODE: Record<Feature, number> = { brightness: 0x10, contrast: 0x12 };

/** Pseudo monitor id meaning "every monitor that supports the feature". */
export const ALL_MONITORS = "all";

type Write = { monitor: string; feature: Feature; value: number };

/**
 * Cached monitor list with optimistic updates. Dial turns change the cache immediately (so the
 * touch strip feels instant) and queue a DDC/CI write; only the latest value per monitor/feature
 * is written, because each write takes ~50 ms and a fast spin produces many ticks.
 */
class MonitorStore {
	monitors: MonitorInfo[] = [];

	private readonly listeners = new Set<() => void>();
	private readonly queue = new Map<string, Write>();
	private writing = false;
	private loading: Promise<void> | undefined;
	private loaded = false;

	onChange(listener: () => void): void {
		this.listeners.add(listener);
	}

	ensureLoaded(): Promise<void> {
		return this.loaded ? Promise.resolve() : this.refresh();
	}

	/** Re-reads values from the monitors, e.g. after they were changed with the monitor's own buttons. */
	refresh(): Promise<void> {
		this.loading ??= helper
			.listMonitors()
			.then((monitors) => {
				// Don't clobber values that are still waiting to be written.
				if (this.queue.size > 0 || this.writing) return;
				this.monitors = monitors;
				this.loaded = true;
				this.emit();
			})
			.catch((err) => void streamDeck.logger.error(`monitor list failed: ${err}`))
			.finally(() => (this.loading = undefined));
		return this.loading;
	}

	targets(monitorId: string | undefined, feature: Feature): MonitorInfo[] {
		const supported = this.monitors.filter((m) => m[feature]);
		if (!monitorId || monitorId === ALL_MONITORS) return supported;
		return supported.filter((m) => m.id === monitorId);
	}

	/** Average of the targets as a percentage, or null when none support the feature. */
	percent(targets: MonitorInfo[], feature: Feature): number | null {
		const values = targets.map((m) => m[feature]!).map((v) => (v.current / v.max) * 100);
		return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
	}

	/** Moves every target by the same number of percentage points (like Monitorian's unison mode). */
	adjust(targets: MonitorInfo[], feature: Feature, deltaPercent: number): void {
		for (const monitor of targets) {
			const vcp = monitor[feature]!;
			const next = Math.min(vcp.max, Math.max(0, vcp.current + Math.round((deltaPercent * vcp.max) / 100)));
			if (next === vcp.current) continue;

			vcp.current = next;
			this.queue.set(`${monitor.id}|${feature}`, { monitor: monitor.id, feature, value: next });
		}
		this.emit();
		void this.flush();
	}

	private async flush(): Promise<void> {
		if (this.writing) return;
		this.writing = true;
		try {
			while (this.queue.size > 0) {
				const [key, write] = this.queue.entries().next().value!;
				this.queue.delete(key);
				try {
					await helper.setVcp(write.monitor, VCP_CODE[write.feature], write.value);
				} catch (err) {
					streamDeck.logger.warn(`DDC/CI write failed for ${write.monitor}: ${err}`);
				}
			}
		} finally {
			this.writing = false;
		}
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}

export const monitorStore = new MonitorStore();
