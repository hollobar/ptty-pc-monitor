import streamDeck from "@elgato/streamdeck";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import type { BackgroundPlacement } from "./style";

/** Lives next to plugin.js in the plugin's bin folder (built from helper/PcMonitor.Helper). */
const HELPER_PATH = fileURLToPath(new URL("pcmonitor-helper.exe", import.meta.url));

export type VcpValue = { current: number; max: number };
export type MonitorInfo = { id: string; name: string; brightness?: VcpValue; contrast?: VcpValue };
export type Frame = { png: string; delay: number };
export type Thumbnail = { png: string; width: number; height: number };

type Response = {
	id: number;
	ok: boolean;
	error?: string;
	monitors?: MonitorInfo[];
	frames?: Frame[];
	thumbnail?: Thumbnail;
	fonts?: string[];
};
type Pending = { resolve(response: Response): void; reject(error: Error): void };

/**
 * Talks to pcmonitor-helper.exe (DDC/CI monitor control and image decoding) over stdin/stdout JSON lines.
 * The helper is started on first use and restarted on the next request if it exits.
 */
class HelperClient {
	private process: ChildProcessWithoutNullStreams | undefined;
	private readonly pending = new Map<number, Pending>();
	private nextId = 1;

	listMonitors(): Promise<MonitorInfo[]> {
		return this.request({ cmd: "list" }).then((r) => r.monitors ?? []);
	}

	setVcp(monitor: string, code: number, value: number): Promise<void> {
		return this.request({ cmd: "set", monitor, code, value }).then(() => undefined);
	}

	/**
	 * Frames drawn onto a `size` square: cropped first (fractions), then scale 1 covers the square and
	 * offsets move the image center (key pixels).
	 */
	loadFrames(path: string, size: number, placement: BackgroundPlacement): Promise<Frame[]> {
		return this.request({ cmd: "frames", path, size, ...placement }).then((r) => r.frames ?? []);
	}

	/** The whole first frame, uncropped, shorter side scaled to `size`. */
	loadThumbnail(path: string, size: number): Promise<Thumbnail> {
		return this.request({ cmd: "thumbnail", path, size }).then((r) => r.thumbnail!);
	}

	/** Installed font families, fetched once. */
	listFonts(): Promise<string[]> {
		this.fonts ??= this.request({ cmd: "fonts" })
			.then((r) => r.fonts ?? [])
			.catch((err) => {
				this.fonts = undefined;
				throw err;
			});
		return this.fonts;
	}

	private fonts: Promise<string[]> | undefined;

	private request(args: Record<string, unknown>): Promise<Response> {
		const proc = this.ensureStarted();
		const id = this.nextId++;

		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve: (r) => (r.ok ? resolve(r) : reject(new Error(r.error ?? "helper error"))),
				reject,
			});
			proc.stdin.write(JSON.stringify({ id, ...args }) + "\n");
		});
	}

	private ensureStarted(): ChildProcessWithoutNullStreams {
		if (this.process) return this.process;

		const proc = spawn(HELPER_PATH, [], { windowsHide: true });
		readline.createInterface({ input: proc.stdout }).on("line", (line) => {
			let response: Response;
			try {
				response = JSON.parse(line) as Response;
			} catch {
				return;
			}
			const pending = this.pending.get(response.id);
			if (!pending) return;
			this.pending.delete(response.id);
			pending.resolve(response);
		});
		proc.stderr.on("data", (data) => streamDeck.logger.warn(`helper: ${data}`));

		const fail = (reason: string) => {
			if (this.process !== proc) return;
			this.process = undefined;
			for (const pending of this.pending.values()) pending.reject(new Error(reason));
			this.pending.clear();
		};
		proc.on("error", (err) => fail(`helper failed to start: ${err.message}`));
		proc.on("exit", (code) => fail(`helper exited (${code})`));

		this.process = proc;
		return proc;
	}
}

export const helper = new HelperClient();
