// Shared property inspector controls, bound to action settings through sdpi-components' useSettings.
//
//   <div class="pm-range" data-setting="fillOpacity" data-min="0" data-max="100" data-step="5" data-default="18"></div>
//     Slider + number box showing the current value. Type a number, drag, or use the mouse wheel.
//     data-optional: the setting may be unset ("자동"); the reset button clears it instead of restoring the default.
//
//   <div class="pm-number" data-setting="graphMin" data-placeholder="자동 (0)" data-step="1" data-min="0" data-max="100"></div>
//     Number box that may be left blank (unset). Mouse wheel steps the value. Typed values outside
//     data-min / data-max (read on every change, so a page may update them) are pulled back into range.

(function () {
	const { useSettings } = window.SDPIComponents;
	/** setting key -> function that shows a new value in its control */
	const pmControls = (window.pmControls = {});

	const style = document.createElement("style");
	style.textContent = `
		.pm-range, .pm-number { display: flex; align-items: center; gap: 6px; }
		.pm-range input[type=range] { flex: 1; min-width: 0; accent-color: #4c8cff; }
		.pm-range input[type=number], .pm-number input {
			width: 58px; box-sizing: border-box; padding: 3px 4px; border: 1px solid #555; border-radius: 3px;
			background: #3d3d3d; color: #d8d8d8; font: inherit; font-size: 9pt;
		}
		.pm-number input { width: 100%; }
		.pm-reset { flex: none; padding: 1px 6px; border: 1px solid #555; border-radius: 3px; background: #3d3d3d; color: #bbb; cursor: pointer; font-size: 9pt; }
		.pm-reset:hover { color: #fff; }
	`;
	document.head.appendChild(style);

	function initRange(el) {
		const key = el.dataset.setting;
		const min = Number(el.dataset.min);
		const max = Number(el.dataset.max);
		const step = Number(el.dataset.step || 1);
		const def = Number(el.dataset.default);
		const optional = el.hasAttribute("data-optional");

		// data-i18n-* are filled in by i18n.js once the language is known.
		el.innerHTML =
			`<input type="range"><input type="number"${optional ? ' data-i18n-placeholder="pi.auto"' : ""}>` +
			`<button class="pm-reset" data-i18n-title="${optional ? "pi.resetToAuto" : "pi.resetToDefault"}">↺</button>`;
		const [range, number, reset] = el.children;
		for (const input of [range, number]) Object.assign(input, { min, max, step });

		const clamp = (v) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
		const show = (v) => {
			const unset = v === undefined || v === null || v === "";
			range.value = unset ? def : v;
			number.value = unset ? (optional ? "" : def) : v;
		};

		const [get, set] = useSettings(key, show);
		get().then(show);
		// Lets the page refresh this control after it saved the setting itself (e.g. from the layout window).
		pmControls[key] = show;

		const commit = (v) => {
			v = clamp(v);
			show(v);
			set(v);
		};
		range.addEventListener("input", () => commit(Number(range.value)));
		number.addEventListener("change", () => {
			if (number.value === "") return optional ? (show(""), set("")) : commit(def);
			commit(Number(number.value));
		});
		reset.addEventListener("click", () => (optional ? (show(""), set("")) : commit(def)));
		el.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				commit(Number(range.value) + (e.deltaY < 0 ? step : -step));
			},
			{ passive: false },
		);
	}

	function initNumber(el) {
		const key = el.dataset.setting;
		const step = Number(el.dataset.step || 1);

		el.innerHTML = `<input type="number">`;
		const input = el.firstElementChild;
		Object.assign(input, { step, placeholder: el.dataset.placeholder || "" });

		const show = (v) => (input.value = v === undefined || v === null ? "" : v);
		const [get, set] = useSettings(key, show);
		get().then(show);

		const clamp = (v) => {
			const min = el.dataset.min === undefined ? -Infinity : Number(el.dataset.min);
			const max = el.dataset.max === undefined ? Infinity : Number(el.dataset.max);
			return Math.min(max, Math.max(min, v));
		};
		const commit = () => {
			if (input.value === "") return set("");
			const v = clamp(Number(input.value));
			input.value = v; // show the corrected value, e.g. -5 -> 0, 150 -> 100
			set(v);
		};
		input.addEventListener("change", commit);
		// Lets the page re-apply the range after changing data-min / data-max.
		pmControls[key] = (v) => (v === undefined ? commit() : show(v));
		el.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const base = input.value === "" ? Number(el.dataset.wheelStart || 0) : Number(input.value);
				input.value = base + (e.deltaY < 0 ? step : -step);
				commit();
			},
			{ passive: false },
		);
	}

	document.querySelectorAll(".pm-range").forEach(initRange);
	document.querySelectorAll(".pm-number").forEach(initNumber);
})();
