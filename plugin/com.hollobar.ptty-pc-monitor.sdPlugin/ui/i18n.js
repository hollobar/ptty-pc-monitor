// Translates the property inspector pages and the layout window using window.PTTY_LOCALES
// (ui/locales.js, generated from plugin/locales/*.json — edit those, not the generated file).
//
// Markup:
//   data-i18n="key"              textContent
//   data-i18n-html="key"         innerHTML (only for our own strings, e.g. with <br>)
//   data-i18n-label="key"        label attribute (sdpi-item, sdpi-checkbox, sdpi-file)
//   data-i18n-placeholder="key"  placeholder attribute
//   data-i18n-loading="key"      loading attribute (sdpi-select)
//   data-i18n-title="key"        title attribute
//   <option data-i18n="key">     replaced with a new <option> so sdpi-select re-reads its items
//
// The language follows the Stream Deck app language (which follows Windows by default):
// Korean when it is Korean, English for everything else — same rule as the plugin (src/i18n.ts).

(function () {
	const LOCALES = window.PTTY_LOCALES;
	let lang = "en";

	function resolve(appLanguage) {
		return String(appLanguage || "").toLowerCase().startsWith("ko") ? "ko" : "en";
	}

	function t(key, vars) {
		let text = LOCALES[lang]?.[key] ?? LOCALES.en[key] ?? key;
		for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
		return text;
	}

	function apply(root = document) {
		document.documentElement.lang = lang;
		root.querySelectorAll("[data-i18n]").forEach((el) => {
			if (el.tagName === "OPTION") {
				const option = new Option(t(el.dataset.i18n), el.value);
				option.dataset.i18n = el.dataset.i18n;
				el.replaceWith(option);
			} else {
				el.textContent = t(el.dataset.i18n);
			}
		});
		root.querySelectorAll("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
		for (const attr of ["label", "placeholder", "loading", "title"]) {
			const data = "i18n" + attr[0].toUpperCase() + attr.slice(1);
			root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => el.setAttribute(attr, t(el.dataset[data])));
		}
	}

	function setLanguage(next) {
		lang = resolve(next);
		apply();
		document.dispatchEvent(new Event("ptty-language"));
	}

	/**
	 * Property inspector pages: read the app language from Stream Deck, then translate. If Stream Deck doesn't
	 * answer within `timeoutMs`, translate with the system language so the page is never left with empty labels.
	 */
	async function initFromStreamDeck(timeoutMs = 1500) {
		const client = window.SDPIComponents.streamDeckClient;
		const fromStreamDeck = client.getConnectionInfo().then((c) => resolve(c?.info?.application?.language));
		const fallback = new Promise((done) => setTimeout(() => done(resolve(navigator.language)), timeoutMs));
		lang = await Promise.race([fromStreamDeck, fallback]);
		apply();
		// A late answer from Stream Deck still wins. sdpi-item only takes its label text once, so a different
		// language needs a reload rather than another apply(); reload at most once per page session.
		fromStreamDeck
			.then((actual) => {
				if (actual === lang) return;
				let reloaded = false;
				try {
					reloaded = sessionStorage.getItem("ptty-lang-reload") === actual;
					sessionStorage.setItem("ptty-lang-reload", actual);
				} catch {}
				if (reloaded) setLanguage(actual);
				else location.reload();
			})
			.catch(() => {});
		return lang;
	}

	window.pttyI18n = { t, apply, resolve, setLanguage, initFromStreamDeck, get lang() { return lang; } };
})();
