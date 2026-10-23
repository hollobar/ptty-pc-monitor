import type { StringKey } from "./i18n";
import type { FanReading, Snapshot } from "./sensor-client";

export type MetricId = "cpu-temp" | "cpu-load" | "gpu-temp" | "gpu-load" | "ram" | "net-down" | "net-up" | "fan";

/** Which RAM figure is shown large: used percent (default, like the other usage items) or used GB. */
export type RamPrimary = "percent" | "gb";
/** Fan value shown on the key: speed (RPM) or duty (%). */
export type FanDisplay = "rpm" | "percent";
/**
 * What the graph and its min/max range are measured in. "percent" ranges are limited to 0–100;
 * "actual" uses the sensor's own unit (°C, GB, RPM, Mbps) without limits.
 */
export type GraphUnit = "percent" | "actual";

/** Per-key choices that refine a metric. */
export type MetricOptions = { fanId?: string; ramPrimary?: RamPrimary; fanDisplay?: FanDisplay };

export type FormattedValue = {
	value: string;
	unit: string;
	/** Second line under the value (e.g. "51% / 32GB"). */
	detail?: string;
	/** Keep the unit next to the number even when the text is long (it would otherwise move to its own line). */
	unitInline?: boolean;
};

/** One way of graphing a metric. */
export type GraphSpec = {
	read(snapshot: Snapshot, fan?: FanReading): number | null;
	/** Default graph ceiling; omitted = scale to the recent peak. */
	max?: number | ((snapshot: Snapshot) => number);
	/** Raw units per user-facing range unit, e.g. bytes/s per Mbps; user min/max are multiplied by it. */
	factor?: number;
	/** Unit shown next to the range inputs. */
	unit: string;
};

export type Metric = {
	/** Translation key of the default label. */
	label: StringKey;
	/** Label that depends on the reading, e.g. the selected fan's name (not translated). */
	labelFor?(snapshot: Snapshot, options: MetricOptions): string | undefined;
	/** Value shown on the key (also drives automatic colors), or null when the sensor is unavailable. */
	read(snapshot: Snapshot, options: MetricOptions): number | null;
	format(value: number, snapshot: Snapshot, options: MetricOptions): FormattedValue;
	/** Available graph units; the first one is the default. */
	graphs: Partial<Record<GraphUnit, GraphSpec>>;
	/** Value at which the color turns amber / red. */
	warn?: number;
	danger?: number;
	/** Translation key shown in place of a value when the sensor is missing. */
	missingHint?(snapshot: Snapshot, options: MetricOptions): StringKey;
};

const BYTES_PER_SEC_PER_MBPS = 1e6 / 8;

const percent = (value: number): FormattedValue => ({ value: Math.round(value).toString(), unit: "%" });
const celsius = (value: number): FormattedValue => ({ value: Math.round(value).toString(), unit: "°C" });

/**
 * CPU temperature needs the PawnIO driver and an elevated service. Say which one is missing instead of
 * a vague "no sensor". `pawnIO` is undefined from older service builds, which only know about elevation.
 */
function cpuTempHint(s: Snapshot): StringKey {
	if (s.pawnIO === false) return "status.needPawnIO";
	return s.isElevated ? "status.noSensor" : "status.needAdmin";
}

/** Temperatures: "actual" (default) allows any °C range, "%" treats 0–100 °C as the range (clamped). */
const temperatureGraphs = (read: (s: Snapshot) => number | null): Metric["graphs"] => ({
	actual: { read, max: 100, unit: "°C" },
	percent: { read, max: 100, unit: "%" },
});

