// Evaluate tab — run evaluation, display metrics and charts
(async function initEvaluateTab() {
	const root = document.getElementById("evaluate-content");

	// Baselines from the VOGUE paper (Table 5) + our calibrated runs
	const BASELINES = {
		human:       { label: "Human Assistants",            mae: 0.896, pc: 0.636, accuracy: 0.397, mMae: 0.849, maeByClass: { 1: 0.746, 2: 0.891, 3: 1.171, 4: 1.284, 5: 0.597 } },
		gpt5mini:    { label: "GPT-5-mini",                  mae: 1.296, pc: 0.083, accuracy: 0.344, mMae: 1.543, maeByClass: { 1: 1.041, 2: 0.845, 3: 1.209, 4: 2.222, 5: 2.516 } },
		gpt4omini:   { label: "GPT-4o-mini",                 mae: 1.619, pc: 0.000, accuracy: 0.156, mMae: 1.491, maeByClass: { 1: 2.160, 2: 1.186, 3: 0.953, 4: 1.160, 5: 1.726 } },
		gemini25:    { label: "Gemini-2.5-Flash",            mae: 1.356, pc: 0.057, accuracy: 0.406, mMae: 1.681, maeByClass: { 1: 0.853, 2: 0.930, 3: 1.628, 4: 2.444, 5: 2.839 } },
		gemini20:    { label: "Gemini-2.0-Flash",            mae: 1.356, pc: 0.041, accuracy: 0.402, mMae: 1.772, maeByClass: { 1: 0.693, 2: 1.031, 3: 1.736, 4: 2.568, 5: 3.065 } },
		random:      { label: "Random",                      mae: 1.713, pc:-0.005, accuracy: 0.240, mMae: 1.730, maeByClass: { 1: 1.997, 2: 1.403, 3: 1.147, 4: 1.469, 5: 2.387 } },
		mode:        { label: "Mode Rating",                 mae: 1.219, pc: null,  accuracy: 0.443, mMae: 1.932, maeByClass: { 1: 0.000, 2: 1.000, 3: 2.000, 4: 3.000, 5: 4.000 } },
		calMamcr:    { label: "MAMCR (calibrated)",   mae: 0.903, pc: 0.519, accuracy: 0.421, mMae: 0.938, maeByClass: { 1: 0.781, 2: 0.822, 3: 1.178, 4: 1.296, 5: 0.613 } },
		calSingle:   { label: "Gemini-3.0-Flash (calibrated)", mae: 0.783, pc: 0.606, accuracy: 0.444, mMae: 0.865, maeByClass: { 1: 0.583, 2: 0.659, 3: 1.116, 4: 1.432, 5: 0.532 } },
		gemini30:    { label: "Gemini-3.0-Flash", mae: 0.826, pc: 0.591, accuracy: 0.418, mMae: 0.851, maeByClass: { 1: 0.721, 2: 0.837, 3: 0.992, 4: 1.235, 5: 0.468 } },
	};

	const METRIC_HELP = {
		mae:      "Mean Absolute Error — average distance between predicted and actual ratings (1\u20135 scale). Lower is better. A perfect predictor scores 0; random guessing scores ~1.7.",
		pc:       "Pearson Correlation — measures how well predictions track the direction of preferences (-1 to 1). Higher is better. Human assistants average 0.64; MLLMs score near 0.",
		accuracy: "Exact-match accuracy — fraction of items where the rounded prediction equals the ground-truth rating. Higher is better. The mode baseline (always predict 1) scores 0.44 due to class imbalance.",
		mMae:     "Macro-averaged MAE — MAE computed per rating class (1\u20135) then averaged, giving equal weight to rare and common ratings. Lower is better. More robust than MAE when classes are imbalanced.",
	};

	// Measured averages from 60 simulation runs (chars of text context).
	// Single-agent assumes access to ALL available information in one prompt.
	const CONTEXT_CATEGORIES = [
		{ key: "scenario",      label: "Scenario",                color: "#9e9e9e" },
		{ key: "transcript",    label: "Transcript",              color: "#2e7ab8" },
		{ key: "metaFull",      label: "Full Item Metadata",      color: "#c4593a" },
		{ key: "catBasic",      label: "Basic Catalogue",         color: "#e07a5f" },
		{ key: "onDemand",      label: "On-demand Retrieval",     color: "#b08a2e" },
		{ key: "taste",         label: "Taste Profile",           color: "#388e3c" },
		{ key: "prefAnalysis",  label: "Preference Analysis",     color: "#66bb6a" },
		{ key: "history",       label: "Historical Context",      color: "#7e57c2" },
	];

	const CONTEXT_BARS = [
		{ label: "Single-Agent",       values: { scenario: 498, transcript: 1944, metaFull: 11928, catBasic: 0,    onDemand: 0,    taste: 2225, prefAnalysis: 0,    history: 17950 } },
		{ label: "Conversation Agent", values: { scenario: 498, transcript: 1944, metaFull: 0,     catBasic: 1364, onDemand: 8774, taste: 2225, prefAnalysis: 4411, history: 0 } },
		{ label: "Preference Agent",   values: { scenario: 0,   transcript: 1944, metaFull: 0,     catBasic: 0,    onDemand: 0,    taste: 0,    prefAnalysis: 6158, history: 0 } },
		{ label: "History Agent*",     values: { scenario: 0,   transcript: 0,    metaFull: 0,     catBasic: 0,    onDemand: 0,    taste: 0,    prefAnalysis: 0,    history: 17950 } },
	];

	root.innerHTML = `
		<div class="action-bar">
			<button class="action-btn" id="eval-all-btn" title="Refresh evaluation">&#x21bb; Refresh</button>
		</div>

		<div class="chart-row">
			<div class="chart-card wide">
				<h3>Text Context Composition — Measured from 60 Simulation Runs</h3>
				<p class="context-chart-subtitle">Measured averages across 60 runs. The single-agent must load all available context in one prompt (~34.5K chars). The multi-agent decomposes this so no individual agent exceeds 56% of that total — the Conversation Agent uses on-demand tool retrieval instead of full metadata, and the Preference Agent operates with just 23%. Both architectures also load 12 item images (~12 MB) for the rating agent. *History Agent invoked in 43% of conversations.</p>
				<canvas id="eval-context-chart"></canvas>
			</div>
		</div>

		<div id="eval-aggregate" style="display:none"></div>

		<div class="chart-row" id="eval-charts" style="display:none">
			<div class="chart-card">
				<h3>MAE by Conversation</h3>
				<canvas id="eval-mae-chart"></canvas>
			</div>
			<div class="chart-card">
				<h3>MAE by Rating Class — vs. Paper Baselines</h3>
				<canvas id="eval-class-chart"></canvas>
			</div>
		</div>

		<div id="eval-compare-section" style="display:none">
			<div class="chart-card wide" style="margin-bottom:1.5rem">
				<h3>Per-Conversation Baseline Comparison</h3>
				<div style="display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center">
					<label style="font-size:0.8rem;color:var(--text-muted)">Metric:
						<select id="eval-compare-metric" style="margin-left:0.3rem;padding:0.3rem 0.5rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.8rem">
							<option value="mae">MAE ↓</option>
							<option value="pc">Pearson ↑</option>
							<option value="accuracy">Accuracy ↑</option>
							<option value="mMae">M-MAE ↓</option>
						</select>
					</label>
					<label style="font-size:0.8rem;color:var(--text-muted)">Conversation:
						<select id="eval-compare-conv" style="margin-left:0.3rem;padding:0.3rem 0.5rem;border-radius:var(--radius);border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:0.8rem">
							<option value="all">All Conversations</option>
						</select>
					</label>
				</div>
				<canvas id="eval-compare-chart"></canvas>
			</div>
		</div>

		<div id="eval-baseline-table" style="display:none">
			<h3 class="results-title">VOGUE Paper Baselines (Table 5)</h3>
			<div class="metrics-table" id="eval-baseline-body"></div>
		</div>

		<div id="eval-per-conv" style="display:none">
			<h3 class="results-title">Per-Conversation Results</h3>
			<div class="metrics-table" id="eval-per-conv-table"></div>
		</div>
	`;

	const evalBtn = document.getElementById("eval-all-btn");
	const aggEl = document.getElementById("eval-aggregate");
	const chartsEl = document.getElementById("eval-charts");
	const perConvEl = document.getElementById("eval-per-conv");
	const baselineEl = document.getElementById("eval-baseline-table");

	let maeChart = null;
	let classChart = null;
	let compareChart = null;
	let cachedPerConv = null;   // saved after evaluation for re-rendering the compare chart

	async function runEvaluation() {
		evalBtn.disabled = true;
		evalBtn.innerHTML = "&#x21bb; Evaluating...";

		try {
			const { perConv, aggregate } = await window.mamcr.evaluateAll();

			// ── Aggregate metrics cards with baseline comparison ──
			aggEl.style.display = "";
			aggEl.innerHTML = `
				<div class="stats-grid">
					${statCard("MAE", aggregate.mae, "mae", "lower")}
					${statCard("Pearson", aggregate.pc, "pc", "higher")}
					${statCard("Accuracy", aggregate.accuracy, "accuracy", "higher")}
					${statCard("M-MAE", aggregate.mMae, "mMae", "lower")}
					<div class="stat-card">
						<div class="label">N</div>
						<div class="value">${aggregate.n}</div>
					</div>
				</div>
			`;

			// Wire up tooltips
			aggEl.querySelectorAll(".stat-card[data-tooltip]").forEach(card => {
				const tip = card.querySelector(".eval-tooltip");
				card.addEventListener("mouseenter", () => tip.style.display = "block");
				card.addEventListener("mouseleave", () => tip.style.display = "none");
			});

			// ── Baseline comparison table ──
			baselineEl.style.display = "";
			const bRows = [
				{ key: null, label: "MAMCR Agent", ...aggregate, isSelf: true },
				...Object.values(BASELINES),
			];

			document.getElementById("eval-baseline-body").innerHTML = `
				<table>
					<thead>
						<tr>
							<th>Model</th>
							<th>MAE \u2193</th>
							<th>PC \u2191</th>
							<th>Accuracy \u2191</th>
							<th>M-MAE \u2193</th>
						</tr>
					</thead>
					<tbody>
						${bRows.map(r => {
							const cls = r.isSelf ? ' class="eval-highlight-row"' : "";
							return `<tr${cls}>
								<td style="font-family:var(--font);font-weight:${r.isSelf ? 700 : 400}">${r.isSelf ? "MAMCR Agent" : r.label}</td>
								<td>${fmt(r.mae)}</td>
								<td>${r.pc != null ? fmt(r.pc) : "N/A"}</td>
								<td>${fmt(r.accuracy)}</td>
								<td>${fmt(r.mMae)}</td>
							</tr>`;
						}).join("")}
					</tbody>
				</table>
			`;

			// ── Per-conversation table ──
			const entries = Object.entries(perConv).filter(([, v]) => v != null);
			perConvEl.style.display = "";
			document.getElementById("eval-per-conv-table").innerHTML = `
				<table>
					<thead>
						<tr><th>Conv</th><th>MAE</th><th>PC</th><th>Accuracy</th><th>M-MAE</th><th>N</th></tr>
					</thead>
					<tbody>
						${entries
							.map(
								([id, m]) => `
							<tr>
								<td>${id}</td>
								<td>${fmt(m.mae)}</td>
								<td>${fmt(m.pc)}</td>
								<td>${fmt(m.accuracy)}</td>
								<td>${fmt(m.mMae)}</td>
								<td>${m.n}</td>
							</tr>`,
							)
							.join("")}
					</tbody>
				</table>
			`;

			// ── Charts ──
			chartsEl.style.display = "";

			// MAE by conversation (with human baseline line)
			if (maeChart) maeChart.destroy();
			maeChart = new Chart(document.getElementById("eval-mae-chart"), {
				type: "bar",
				data: {
					labels: entries.map(([id]) => "Conv " + id),
					datasets: [
						{
							label: "MAMCR Agent",
							data: entries.map(([, m]) => m.mae),
							backgroundColor: "rgba(176, 138, 46, 0.6)",
							borderColor: "#b08a2e",
							borderWidth: 1,
						},
					],
				},
				options: {
					responsive: true,
					scales: { y: { beginAtZero: true, title: { display: true, text: "MAE (lower is better)" } } },
					plugins: {
						legend: { display: false },
						annotation: humanLine(BASELINES.human.mae),
					},
				},
				plugins: [annotationLinePlugin],
			});

			// MAE by rating class — multi-dataset chart
			const classLabels = [1, 2, 3, 4, 5].map(k => "GT=" + k);
			const agentClassValues = [1, 2, 3, 4, 5].map(k => aggregate.maeByClass[k] ?? null);

			if (classChart) classChart.destroy();
			classChart = new Chart(document.getElementById("eval-class-chart"), {
				type: "bar",
				data: {
					labels: classLabels,
					datasets: [
						{
							label: "MAMCR Agent",
							data: agentClassValues,
							backgroundColor: "rgba(176, 138, 46, 0.7)",
							borderColor: "#b08a2e",
							borderWidth: 1,
						},
						{
							label: "Human Asst.",
							data: [1, 2, 3, 4, 5].map(k => BASELINES.human.maeByClass[k]),
							backgroundColor: "rgba(46, 122, 184, 0.5)",
							borderColor: "#2e7ab8",
							borderWidth: 1,
						},
						{
							label: "GPT-5-mini",
							data: [1, 2, 3, 4, 5].map(k => BASELINES.gpt5mini.maeByClass[k]),
							backgroundColor: "rgba(126, 87, 194, 0.4)",
							borderColor: "#7e57c2",
							borderWidth: 1,
						},
						{
							label: "Gemini-2.5-Flash",
							data: [1, 2, 3, 4, 5].map(k => BASELINES.gemini25.maeByClass[k]),
							backgroundColor: "rgba(56, 142, 60, 0.4)",
							borderColor: "#388e3c",
							borderWidth: 1,
						},
					],
				},
				options: {
					responsive: true,
					scales: { y: { beginAtZero: true, title: { display: true, text: "MAE (lower is better)" } } },
					plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } },
				},
			});
			// ── Per-conversation baseline comparison chart ──
			cachedPerConv = { entries, aggregate };
			const compareSection = document.getElementById("eval-compare-section");
			compareSection.style.display = "";

			// Populate conversation dropdown
			const convSelect = document.getElementById("eval-compare-conv");
			const currentVal = convSelect.value;
			convSelect.innerHTML = '<option value="all">All Conversations</option>';
			for (const [id] of entries) {
				const opt = document.createElement("option");
				opt.value = id;
				opt.textContent = "Conv " + id;
				convSelect.appendChild(opt);
			}
			convSelect.value = currentVal && convSelect.querySelector(`option[value="${currentVal}"]`) ? currentVal : "all";

			renderCompareChart();

		} catch (err) {
			aggEl.style.display = "";
			aggEl.innerHTML = `<p class="error">Error: ${err.message}</p>`;
		} finally {
			evalBtn.disabled = false;
			evalBtn.innerHTML = "&#x21bb; Refresh";
		}
	}

	evalBtn.addEventListener("click", runEvaluation);

	// Wire up compare chart controls (re-render on dropdown change)
	document.getElementById("eval-compare-metric").addEventListener("change", renderCompareChart);
	document.getElementById("eval-compare-conv").addEventListener("change", renderCompareChart);

	function renderCompareChart() {
		if (!cachedPerConv) return;
		const { entries, aggregate } = cachedPerConv;

		const metricKey = document.getElementById("eval-compare-metric").value;
		const convVal = document.getElementById("eval-compare-conv").value;

		const metricLabels = { mae: "MAE", pc: "Pearson Correlation", accuracy: "Accuracy", mMae: "M-MAE" };
		const lowerIsBetter = metricKey === "mae" || metricKey === "mMae";

		// Baseline colors
		const COLORS = {
			mamcr:    { bg: "rgba(176, 138, 46, 0.7)",  border: "#b08a2e" },
			human:    { bg: "rgba(46, 122, 184, 0.6)",   border: "#2e7ab8" },
			gpt5mini: { bg: "rgba(126, 87, 194, 0.5)",   border: "#7e57c2" },
			gpt4omini:{ bg: "rgba(233, 30, 99, 0.4)",    border: "#e91e63" },
			gemini25: { bg: "rgba(56, 142, 60, 0.5)",    border: "#388e3c" },
			gemini20: { bg: "rgba(0, 150, 136, 0.4)",    border: "#009688" },
			random:   { bg: "rgba(158, 158, 158, 0.4)",  border: "#9e9e9e" },
			mode:     { bg: "rgba(121, 85, 72, 0.4)",    border: "#795548" },
		};

		if (convVal === "all") {
			// Show all conversations as bars, with baseline reference lines
			const labels = entries.map(([id]) => "Conv " + id);
			const mamcrData = entries.map(([, m]) => m[metricKey]);

			// Compute MAMCR average for reference line
			const mamcrValid = mamcrData.filter(v => v != null && !isNaN(v));
			const mamcrAvg = mamcrValid.length > 0 ? mamcrValid.reduce((a, b) => a + b, 0) / mamcrValid.length : null;

			// Build baseline datasets as flat lines for reference
			const baselineKeys = Object.keys(BASELINES).filter(k => {
				const val = BASELINES[k][metricKey];
				return val != null && !isNaN(val);
			});

			// Build reference lines: MAMCR average + paper baselines
			const refLines = [];
			if (mamcrAvg != null) {
				refLines.push({ value: mamcrAvg, color: COLORS.mamcr.border, label: "MAMCR Avg (" + mamcrAvg.toFixed(3) + ")" });
			}
			for (const k of baselineKeys) {
				refLines.push({ value: BASELINES[k][metricKey], color: COLORS[k]?.border || "#888", label: BASELINES[k].label + " (" + BASELINES[k][metricKey].toFixed(3) + ")" });
			}

			const datasets = [
				{
					label: "MAMCR Agent",
					data: mamcrData,
					backgroundColor: COLORS.mamcr.bg,
					borderColor: COLORS.mamcr.border,
					borderWidth: 1,
				},
			];

			if (compareChart) compareChart.destroy();
			compareChart = new Chart(document.getElementById("eval-compare-chart"), {
				type: "bar",
				data: { labels, datasets },
				options: {
					responsive: true,
					scales: { y: { beginAtZero: metricKey !== "pc", title: { display: true, text: metricLabels[metricKey] + (lowerIsBetter ? " (lower is better)" : " (higher is better)") } } },
					plugins: {
						legend: { display: false },
						annotation: refLines.length > 0 ? { lines: refLines } : undefined,
					},
				},
				plugins: [multiLinePlugin],
			});
		} else {
			// Single conversation: grouped bar comparing MAMCR vs all baselines
			const convMetrics = entries.find(([id]) => String(id) === convVal);
			if (!convMetrics) return;
			const mamcrVal = convMetrics[1][metricKey];

			const models = [
				{ key: "mamcr", label: "MAMCR Agent", value: mamcrVal },
				...Object.entries(BASELINES)
					.filter(([, b]) => b[metricKey] != null && !isNaN(b[metricKey]))
					.map(([k, b]) => ({ key: k, label: b.label, value: b[metricKey] })),
			];

			const labels = models.map(m => m.label);
			const data = models.map(m => m.value);
			const bgColors = models.map(m => COLORS[m.key]?.bg || "rgba(100,100,100,0.4)");
			const borderColors = models.map(m => COLORS[m.key]?.border || "#666");

			if (compareChart) compareChart.destroy();
			compareChart = new Chart(document.getElementById("eval-compare-chart"), {
				type: "bar",
				data: {
					labels,
					datasets: [{
						data,
						backgroundColor: bgColors,
						borderColor: borderColors,
						borderWidth: 1,
					}],
				},
				options: {
					responsive: true,
					scales: { y: { beginAtZero: metricKey !== "pc", title: { display: true, text: metricLabels[metricKey] + (lowerIsBetter ? " (lower is better)" : " (higher is better)") } } },
					plugins: { legend: { display: false } },
				},
			});
		}
	}

	renderContextChart();
	runEvaluation();

	function renderContextChart() {
		const datasets = CONTEXT_CATEGORIES.map(cat => ({
			label: cat.label,
			data: CONTEXT_BARS.map(bar => bar.values[cat.key] || 0),
			backgroundColor: cat.color,
		}));

		new Chart(document.getElementById("eval-context-chart"), {
			type: "bar",
			data: {
				labels: CONTEXT_BARS.map(b => b.label),
				datasets,
			},
			options: {
				indexAxis: "y",
				responsive: true,
				aspectRatio: 2.5,
				scales: {
					x: {
						stacked: true,
						title: { display: true, text: "Average chars of text context" },
						ticks: { callback: v => v >= 1000 ? (v / 1000).toFixed(0) + "K" : v },
					},
					y: { stacked: true },
				},
				plugins: {
					legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 }, padding: 12 } },
					tooltip: {
						filter: ctx => ctx.raw > 0,
						callbacks: {
							label: ctx => {
								const total = Object.values(CONTEXT_BARS[ctx.dataIndex].values).reduce((a, b) => a + b, 0);
								const pct = ((ctx.raw / total) * 100).toFixed(0);
								return `${ctx.dataset.label}: ${ctx.raw.toLocaleString()} chars (${pct}%)`;
							},
						},
					},
				},
			},
		});
	}

	// ── Helpers ──

	function fmt(n) {
		return n != null && !isNaN(n) ? n.toFixed(3) : "N/A";
	}

	/** Build a stat card with tooltip and baseline delta */
	function statCard(label, value, metricKey, direction) {
		const arrow = direction === "lower" ? "\u2193" : "\u2191";
		const humanVal = BASELINES.human[metricKey];
		let delta = "";
		if (value != null && !isNaN(value) && humanVal != null && !isNaN(humanVal)) {
			const diff = value - humanVal;
			const better = direction === "lower" ? diff < -0.005 : diff > 0.005;
			const worse = direction === "lower" ? diff > 0.005 : diff < -0.005;
			const sign = diff > 0 ? "+" : "";
			const cls = better ? "eval-delta-better" : worse ? "eval-delta-worse" : "eval-delta-neutral";
			delta = `<span class="eval-delta ${cls}">${sign}${diff.toFixed(3)} vs. human</span>`;
		}
		const tip = METRIC_HELP[metricKey] || "";
		return `
			<div class="stat-card" data-tooltip style="cursor:help;position:relative">
				<div class="label">${label} ${arrow}</div>
				<div class="value">${fmt(value)}</div>
				${delta}
				<div class="eval-tooltip">${tip}</div>
			</div>
		`;
	}

	/** Minimal plugin to draw a horizontal reference line (no chart.js annotation plugin needed) */
	const annotationLinePlugin = {
		id: "humanBaseline",
		afterDraw(chart) {
			const opts = chart.options.plugins.annotation;
			if (!opts) return;
			const { ctx, scales: { y } } = chart;
			const yPx = y.getPixelForValue(opts.value);
			ctx.save();
			ctx.strokeStyle = opts.color || "#2e7ab8";
			ctx.lineWidth = 2;
			ctx.setLineDash([6, 4]);
			ctx.beginPath();
			ctx.moveTo(chart.chartArea.left, yPx);
			ctx.lineTo(chart.chartArea.right, yPx);
			ctx.stroke();
			// label
			ctx.fillStyle = opts.color || "#2e7ab8";
			ctx.font = "600 11px Inter, sans-serif";
			ctx.textAlign = "right";
			ctx.fillText(opts.label || "", chart.chartArea.right - 4, yPx - 6);
			ctx.restore();
		},
	};

	function humanLine(val) {
		return { value: val, color: "#2e7ab8", label: "Human Asst. (" + val.toFixed(3) + ")" };
	}

	/** Plugin to draw multiple horizontal reference lines with label collision avoidance */
	const multiLinePlugin = {
		id: "multiBaseline",
		afterDraw(chart) {
			const opts = chart.options.plugins.annotation;
			if (!opts || !opts.lines) return;
			const { ctx, scales: { y } } = chart;
			ctx.save();

			const FONT = "600 10px Inter, sans-serif";
			const LABEL_H = 13; // line height for collision detection

			const items = opts.lines.map(line => ({
				text: line.label || "",
				color: line.color || "#888",
				lineY: y.getPixelForValue(line.value),
			}));

			// 1. Draw all dashed reference lines at true positions
			for (const item of items) {
				ctx.strokeStyle = item.color;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([5, 3]);
				ctx.beginPath();
				ctx.moveTo(chart.chartArea.left, item.lineY);
				ctx.lineTo(chart.chartArea.right, item.lineY);
				ctx.stroke();
			}

			// 2. Resolve label positions — sort top-to-bottom, push apart on overlap
			items.sort((a, b) => a.lineY - b.lineY);
			for (const item of items) item.labelY = item.lineY - 4;

			for (let i = 1; i < items.length; i++) {
				if (items[i].labelY - items[i - 1].labelY < LABEL_H) {
					items[i].labelY = items[i - 1].labelY + LABEL_H;
				}
			}

			// 3. Draw labels + thin connector when a label was displaced
			const rightEdge = chart.chartArea.right;
			ctx.font = FONT;
			ctx.textAlign = "right";
			ctx.setLineDash([]);

			for (const item of items) {
				const displaced = Math.abs(item.labelY - (item.lineY - 4));
				if (displaced > 3) {
					ctx.strokeStyle = item.color;
					ctx.lineWidth = 0.7;
					ctx.globalAlpha = 0.45;
					ctx.beginPath();
					ctx.moveTo(rightEdge - 3, item.labelY + 1);
					ctx.lineTo(rightEdge - 1, item.lineY);
					ctx.stroke();
					ctx.globalAlpha = 1;
				}
				ctx.fillStyle = item.color;
				ctx.fillText(item.text, rightEdge - 4, item.labelY);
			}

			ctx.restore();
		},
	};
})();
