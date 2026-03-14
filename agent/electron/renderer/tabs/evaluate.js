// Evaluate tab — run evaluation, display metrics and charts
(async function initEvaluateTab() {
	const root = document.getElementById("evaluate-content");

	// Baselines from the VOGUE paper (Table 5)
	const BASELINES = {
		human:       { label: "Human Assistants", mae: 0.896, pc: 0.636, accuracy: 0.397, mMae: 0.849, maeByClass: { 1: 0.746, 2: 0.891, 3: 1.171, 4: 1.284, 5: 0.597 } },
		gpt5mini:    { label: "GPT-5-mini",       mae: 1.296, pc: 0.083, accuracy: 0.344, mMae: 1.543, maeByClass: { 1: 1.041, 2: 0.845, 3: 1.209, 4: 2.222, 5: 2.516 } },
		gpt4omini:   { label: "GPT-4o-mini",      mae: 1.619, pc: 0.000, accuracy: 0.156, mMae: 1.491, maeByClass: { 1: 2.160, 2: 1.186, 3: 0.953, 4: 1.160, 5: 1.726 } },
		gemini25:    { label: "Gemini-2.5-Flash",  mae: 1.356, pc: 0.057, accuracy: 0.406, mMae: 1.681, maeByClass: { 1: 0.853, 2: 0.930, 3: 1.628, 4: 2.444, 5: 2.839 } },
		gemini20:    { label: "Gemini-2.0-Flash",  mae: 1.356, pc: 0.041, accuracy: 0.402, mMae: 1.772, maeByClass: { 1: 0.693, 2: 1.031, 3: 1.736, 4: 2.568, 5: 3.065 } },
		random:      { label: "Random",            mae: 1.713, pc:-0.005, accuracy: 0.240, mMae: 1.730, maeByClass: { 1: 1.997, 2: 1.403, 3: 1.147, 4: 1.469, 5: 2.387 } },
		mode:        { label: "Mode Rating",       mae: 1.219, pc: null,  accuracy: 0.443, mMae: 1.932, maeByClass: { 1: 0.000, 2: 1.000, 3: 2.000, 4: 3.000, 5: 4.000 } },
	};

	const METRIC_HELP = {
		mae:      "Mean Absolute Error — average distance between predicted and actual ratings (1\u20135 scale). Lower is better. A perfect predictor scores 0; random guessing scores ~1.7.",
		pc:       "Pearson Correlation — measures how well predictions track the direction of preferences (-1 to 1). Higher is better. Human assistants average 0.64; MLLMs score near 0.",
		accuracy: "Exact-match accuracy — fraction of items where the rounded prediction equals the ground-truth rating. Higher is better. The mode baseline (always predict 1) scores 0.44 due to class imbalance.",
		mMae:     "Macro-averaged MAE — MAE computed per rating class (1\u20135) then averaged, giving equal weight to rare and common ratings. Lower is better. More robust than MAE when classes are imbalanced.",
	};

	root.innerHTML = `
		<div class="action-bar">
			<button class="action-btn" id="eval-all-btn" title="Refresh evaluation">&#x21bb; Refresh</button>
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
		} catch (err) {
			aggEl.style.display = "";
			aggEl.innerHTML = `<p class="error">Error: ${err.message}</p>`;
		} finally {
			evalBtn.disabled = false;
			evalBtn.innerHTML = "&#x21bb; Refresh";
		}
	}

	evalBtn.addEventListener("click", runEvaluation);
	runEvaluation();

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
})();