export const METRICS: Record<MetricId, Metric> = {
	"cpu-temp": {
		label: "metric.cpuTemp",
		read: (s) => s.cpu.temperature,
		format: celsius,
		graphs: temperatureGraphs((s) => s.cpu.temperature),
		warn: 70,
		danger: 85,
		missingHint: cpuTempHint,
	},
	"cpu-load": {
		label: "metric.cpuLoad",
		read: (s) => s.cpu.load,
		format: percent,
		graphs: { percent: { read: (s) => s.cpu.load, max: 100, unit: "%" } },
		warn: 70,
		danger: 90,
	},
	"gpu-temp": {
		label: "metric.gpuTemp",
		read: (s) => s.gpu.temperature,
		format: celsius,
		graphs: temperatureGraphs((s) => s.gpu.temperature),
		warn: 70,
		danger: 83,
		missingHint: () => "status.noSensor",
	},
	"gpu-load": {
		label: "metric.gpuLoad",
		read: (s) => s.gpu.load,
		format: percent,
		graphs: { percent: { read: (s) => s.gpu.load, max: 100, unit: "%" } },
		warn: 70,
		danger: 90,
	},
	ram: {
		label: "metric.ram",
		read: (s) => s.memory.load,
		format: (_, s, o) => {
			const used = s.memory.usedGB.toFixed(1);
			const total = Math.round(s.memory.totalGB);
			const load = Math.round(s.memory.load);
			// Anything but "gb" (including the removed "used / total" option) shows the percentage.
			return o.ramPrimary === "gb"
				? { value: used, unit: "GB", detail: `${load}% / ${total}GB`, unitInline: true }
				: { value: load.toString(), unit: "%", detail: `${used} / ${total}GB` };
		},
		graphs: {
			percent: { read: (s) => s.memory.load, max: 100, unit: "%" },
			actual: { read: (s) => s.memory.usedGB, max: (s) => s.memory.totalGB, unit: "GB" },
		},
		warn: 75,
		danger: 90,
	},
	"net-down": {
		label: "metric.netDown",
		read: (s) => s.network.downloadBytesPerSec,
		format: bitRate,
		// Always a real speed: no percent option and no range limits.
		graphs: { actual: { read: (s) => s.network.downloadBytesPerSec, factor: BYTES_PER_SEC_PER_MBPS, unit: "Mbps" } },
	},
	"net-up": {
		label: "metric.netUp",
		read: (s) => s.network.uploadBytesPerSec,
		format: bitRate,
		graphs: { actual: { read: (s) => s.network.uploadBytesPerSec, factor: BYTES_PER_SEC_PER_MBPS, unit: "Mbps" } },
	},
	fan: {
		label: "metric.fan",
		labelFor: (s, o) => findFan(s, o.fanId)?.name,
		read: (s, o) => {
			const fan = findFan(s, o.fanId);
			if (!fan) return null;
			return o.fanDisplay === "percent" ? (fan.percent ?? null) : fan.rpm;
		},
		format: (v, _, o) => (o.fanDisplay === "percent" ? percent(v) : { value: Math.round(v).toString(), unit: "RPM" }),
		graphs: {
			actual: { read: (_, fan) => fan?.rpm ?? null, unit: "RPM" },
			percent: { read: (_, fan) => fan?.percent ?? null, max: 100, unit: "%" },
		},
		// Motherboard fan headers are only visible with PawnIO, so with no fans at all that is the likely cause.
		missingHint: (s, o) => {
			if (findFan(s, o.fanId)) return "status.noValue"; // e.g. % chosen but this fan has no duty sensor
			if (s.fans.length > 0) return "status.pickFan";
			return s.pawnIO === false ? "status.needPawnIO" : "status.noFanSensor";
		},
	},
};

export const DEFAULT_METRIC: MetricId = "cpu-temp";

export function isMetricId(value: unknown): value is MetricId {
	return typeof value === "string" && value in METRICS;
}

/** The chosen graph unit when the metric offers it, otherwise the metric's default (first) unit. */
export function graphUnitOf(metric: Metric, setting: unknown): GraphUnit {
	const units = Object.keys(metric.graphs) as GraphUnit[];
	return units.includes(setting as GraphUnit) ? (setting as GraphUnit) : units[0];
}

/** Falls back to the first fan when none is chosen yet, so a new key shows something useful. */
export function findFan(snapshot: Snapshot, fanId: string | undefined): FanReading | undefined {
	return fanId ? snapshot.fans.find((f) => f.id === fanId) : snapshot.fans[0];
}

/** Internet speeds are usually quoted in bits per second, so convert bytes/s to Kbps/Mbps/Gbps. */
function bitRate(bytesPerSec: number): FormattedValue {
	const bits = bytesPerSec * 8;
	if (bits >= 1e9) return { value: (bits / 1e9).toFixed(2), unit: "Gbps" };
	if (bits >= 1e6) return { value: (bits / 1e6).toFixed(bits >= 1e8 ? 0 : 1), unit: "Mbps" };
	return { value: Math.round(bits / 1e3).toString(), unit: "Kbps" };
}
