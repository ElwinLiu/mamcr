// Browse tab — conversations, items, users
(async function initBrowseTab() {
	const root = document.getElementById("browse-content");

	root.innerHTML = `
		<div class="filter-bar" id="browse-filter">
			<button class="filter-btn active" data-view="conversations">Conversations</button>
			<button class="filter-btn" data-view="items">Items</button>
			<button class="filter-btn" data-view="users">Users</button>
		</div>
		<div id="browse-view-conversations"></div>
		<div id="browse-view-items" style="display:none"></div>
		<div id="browse-view-users" style="display:none"></div>
	`;

	// Sub-view switching
	const filterBtns = root.querySelectorAll("#browse-filter .filter-btn");
	filterBtns.forEach((btn) => {
		btn.addEventListener("click", () => {
			const view = btn.dataset.view;
			filterBtns.forEach((b) => b.classList.remove("active"));
			btn.classList.add("active");
			document.getElementById("browse-view-conversations").style.display =
				view === "conversations" ? "" : "none";
			document.getElementById("browse-view-items").style.display =
				view === "items" ? "" : "none";
			document.getElementById("browse-view-users").style.display =
				view === "users" ? "" : "none";
		});
	});

	// Load all data
	const [convs, items, users] = await Promise.all([
		window.mamcr.listConversations(),
		window.mamcr.listItems(),
		window.mamcr.listUsers(),
	]);

	// ── Conversations ──
	const convsEl = document.getElementById("browse-view-conversations");
	convsEl.innerHTML = `
		<div class="conv-layout">
			<div class="conv-sidebar" id="conv-sidebar">
				${convs
					.map(
						(c) => `
					<div class="conv-item" data-id="${c.conv_id}">
						<div class="conv-title">Conv ${c.conv_id}</div>
						<div class="conv-meta">${c.user_id} · Scenario ${c.scenario_id} · Cat ${c.catalogue} · ${c.turn_count} turns</div>
					</div>`,
					)
					.join("")}
			</div>
			<div class="conv-main" id="conv-main">
				<div class="conv-placeholder">Select a conversation</div>
			</div>
		</div>
	`;

	document.getElementById("conv-sidebar").addEventListener("click", async (e) => {
		const item = e.target.closest(".conv-item");
		if (!item) return;
		const convId = parseInt(item.dataset.id);

		document
			.querySelectorAll("#conv-sidebar .conv-item")
			.forEach((i) => i.classList.remove("active"));
		item.classList.add("active");

		const data = await window.mamcr.getConversation(convId);
		const main = document.getElementById("conv-main");

		if (!data.conv) {
			main.innerHTML = '<div class="conv-placeholder">Conversation not found</div>';
			return;
		}

		const c = data.conv;
		let html = `
			<div class="conv-info">
				<h2>Conversation ${c.conv_id}</h2>
				<div class="conv-details">
					<span>User: <strong>${c.user_id}</strong></span>
					<span>Scenario: <strong>${c.scenario_id}</strong></span>
					<span>Catalogue: <strong>${c.catalogue}</strong></span>
				</div>
				${data.scenario ? `<div class="conv-scenario">${escapeHtml(data.scenario.body)}</div>` : ""}
				${c.summary ? `<div class="conv-summary">${escapeHtml(c.summary)}</div>` : ""}
			</div>
			<div class="transcript">
		`;

		for (const t of data.turns) {
			let tags = [];
			try {
				tags = t.tags ? JSON.parse(t.tags) : [];
			} catch {
				/* ignore */
			}
			html += `
				<div class="turn">
					<div class="turn-header">
						<span class="role-badge ${t.role}">${t.role}</span>
						<span>Turn ${t.turn}</span>
					</div>
					<div class="utterances">
						<div class="utterance">${escapeHtml(t.content)}</div>
						${
							tags.length
								? `<div class="tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
								: ""
						}
					</div>
				</div>
			`;
		}

		html += "</div>";

		if (data.prefs.length) {
			html += `
				<div style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid var(--border);">
					<h3 style="font-size:0.85rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:0.75rem;">Extracted Preferences</h3>
					${data.prefs.map((p) => `<div class="pref-item"><div class="pref-desc">${escapeHtml(p.description)}</div></div>`).join("")}
				</div>
			`;
		}

		main.innerHTML = html;
	});

	// ── Items ──
	const itemsEl = document.getElementById("browse-view-items");
	const catalogues = [...new Set(items.map((i) => i.catalogue))].sort();

	itemsEl.innerHTML = `
		<div class="filter-bar" id="items-filter">
			<button class="filter-btn active" data-cat="all">All</button>
			${catalogues.map((c) => `<button class="filter-btn" data-cat="${c}">Catalogue ${c.toUpperCase()}</button>`).join("")}
		</div>
		<div class="items-grid" id="items-grid">
			${items.map(renderItemCard).join("")}
		</div>
	`;

	document.getElementById("items-filter").addEventListener("click", (e) => {
		const btn = e.target.closest(".filter-btn");
		if (!btn) return;
		const cat = btn.dataset.cat;

		document
			.querySelectorAll("#items-filter .filter-btn")
			.forEach((b) => b.classList.remove("active"));
		btn.classList.add("active");

		document.querySelectorAll("#items-grid .item-card").forEach((card) => {
			card.style.display = cat === "all" || card.dataset.cat === cat ? "" : "none";
		});
	});

	// ── Users ──
	const usersEl = document.getElementById("browse-view-users");
	usersEl.innerHTML = `
		<div class="users-grid">
			${users
				.map(
					(u) => `
				<div class="user-card">
					<div class="u-header">
						<span class="u-id">${u.user_id}</span>
						<span class="u-role">Seeker</span>
					</div>
					<div class="u-style">${escapeHtml(u.style_preferences) || "N/A"}</div>
					<div class="u-vibes">${escapeHtml(u.style_vibes) || ""}</div>
					<div class="u-meta">
						<span><span class="meta-label">Frequency:</span><span class="meta-value">${u.purchase_frequency || "N/A"}</span></span>
						<span><span class="meta-label">Budget:</span><span class="meta-value">${u.monthly_spend || "N/A"}</span></span>
						<span><span class="meta-label">Colors:</span><span class="meta-value">${u.best_colors || "N/A"}</span></span>
						<span><span class="meta-label">Feel:</span><span class="meta-value">${u.clothing_feel || "N/A"}</span></span>
					</div>
					<div class="u-meta">
						<span><span class="meta-label">Conversations:</span><span class="meta-value">${u.conv_count}</span></span>
						<span><span class="meta-label">Preferences:</span><span class="meta-value">${u.pref_count}</span></span>
					</div>
				</div>`,
				)
				.join("")}
		</div>
	`;

	function renderItemCard(item) {
		let cats = [];
		try {
			const parsed = item.categories ? JSON.parse(item.categories) : [];
			cats = Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			cats = item.categories ? [item.categories] : [];
		}
		const catTags = cats.map((c) => `<span class="cat-tag">${escapeHtml(c)}</span>`).join("");

		return `
			<div class="item-card" data-cat="${item.catalogue}">
				<div class="item-header">
					<span class="item-id">ID ${item.item_id} · Cat ${item.catalogue.toUpperCase()}</span>
					<span class="item-rating">${item.rating ? "★ " + item.rating : ""}</span>
				</div>
				<div class="item-name">${escapeHtml(item.name)}</div>
				<div class="item-brand">${escapeHtml(item.brand || "")}</div>
				${catTags ? `<div class="item-categories">${catTags}</div>` : ""}
				<div class="item-desc">${escapeHtml((item.description || "").slice(0, 200))}${(item.description || "").length > 200 ? "..." : ""}</div>
			</div>
		`;
	}
})();
