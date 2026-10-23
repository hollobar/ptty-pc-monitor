import streamDeck from "@elgato/streamdeck";

/** Shape of GET /api/sensors from the PC Monitor service (service/PcMonitor.Service). */
export type Snapshot = {
	timestamp: string;
	isElevated: boolean;
	/** Whether the PawnIO driver is installed; undefined from service builds older than this field. */
	pawnIO?: boolean;
	cpu: DeviceReading;
	gpu: DeviceReading;
	memory: { usedGB: number; totalGB: number; load: number };
	network: { downloadBytesPerSec: number; uploadBytesPerSec: number; adapters: string[] };
	fans: FanReading[];
};

/** `percent` is the fan duty (0–100) from its control sensor; null/undefined when unknown or from older service builds. */
export type FanReading = { id: string; name: string; hardware: string; rpm: number; percent?: number | null };

type DeviceReading = { name: string | null; load: number | null; temperature: number | null };

/** `null` means the service could not be reached. */
type Listener = (snapshot: Snapshot | null) => void;

const SERVICE_URL = "http://localhost:47321/api/sensors";
const POLL_INTERVAL_MS = 1000;

/**
 * Polls the PC Monitor service while at least one listener is subscribed.
 * Polls are chained (not setInterval) so a slow response never stacks requests.
 */
class SensorClient {
	private readonly listeners = new Set<Listener>();
	private timer: NodeJS.Timeout | undefined;

	/** Most recent successful snapshot, for one-off lookups such as the fan list. */
	latest: Snapshot | null = null;

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		if (this.listeners.size === 1) void this.poll();

		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				clearTimeout(this.timer);
				this.timer = undefined;
			}
		};
	}

	private async poll(): Promise<void> {
		let snapshot: Snapshot | null = null;
		try {
			const response = await fetch(SERVICE_URL, { signal: AbortSignal.timeout(POLL_INTERVAL_MS) });
			if (response.ok) {
				const data = (await response.json()) as Snapshot;
				// Older service builds don't send fans.
				snapshot = this.latest = { ...data, fans: data.fans ?? [] };
			}
		} catch {
			// Service not installed or not running; listeners show a disconnected state.
		}

		if (this.listeners.size === 0) return;
		for (const listener of this.listeners) {
			try {
				listener(snapshot);
			} catch (err) {
				streamDeck.logger.error(`sensor listener failed: ${err}`);
			}
		}
		this.timer = setTimeout(() => void this.poll(), POLL_INTERVAL_MS);
	}
}

export const sensorClient = new SensorClient();
