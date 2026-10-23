import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.hollobar.ptty-pc-monitor.sdPlugin";
const languages = ["ko", "en"];

/**
 * locales/<lang>.json is the single source of translations. From it this generates:
 * - <sdPlugin>/<lang>.json: Stream Deck's locale files (action names, tooltips, dial descriptions)
 * - <sdPlugin>/ui/locales.js: the strings for the property inspector pages and the layout window
 */
function generateLocales() {
	return {
		name: "generate-locales",
		buildStart() {
			const strings = {};
			for (const lang of languages) {
				const file = `locales/${lang}.json`;
				this.addWatchFile(file);
				const locale = JSON.parse(fs.readFileSync(file, "utf8"));
				fs.writeFileSync(`${sdPlugin}/${lang}.json`, JSON.stringify(locale.manifest, null, "\t") + "\n");
				strings[lang] = locale.strings;
			}
			fs.writeFileSync(
				`${sdPlugin}/ui/locales.js`,
				`// Generated from plugin/locales/*.json by rollup.config.mjs — edit those files instead.\n` +
					`window.PTTY_LOCALES = ${JSON.stringify(strings, null, "\t")};\n`,
			);
		},
	};
}

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		generateLocales(),
		json(),
		typescript({
			mapRoot: isWatching ? "./" : undefined
		}),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			}
		}
	]
};

export default config;
