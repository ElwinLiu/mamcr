// Evaluate tab — run evaluation, display metrics and charts
(async function initEvaluateTab() {
	const root = document.getElementById("evaluate-content");

	root.innerHTML = `
		<div class="action-bar">
			<button class="action-btn" id="eval-all-btn">Evaluate All</button>
		</div>

		<div id="eval-aggregate" style="display:none"></div>

		<div class="chart-row" id="eval-charts" style="display:none">
			<div class="chart-card">
				<h3>MAE by Conversation</h3>
				<canvas id="eval-mae-chart"></canvas>
			</div>
			<div class="chart-card">
				<h3>MAE by Rating Class</h3>
				<canvas id="eval-class-chart"></canvas>
			</div>
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

	let maeChart = null;
	let classChart = null;

	evalBtn.addEventListener("click", async () => {
		evalBtn.disabled = true;
		evalBtn.textContent = "Evaluating...";

		try {
			const { perConv, aggregate } = await window.mamcr.evaluateAll();

			// Aggregate metrics cards
			aggEl.style.display = "";
			aggEl.innerHTML = `
				<div class="stats-grid">
					<div class="stat-card"><div class="label">MAE ↓</div><div class="value">${fmt(aggregate.mae)}</div></div>
					<div class="stat-card"><div class="label">Pearson ↑</div><div class="value">${fmt(aggregate.pc)}</div></div>
					<div class="stat-card"><div class="label">Accuracy ↑</div><div class="value">${fmt(aggregate.accuracy)}</div></div>
					<div class="stat-card"><div class="label">M-MAE ↓</div><div class="value">${fmt(aggregate.mMae)}</div></div>
					<div class="stat-card"><div class="label">N</div><div class="value">${aggregate.n}</div></div>
				</div>
			`;

			// Per-conversation table
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

			// Charts
			chartsEl.style.display = "";

			if (maeChart) maeChart.destroy();
			maeChart = new Chart(document.getElementById("eval-mae-chart"), {
				type: "bar",
				data: {
					labels: entries.map(([id]) => "Conv " + id),
					datasets: [
						{
							label: "MAE",
							data: entries.map(([, m]) => m.mae),
							backgroundColor: "rgba(176, 138, 46, 0.6)",
							borderColor: "#b08a2e",
							borderWidth: 1,
						},
					],
				},
				options: {
					responsive: true,
					scales: { y: { beginAtZero: true } },
					plugins: { legend: { display: false } },
				},
			});

			const classLabels = [1, 2, 3, 4, 5].map((k) => "GT=" + k);
			const classValues = [1, 2, 3, 4, 5].map((k) => aggregate.maeByClass[k] ?? null);

			if (classChart) classChart.destroy();
			classChart = new Chart(document.getElementById("eval-class-chart"), {
				type: "bar",
				data: {
					labels: classLabels,
					datasets: [
						{
							label: "MAE",
							data: classValues,
							backgroundColor: "rgba(46, 122, 184, 0.6)",
							borderColor: "#2e7ab8",
							borderWidth: 1,
						},
					],
				},
				options: {
					responsive: true,
					scales: { y: { beginAtZero: true } },
					plugins: { legend: { display: false } },
				},
			});
		} catch (err) {
			aggEl.style.display = "";
			aggEl.innerHTML = `<p class="error">Error: ${err.message}</p>`;
		} finally {
			evalBtn.disabled = false;
			evalBtn.textContent = "Evaluate All";
		}
	});

	function fmt(n) {
		return n != null && !isNaN(n) ? n.toFixed(3) : "N/A";
	}
})();
