// MAMCR SQLite Database Explorer
(async function () {
  const res = await fetch('data.json');
  const DATA = await res.json();

  const CATALOGUE_NAMES = { a: 'Outerwear', b: 'Layering', c: 'Shoes' };
  const PALETTE = [
    '#c9a44c', '#5b9bd5', '#e07b54', '#6bc785', '#c26dbc',
    '#d4d45a', '#5bcfcf', '#e06080', '#8888cc', '#cc8844',
  ];

  Chart.defaults.color = '#666';
  Chart.defaults.borderColor = '#d5d5d5';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 12;

  const initialized = {};

  // Navigation
  document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const id = link.dataset.section;
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-links a').forEach(l => l.classList.remove('active'));
      document.getElementById(id).classList.add('active');
      link.classList.add('active');
      window.scrollTo(0, 0);
      initSection(id);
    });
  });

  function initSection(id) {
    if (initialized[id]) return;
    initialized[id] = true;
    switch (id) {
      case 'overview': renderStats(); renderOverviewCharts(); break;
      case 'catalogue': renderItems('all'); initCatalogueFilters(); break;
      case 'users': renderUsers(); break;
      case 'conversations': renderConversationList(); break;
      case 'preferences': renderPreferencesSidebar(); break;
      case 'analysis': renderAnalysis(); break;
    }
  }

  initSection('overview');

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Overview ──
  function renderStats() {
    const s = DATA.stats;
    const grid = document.getElementById('stats-grid');
    const cards = [
      { label: 'Conversations', value: s.totalConversations },
      { label: 'Users', value: s.totalUsers },
      { label: 'Items', value: s.totalItems },
      { label: 'Total Turns', value: s.totalTurns },
      { label: 'Avg Turns / Conv', value: s.avgTurnsPerConversation },
      { label: 'Ratings', value: s.totalRatings },
      { label: 'Preferences', value: s.totalPreferences },
      { label: 'Dialogue Acts', value: Object.keys(s.tagCounts).length },
    ];
    grid.innerHTML = cards.map(c => `
      <div class="stat-card">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
      </div>
    `).join('');
  }

  function renderOverviewCharts() {
    const s = DATA.stats;

    // Conversation lengths histogram
    const lengths = s.conversationLengths;
    const bins = {};
    lengths.forEach(l => {
      const bin = Math.floor(l / 5) * 5;
      const label = `${bin}-${bin + 4}`;
      bins[label] = (bins[label] || 0) + 1;
    });
    new Chart(document.getElementById('chart-conv-lengths'), {
      type: 'bar',
      data: {
        labels: Object.keys(bins),
        datasets: [{ label: 'Conversations', data: Object.values(bins), backgroundColor: '#c9a44c88', borderColor: '#c9a44c', borderWidth: 1 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Count' } }, x: { title: { display: true, text: 'Turns' } } } }
    });

    // Top dialogue acts
    const tags = Object.entries(s.tagCounts).slice(0, 15);
    new Chart(document.getElementById('chart-dialogue-acts'), {
      type: 'bar',
      data: {
        labels: tags.map(t => t[0]),
        datasets: [{ label: 'Occurrences', data: tags.map(t => t[1]), backgroundColor: '#5b9bd588', borderColor: '#5b9bd5', borderWidth: 1 }]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });

    // Rating distribution (doughnut)
    const rd = s.ratingDistribution;
    new Chart(document.getElementById('chart-rating-dist'), {
      type: 'doughnut',
      data: {
        labels: ['1 - Dislike', '2 - Below Avg', '3 - Neutral', '4 - Like', '5 - Love'],
        datasets: [{
          data: [rd['1'] || 0, rd['2'] || 0, rd['3'] || 0, rd['4'] || 0, rd['5'] || 0],
          backgroundColor: ['#e06080', '#e07b54', '#d4d45a', '#6bc785', '#5b9bd5'],
          borderColor: '#ffffff',
          borderWidth: 2,
        }]
      },
      options: { plugins: { legend: { position: 'right', labels: { font: { size: 11 }, padding: 12 } } } }
    });

    // Avg rating per user
    const uar = s.userAvgRatings;
    const userIds = Object.keys(uar).sort();
    new Chart(document.getElementById('chart-user-avg-rating'), {
      type: 'bar',
      data: {
        labels: userIds.map(u => u.toUpperCase()),
        datasets: [{
          label: 'Avg Rating',
          data: userIds.map(u => uar[u]),
          backgroundColor: userIds.map((_, i) => PALETTE[i % PALETTE.length] + '88'),
          borderColor: userIds.map((_, i) => PALETTE[i % PALETTE.length]),
          borderWidth: 1,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 5, title: { display: true, text: 'Avg Rating' } } }
      }
    });
  }

  // ── Catalogue ──
  function initCatalogueFilters() {
    document.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cat]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderItems(btn.dataset.cat);
      });
    });
  }

  function renderItems(cat) {
    const grid = document.getElementById('items-grid');
    const items = cat === 'all' ? DATA.items : DATA.items.filter(i => i.catalogue === cat);
    grid.innerHTML = items.map(item => {
      const cats = Array.isArray(item.categories) ? item.categories.slice(-3) : [];
      const about = Array.isArray(item.about) ? item.about.filter(a => !String(a).startsWith('Key words')) : [];
      return `
        <div class="item-card">
          <div class="item-header">
            <span class="item-id">Item ${item.item_id} &bull; Cat ${item.catalogue.toUpperCase()}</span>
            <span class="item-rating">${item.rating ? item.rating + ' / 5' : ''}</span>
          </div>
          <div class="item-name">${escHtml(item.name)}</div>
          <div class="item-brand">${escHtml((item.brand || '').replace('Visit the ', '').replace(' Store', ''))}</div>
          <div class="item-categories">${cats.map(c => `<span class="cat-tag">${escHtml(c)}</span>`).join('')}</div>
          ${item.description ? `<div class="item-desc">${escHtml(item.description.substring(0, 200))}${item.description.length > 200 ? '...' : ''}</div>` : ''}
          ${about.length ? `<ul class="item-about">${about.slice(0, 5).map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>` : ''}
        </div>`;
    }).join('');
  }

  // ── Users ──
  const radarCharts = {};

  function renderUsers() {
    const grid = document.getElementById('users-grid');
    Object.values(radarCharts).forEach(c => { try { c.destroy(); } catch(e) {} });
    for (const k in radarCharts) delete radarCharts[k];

    grid.innerHTML = DATA.users.map(u => {
      const avgRating = DATA.stats.userAvgRatings[u.user_id];
      const prefCount = DATA.stats.prefsPerUser[u.user_id] || 0;
      return `
        <div class="user-card">
          <div class="u-header">
            <span class="u-id">${escHtml(u.user_id.toUpperCase())}</span>
            <span class="u-role">Seeker</span>
          </div>
          <div class="u-style">${escHtml(u.style_preferences)}</div>
          <div class="u-vibes">${escHtml(u.style_vibes)}</div>
          <div class="u-meta">
            <span><span class="meta-label">Purchase:</span><span class="meta-value">${escHtml(u.purchase_frequency)}</span></span>
            <span><span class="meta-label">Budget:</span><span class="meta-value">${escHtml(u.monthly_spend)}</span></span>
            <span><span class="meta-label">Colors:</span><span class="meta-value">${escHtml(u.best_colors)}</span></span>
            <span><span class="meta-label">Feel:</span><span class="meta-value">${escHtml(u.clothing_feel)}</span></span>
            <span><span class="meta-label">Avg Rating:</span><span class="meta-value">${avgRating || 'N/A'}</span></span>
            <span><span class="meta-label">Preferences:</span><span class="meta-value">${prefCount}</span></span>
          </div>
          <div class="radar-container"><canvas id="radar-${u.user_id}"></canvas></div>
        </div>`;
    }).join('');

    requestAnimationFrame(() => {
      const dims = ['comfort', 'style', 'practicality', 'trends', 'brand', 'self_expression', 'sustainability', 'price', 'color_importance'];
      const dimLabels = ['Comfort', 'Style', 'Practicality', 'Trends', 'Brand', 'Self Expr.', 'Sustain.', 'Price', 'Color'];
      DATA.users.forEach(u => {
        const canvas = document.getElementById(`radar-${u.user_id}`);
        if (!canvas) return;
        const vals = dims.map(d => parseInt(u[d]) || 0);
        radarCharts[u.user_id] = new Chart(canvas, {
          type: 'radar',
          data: {
            labels: dimLabels,
            datasets: [{
              data: vals,
              backgroundColor: '#5b9bd522',
              borderColor: '#5b9bd5',
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: '#5b9bd5',
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              r: {
                min: 0, max: 5,
                ticks: { stepSize: 1, font: { size: 9 }, backdropColor: 'transparent' },
                pointLabels: { font: { size: 9 } },
                grid: { color: '#d5d5d5' },
                angleLines: { color: '#d5d5d5' },
              }
            }
          }
        });
      });
    });
  }

  // ── Conversations ──
  function renderConversationList() {
    const sidebar = document.getElementById('conv-sidebar');
    sidebar.innerHTML = DATA.conversations.map(c => {
      const turnCount = c.turns ? c.turns.length : 0;
      const items = (c.gt_items || []).map(i => `Item ${i}`).join(', ') || 'None';
      return `
        <div class="conv-item" data-cid="${c.conv_id}">
          <div class="conv-title">Conv ${c.conv_id} &bull; Cat ${c.catalogue.toUpperCase()}</div>
          <div class="conv-meta">${c.user_id.toUpperCase()} &bull; Scenario ${c.scenario_id} &bull; ${turnCount} turns</div>
        </div>`;
    }).join('');

    sidebar.querySelectorAll('.conv-item').forEach(el => {
      el.addEventListener('click', () => {
        sidebar.querySelectorAll('.conv-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        renderConversation(parseInt(el.dataset.cid));
      });
    });
  }

  function renderConversation(cid) {
    const c = DATA.conversations.find(x => x.conv_id === cid);
    if (!c) return;
    const main = document.getElementById('conv-main');
    const scenario = DATA.scenarios.find(s => s.scenario_id === c.scenario_id);

    const turnsHtml = (c.turns || []).map(t => {
      const role = t.role;
      // Content has utterances joined by newlines
      const utterances = t.content.split('\n').filter(u => u.trim());
      const tagLists = Array.isArray(t.tags) ? t.tags : [];

      const uttsHtml = utterances.map((u, i) => {
        const turnTags = (tagLists[i] || []).map(tag => `<span class="tag">${escHtml(tag)}</span>`).join('');
        return `<div class="utterance">${escHtml(u)} <span class="tags">${turnTags}</span></div>`;
      }).join('');

      return `
        <div class="turn">
          <div class="turn-header">
            <span class="role-badge ${role}">${role}</span>
            <span style="color:#999;font-size:0.7rem">Turn ${t.turn}</span>
          </div>
          <div class="utterances">${uttsHtml}</div>
        </div>`;
    }).join('');

    const mentioned = (c.mentioned_items || []).map(i => `Item ${i}`).join(', ') || 'None';
    const chosen = (c.gt_items || []).map(i => `Item ${i}`).join(', ') || 'None';

    main.innerHTML = `
      <div class="conv-info">
        <h2>Conversation ${c.conv_id}</h2>
        <div class="conv-details">
          <span>User ${c.user_id.toUpperCase()}</span>
          <span>Catalogue ${c.catalogue.toUpperCase()} (${CATALOGUE_NAMES[c.catalogue]})</span>
          <span>Scenario ${c.scenario_id}</span>
          <span>Mentioned: ${mentioned}</span>
          <span>Chosen: ${chosen}</span>
          <span>${(c.turns || []).length} turns</span>
        </div>
        ${c.summary ? `<div class="conv-summary"><strong>Summary:</strong> ${escHtml(c.summary.trim())}</div>` : ''}
        ${scenario ? `<div class="conv-scenario">${escHtml(scenario.body)}</div>` : ''}
      </div>
      <div class="transcript">${turnsHtml}</div>`;
  }

  // ── Preferences ──
  function renderPreferencesSidebar() {
    const sidebar = document.getElementById('prefs-sidebar');
    // Group prefs by user
    const byUser = {};
    DATA.preferences.forEach(p => {
      if (!byUser[p.user_id]) byUser[p.user_id] = [];
      byUser[p.user_id].push(p);
    });

    const userIds = Object.keys(byUser).sort();
    sidebar.innerHTML = userIds.map(uid => `
      <div class="pref-user-item" data-uid="${uid}">
        <div class="pref-user-id">${uid.toUpperCase()}</div>
        <div class="pref-user-count">${byUser[uid].length} preferences</div>
      </div>
    `).join('');

    sidebar.querySelectorAll('.pref-user-item').forEach(el => {
      el.addEventListener('click', () => {
        sidebar.querySelectorAll('.pref-user-item').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        renderPreferences(el.dataset.uid, byUser[el.dataset.uid]);
      });
    });
  }

  function renderPreferences(uid, prefs) {
    const main = document.getElementById('prefs-main');
    const user = DATA.users.find(u => u.user_id === uid);

    main.innerHTML = `
      <h3 style="margin-bottom:1rem;color:var(--accent)">${uid.toUpperCase()} &mdash; ${prefs.length} Extracted Preferences</h3>
      ${user ? `<p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">${escHtml(user.style_preferences)}</p>` : ''}
      ${prefs.map(p => `
        <div class="pref-item">
          <div class="pref-source">Conv ${p.source_conv_id}</div>
          <div class="pref-desc">${escHtml(p.description)}</div>
        </div>
      `).join('')}
    `;
  }

  // ── Analysis ──
  function renderAnalysis() {
    const s = DATA.stats;

    // Item mentions
    const allItemIds = Array.from({ length: 36 }, (_, i) => String(i + 1));
    const mentions = s.itemMentionFrequency;
    new Chart(document.getElementById('chart-item-mentions'), {
      type: 'bar',
      data: {
        labels: allItemIds.map(id => `Item ${id}`),
        datasets: [{ label: 'Times Mentioned', data: allItemIds.map(id => mentions[id] || 0), backgroundColor: '#6bc78588', borderColor: '#6bc785', borderWidth: 1 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 90, minRotation: 45, font: { size: 9 } } } } }
    });

    // Ground truth frequency
    const gt = s.groundTruthFrequency;
    new Chart(document.getElementById('chart-gt-freq'), {
      type: 'bar',
      data: {
        labels: allItemIds.map(id => `Item ${id}`),
        datasets: [{ label: 'Times Chosen', data: allItemIds.map(id => gt[id] || 0), backgroundColor: '#e07b5488', borderColor: '#e07b54', borderWidth: 1 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 90, minRotation: 45, font: { size: 9 } } } } }
    });

    // Dialogue acts by role
    const roleTags = { Seeker: {}, Assistant: {} };
    DATA.conversations.forEach(c => {
      (c.turns || []).forEach(t => {
        const role = t.role;
        if (!roleTags[role]) return;
        const tagLists = Array.isArray(t.tags) ? t.tags : [];
        tagLists.forEach(tagList => {
          if (Array.isArray(tagList)) {
            tagList.forEach(tag => {
              roleTags[role][tag] = (roleTags[role][tag] || 0) + 1;
            });
          }
        });
      });
    });

    const allTagNames = [...new Set([...Object.keys(roleTags.Seeker), ...Object.keys(roleTags.Assistant)])];
    allTagNames.sort((a, b) => ((roleTags.Seeker[b] || 0) + (roleTags.Assistant[b] || 0)) - ((roleTags.Seeker[a] || 0) + (roleTags.Assistant[a] || 0)));
    const topTags = allTagNames.slice(0, 15);

    new Chart(document.getElementById('chart-tags-role'), {
      type: 'bar',
      data: {
        labels: topTags,
        datasets: [
          { label: 'Seeker', data: topTags.map(t => roleTags.Seeker[t] || 0), backgroundColor: '#5b9bd588', borderColor: '#5b9bd5', borderWidth: 1 },
          { label: 'Assistant', data: topTags.map(t => roleTags.Assistant[t] || 0), backgroundColor: '#e07b5488', borderColor: '#e07b54', borderWidth: 1 },
        ]
      },
      options: {
        plugins: { legend: { labels: { font: { size: 11 } } } },
        scales: { y: { beginAtZero: true }, x: { ticks: { font: { size: 10 } } } }
      }
    });

    // Scenarios list
    const scenariosList = document.getElementById('scenarios-list');
    scenariosList.innerHTML = DATA.scenarios.map(s => `
      <div class="scenario-card">
        <div class="s-num">Scenario ${s.scenario_id}</div>
        <div class="s-body">${escHtml(s.body)}</div>
      </div>
    `).join('');

    // Per-user rating heatmap (scatter chart approach)
    const userIds = [...new Set(DATA.ratings.map(r => r.user_id))].sort();
    // Build per-user per-item avg rating
    const userItemRatings = {};
    DATA.ratings.forEach(r => {
      const key = `${r.user_id}_${r.item_id}`;
      if (!userItemRatings[key]) userItemRatings[key] = [];
      userItemRatings[key].push(r.rating);
    });

    const heatmapDatasets = userIds.map((uid, uidx) => {
      const data = [];
      for (let item = 1; item <= 36; item++) {
        const key = `${uid}_${item}`;
        const vals = userItemRatings[key];
        if (vals) {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          data.push({ x: item - 1, y: uidx, v: Math.round(avg * 10) / 10 });
        }
      }
      return {
        label: uid.toUpperCase(),
        data: data.map(d => ({ x: d.x, y: d.y })),
        backgroundColor: data.map(d => {
          const v = d.v;
          if (v <= 1.5) return '#e06080';
          if (v <= 2.5) return '#e07b54';
          if (v <= 3.5) return '#d4d45a';
          if (v <= 4.5) return '#6bc785';
          return '#5b9bd5';
        }),
        pointRadius: 8,
        pointStyle: 'rect',
      };
    });

    new Chart(document.getElementById('chart-heatmap'), {
      type: 'scatter',
      data: { datasets: heatmapDatasets },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                const uid = userIds[ctx.parsed.y];
                const itemId = ctx.parsed.x + 1;
                const key = `${uid}_${itemId}`;
                const vals = userItemRatings[key];
                const avg = vals ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 'N/A';
                return `${uid.toUpperCase()} / Item ${itemId}: ${avg}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear', min: -0.5, max: 35.5,
            ticks: { stepSize: 1, callback: v => `Item ${v + 1}`, font: { size: 8 }, maxRotation: 90, minRotation: 45 },
            title: { display: true, text: 'Items' }
          },
          y: {
            type: 'linear', min: -0.5, max: userIds.length - 0.5,
            ticks: { stepSize: 1, callback: v => userIds[v] ? userIds[v].toUpperCase() : '', font: { size: 10 } },
            title: { display: true, text: 'Users' },
            reverse: true
          }
        }
      }
    });

    // Preferences per user
    const ppu = s.prefsPerUser;
    const prefUserIds = Object.keys(ppu).sort();
    new Chart(document.getElementById('chart-prefs-per-user'), {
      type: 'bar',
      data: {
        labels: prefUserIds.map(u => u.toUpperCase()),
        datasets: [{
          label: 'Extracted Preferences',
          data: prefUserIds.map(u => ppu[u]),
          backgroundColor: '#c9a44c88',
          borderColor: '#c9a44c',
          borderWidth: 1,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'Count' } } }
      }
    });
  }
})();
