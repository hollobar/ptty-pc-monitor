import streamDeck from "@elgato/streamdeck";
import { stat } from "node:fs/promises";

import { helper, type Frame, type Thumbnail } from "./helper-client";
import type { BackgroundPlacement } from "./style";

const KEY_SIZE = 144;
/** The layout editor shows the image at about 3x, so decode its thumbnail at twice key size. */
const THUMBNAIL_SIZE = 288;
/**
 * Elgato's plugin guidelines allow at most 10 key updates per second; faster GIFs are shown by time,
 * skipping frames, so they keep their real speed.
 */
export const MIN_FRAME_INTERVAL_MS = 100;

export type Background = {
	frames: Frame[];
	/** Cumulative end time of each frame, for time-based playback. */
	ends: number[];
	duration: number;
};

/** Decoded backgrounds keyed by path + modification time + placement, so editing the file reloads it. */
const cache = new Map<string, Promise<Background | null>>();
const thumbnails = new Map<string, Promise<Thumbnail | null>>();

export async function loadBackground(path: string, placement: BackgroundPlacement): Promise<Background | null> {
	const version = await fileVersion(path);
	if (!version) return null;

	const key = `${version}|${JSON.stringify(placement)}`;
	let entry = cache.get(key);
	if (!entry) {
		entry = helper
			.loadFrames(path, KEY_SIZE, placement)
			.then(toBackground)
			.catch((err) => {
				streamDeck.logger.warn(`background image failed: ${path}: ${err}`);
				cache.delete(key);
				return null;
			});
		cache.set(key, entry);
		evictOld(cache, key);
	}
	return entry;
}

/** Whole, uncropped first frame for the layout editor. */
export async function loadThumbnail(path: string): Promise<Thumbnail | null> {
	const version = await fileVersion(path);
	if (!version) return null;

	let entry = thumbnails.get(version);
	if (!entry) {
		entry = helper.loadThumbnail(path, THUMBNAIL_SIZE).catch((err) => {
			streamDeck.logger.warn(`background thumbnail failed: ${path}: ${err}`);
			thumbnails.delete(version);
			return null;
		});
		thumbnails.set(version, entry);
	}
	return entry;
}

/** Index of the frame that should be visible `elapsedMs` into the loop. */
export function frameAt(background: Background, elapsedMs: number): number {
	if (background.frames.length <= 1) return 0;
	const t = elapsedMs % background.duration;
	const index = background.ends.findIndex((end) => t < end);
	return index < 0 ? background.frames.length - 1 : index;
}

async function fileVersion(path: string): Promise<string | null> {
	try {
		return `${path}|${(await stat(path)).mtimeMs}`;
	} catch {
		streamDeck.logger.warn(`background image not found: ${path}`);
		return null;
	}
}

/** Moving an image around in the layout editor creates a new placement each save; keep only recent ones. */
function evictOld<T>(map: Map<string, T>, keep: string, limit = 8): void {
	for (const key of map.keys()) {
		if (map.size <= limit) break;
		if (key !== keep) map.delete(key);
	}
}

function toBackground(frames: Frame[]): Background | null {
	if (frames.length === 0) return null;
	let total = 0;
	const ends = frames.map((f) => (total += f.delay));
	return { frames, ends, duration: total };
}
