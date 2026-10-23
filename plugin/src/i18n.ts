import streamDeck from "@elgato/streamdeck";

import en from "../locales/en.json";
import ko from "../locales/ko.json";

export type Language = "ko" | "en";
export type StringKey = keyof typeof en.strings;

const STRINGS: Record<Language, Record<string, string>> = { ko: ko.strings, en: en.strings };

/**
 * The display language follows the Stream Deck app language (which follows Windows by default):
 * Korean when it is Korean, English for everything else.
 */
export function resolveLanguage(appLanguage: string | undefined): Language {
	return appLanguage === "ko" ? "ko" : "en";
}

let current: Language | undefined;

export function language(): Language {
	// Registration info comes from the launch arguments, so it is available before connecting.
	current ??= resolveLanguage(streamDeck.info.application.language);
	return current;
}

/** Translates `key`, replacing `{name}` placeholders with `vars`. Missing keys fall back to English, then the key. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
	let text = STRINGS[language()][key] ?? STRINGS.en[key] ?? key;
	for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
	return text;
}
