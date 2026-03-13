// Simulate tab — run individual or batch conversation simulations
// Two-panel layout: timeline (left) + context panel (right)
(async function initSimulateTab() {
	const root = document.getElementById("simulate-content");

	const [convs, users] = await Promise.all([
		window.mamcr.listConversations(),
		window.mamcr.listUsers(),
	]);

	root.innerHTML = `
		<div class="action-bar">
			<div class="action-group">
				<label for="sim-conv-select">Conversation:</label>
				<select id="sim-conv-select">
					${convs.map((c) => `<option value="${c.conv_id}">Conv ${c.conv_id} (${c.user_id}, Cat ${c.catalogue})</option>`).join("")}
				</select>
				<button class="action-btn" id="sim-run-btn">Run Simulation</button>
			</div>
		</div>

		<div class="sim-layout" id="sim-layout" style="display:none">
			<div class="sim-main" id="sim-main">
				<div class="sim-timeline" id="sim-timeline"></div>
			</div>
			<div class="sim-context" id="sim-context">
				<h3>Injected Context</h3>
				<div id="sim-context-cards"></div>
			</div>
		</div>

		<div id="sim-results" style="display:none">
			<h3 class="results-title">Results</h3>
			<div id="sim-results-content"></div>
		</div>

		<hr class="divider">

		<h3 class="results-title">Batch Simulation</h3>
		<div class="action-bar">
			<div class="action-group">
				<label for="sim-batch-user">User (optional):</label>
				<select id="sim-batch-user">
					<option value="">All users</option>
					${users.map((u) => `<option value="${u.user_id}">${u.user_id}</option>`).join("")}
				</select>
				<button class="action-btn" id="sim-batch-btn">Run Batch</button>
			</div>
		</div>

		<div class="log-area" id="sim-batch-log"></div>
	`;

	const layout = document.getElementById("sim-layout");
	const timeline = document.getElementById("sim-timeline");
	const contextCards = document.getElementById("sim-context-cards");
	const resultsEl = document.getElementById("sim-results");
	const resultsContent = document.getElementById("sim-results-content");
	const runBtn = document.getElementById("sim-run-btn");
	const batchBtn = document.getElementById("sim-batch-btn");
	const batchLog = document.getElementById("sim-batch-log");

	let unsub = null;

	// ── Helpers ──

	function addEvent(html) {
		timeline.insertAdjacentHTML("beforeend", html);
		// Auto-scroll main panel
		const main = document.getElementById("sim-main");
		main.scrollTop = main.scrollHeight;
	}

	function updateContextCard(label, source, content) {
		const id = "ctx-" + label.replace(/\s+/g, "-").toLowerCase();
		let card = document.getElementById(id);

		if (card) {
			card.querySelector(".sim-ctx-source").textContent = source;
			card.querySelector("pre").textContent = content;
			card.classList.add("sim-ctx-updated");
			setTimeout(() => card.classList.remove("sim-ctx-updated"), 1200);
		} else {
			contextCards.insertAdjacentHTML("beforeend", `
				<div class="sim-context-card expanded" id="${id}">
					<div class="sim-ctx-header" onclick="this.parentElement.classList.toggle('expanded')">
						<span class="sim-ctx-label">${escapeHtml(label)}</span>
						<span class="sim-ctx-source">${escapeHtml(source)}</span>
						<span class="sim-ctx-chevron">&#9660;</span>
					</div>
					<div class="sim-ctx-body"><pre>${escapeHtml(content)}</pre></div>
				</div>
			`);
		}
	}

	function formatArgs(args) {
		if (!args || (typeof args === "object" && Object.keys(args).length === 0)) return "(none)";
		return typeof args === "string" ? args : JSON.stringify(args, null, 2);
	}

	function truncateResult(text, max) {
		max = max || 2000;
		if (typeof text !== "string") {
			try { text = JSON.stringify(text, null, 2); } catch { text = String(text); }
		}
		return text.length > max ? text.slice(0, max) + "\n… [truncated]" : text;
	}

	function agentColor(agent) {
		if (agent === "conversation") return "conv";
		if (agent === "preference") return "pref";
		if (agent === "history") return "hist";
		return "conv";
	}

	// ── Event handler ──

	function handleSimEvent(event) {
		switch (event.type) {
			case "status":
				addEvent(`<div class="sim-ev sim-ev-status">${escapeHtml(event.message)}</div>`);
				break;

			case "turn_start":
				addEvent(`<div class="sim-ev sim-ev-turn">Turn ${event.turn}</div>`);
				break;

			case "seeker":
				addEvent(`
					<div class="sim-ev sim-ev-seeker">
						<span class="role-badge Seeker">Seeker</span>
						<div class="sim-ev-content">${escapeHtml(event.content)}</div>
					</div>
				`);
				break;

			case "assistant":
				addEvent(`
					<div class="sim-ev sim-ev-assistant">
						<span class="role-badge Assistant">Assistant</span>
						<div class="sim-ev-content">${escapeHtml(event.content)}</div>
					</div>
				`);
				break;

			case "tool_call": {
				const cls = agentColor(event.agent);
				addEvent(`
					<div class="sim-ev sim-ev-tool sim-ev-tool--${cls}">
						<div class="sim-ev-tool-head" onclick="this.parentElement.classList.toggle('expanded')">
							<span class="sim-ev-tool-agent sim-ev-tool-agent--${cls}">${event.agent}</span>
							<span class="sim-ev-tool-name">${escapeHtml(event.tool)}</span>
							<span class="sim-ev-tool-chevron">&#9654;</span>
						</div>
						<div class="sim-ev-tool-detail">
							<div class="sim-ev-tool-section">
								<div class="sim-ev-tool-label">Arguments</div>
								<pre>${escapeHtml(formatArgs(event.args))}</pre>
							</div>
							<div class="sim-ev-tool-section">
								<div class="sim-ev-tool-label">Result</div>
								<pre>${escapeHtml(truncateResult(event.result))}</pre>
							</div>
						</div>
					</div>
				`);
				break;
			}

			case "agent_output": {
				const phaseLabel = event.phase === "cold_start" ? "Cold Start"
					: event.phase === "monitor" ? "Monitor"
					: event.phase === "observe" ? "Observation"
					: event.phase;
				addEvent(`
					<div class="sim-ev sim-ev-agent-out">
						<div class="sim-ev-agent-out-head" onclick="this.parentElement.classList.toggle('expanded')">
							<span class="sim-ev-agent-out-badge">${escapeHtml(event.agent)}</span>
							<span class="sim-ev-agent-out-phase">${escapeHtml(phaseLabel)}</span>
							<span class="sim-ev-tool-chevron">&#9654;</span>
						</div>
						<div class="sim-ev-agent-out-body">${escapeHtml(event.content)}</div>
					</div>
				`);
				break;
			}

			case "context":
				updateContextCard(event.label, event.source, event.content);
				break;
		}
	}

	// ── Single simulation ──

	runBtn.addEventListener("click", async () => {
		const convId = parseInt(document.getElementById("sim-conv-select").value);
		timeline.innerHTML = "";
		contextCards.innerHTML = "";
		layout.style.display = "";
		resultsEl.style.display = "none";
		runBtn.disabled = true;
		runBtn.textContent = "Running...";

		if (unsub) unsub();
		unsub = window.mamcr.onSimEvent(handleSimEvent);

		try {
			const result = await window.mamcr.runSimulation(convId);

			resultsEl.style.display = "";
			resultsContent.innerHTML = `
				<div class="stats-grid">
					<div class="stat-card"><div class="label">Conv ID</div><div class="value">${result.convId}</div></div>
					<div class="stat-card"><div class="label">User</div><div class="value">${result.userId}</div></div>
					<div class="stat-card"><div class="label">Turns</div><div class="value">${result.transcript.length}</div></div>
					<div class="stat-card"><div class="label">Tool Calls</div><div class="value">${result.toolCalls.length}</div></div>
				</div>

				<h4 class="results-title">Predictions</h4>
				<div class="metrics-table">
					<table>
						<thead><tr><th>Item ID</th><th>Predicted Rating</th></tr></thead>
						<tbody>
							${Object.entries(result.predictions)
								.map(([id, r]) => `<tr><td>${id}</td><td>${r}</td></tr>`)
								.join("")}
						</tbody>
					</table>
				</div>
			`;
		} catch (err) {
			addEvent(`<div class="sim-ev sim-ev-status" style="color:var(--assistant)">Error: ${escapeHtml(err.message)}</div>`);
		} finally {
			runBtn.disabled = false;
			runBtn.textContent = "Run Simulation";
			if (unsub) {
				unsub();
				unsub = null;
			}
		}
	});

	// ── Batch simulation ──

	batchBtn.addEventListener("click", async () => {
		const userId = document.getElementById("sim-batch-user").value || undefined;
		batchLog.textContent = `Starting batch simulation${userId ? " for " + userId : ""}...\n`;
		batchBtn.disabled = true;
		batchBtn.textContent = "Running...";

		try {
			const results = await window.mamcr.batchSimulate(userId);
			batchLog.textContent += `\nCompleted: ${results.length} conversations simulated.\n`;
			for (const r of results) {
				batchLog.textContent += `  Conv ${r.convId}: ${r.transcript.length} turns, ${Object.keys(r.predictions).length} predictions\n`;
			}
		} catch (err) {
			batchLog.textContent += "\nError: " + err.message + "\n";
		} finally {
			batchBtn.disabled = false;
			batchBtn.textContent = "Run Batch";
		}
	});
})();
