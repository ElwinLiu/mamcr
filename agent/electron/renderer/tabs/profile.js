// Profile tab — user taste profiles with radar chart and preferences
(async function initProfileTab() {
	const root = document.getElementById("profile-content");

	const users = await window.mamcr.listUsers();

	root.innerHTML = `
		<div class="prefs-layout">
			<div class="prefs-sidebar" id="profile-sidebar">
				${users
					.map(
						(u) => `
					<div class="pref-user-item" data-id="${u.user_id}">
						<div class="pref-user-id">${u.user_id}</div>
						<div class="pref-user-count">${u.pref_count} preferences · ${u.conv_count} conversations</div>
					</div>`,
					)
					.join("")}
			</div>
			<div class="prefs-main" id="profile-main">
				<div class="conv-placeholder">Select a user to view their taste profile</div>
			</div>
		</div>
	`;

	let radarChart = null;

	document.getElementById("profile-sidebar").addEventListener("click", async (e) => {
		const item = e.target.closest(".pref-user-item");
		if (!item) return;
		const userId = item.dataset.id;

		document
			.querySelectorAll("#profile-sidebar .pref-user-item")
			.forEach((i) => i.classList.remove("active"));
		item.classList.add("active");

		const { user, prefs } = await window.mamcr.getTasteProfile(userId);
		const main = document.getElementById("profile-main");

		if (!user) {
			main.innerHTML = '<div class="conv-placeholder">User not found</div>';
			return;
		}

		const weights = [
			{ label: "Comfort", value: user.comfort },
			{ label: "Style", value: user.style },
			{ label: "Practicality", value: user.practicality },
			{ label: "Trends", value: user.trends },
			{ label: "Brand", value: user.brand },
			{ label: "Self-expr", value: user.self_expression },
			{ label: "Sustain.", value: user.sustainability },
			{ label: "Price", value: user.price },
			{ label: "Color", value: user.color_importance },
		];

		main.innerHTML = `
			<div class="user-card" style="border:none; padding:0;">
				<div class="u-header">
					<span class="u-id">${user.user_id}</span>
					<span class="u-role">Seeker</span>
				</div>
				<div class="u-style">${escapeHtml(user.style_preferences) || "N/A"}</div>
				<div class="u-vibes">${escapeHtml(user.style_vibes) || ""}</div>
				<div class="u-meta">
					<span><span class="meta-label">Frequency:</span><span class="meta-value">${user.purchase_frequency || "N/A"}</span></span>
					<span><span class="meta-label">Budget:</span><span class="meta-value">${user.monthly_spend || "N/A"}</span></span>
					<span><span class="meta-label">Colors:</span><span class="meta-value">${user.best_colors || "N/A"}</span></span>
					<span><span class="meta-label">Feel:</span><span class="meta-value">${user.clothing_feel || "N/A"}</span></span>
				</div>
			</div>

			<div class="chart-card" style="margin-top:1.5rem;">
				<h3>Importance Weights</h3>
				<div style="height:300px; display:flex; justify-content:center;">
					<canvas id="profile-radar"></canvas>
				</div>
			</div>

			${
				prefs.length
					? `
				<div style="margin-top:1.5rem;">
					<h3 style="font-size:0.85rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.75rem;">
						Extracted Preferences (${prefs.length})
					</h3>
					${prefs
						.map(
							(p) => `
						<div class="pref-item">
							<div class="pref-source">from conv ${p.source_conv_id}</div>
							<div class="pref-desc">${escapeHtml(p.description)}</div>
						</div>`,
						)
						.join("")}
				</div>`
					: '<p class="placeholder" style="margin-top:1rem;">No extracted preferences yet.</p>'
			}
		`;

		// Radar chart
		if (radarChart) radarChart.destroy();
		radarChart = new Chart(document.getElementById("profile-radar"), {
			type: "radar",
			data: {
				labels: weights.map((w) => w.label),
				datasets: [
					{
						label: user.user_id,
						data: weights.map((w) => w.value || 0),
						backgroundColor: "rgba(176, 138, 46, 0.2)",
						borderColor: "#b08a2e",
						pointBackgroundColor: "#b08a2e",
						borderWidth: 2,
					},
				],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				scales: {
					r: {
						min: 0,
						max: 5,
						ticks: { stepSize: 1 },
					},
				},
				plugins: { legend: { display: false } },
			},
		});
	});
})();
