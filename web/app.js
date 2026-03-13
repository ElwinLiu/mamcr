// MAMCR VOGUE Dataset Explorer
(async function () {
  const res = await fetch('data.json');
  const DATA = await res.json();

  const CATALOGUE_NAMES = { a: 'Outerwear', b: 'Layering', c: 'Shoes' };
  const PALETTE = [
    '#c9a44c', '#5b9bd5', '#e07b54', '#6bc785', '#c26dbc',
    '#d4d45a', '#5bcfcf', '#e06080', '#8888cc', '#cc8844',
  ];

  // Chart.js defaults
  Chart.defaults.color = '#666';
  Chart.defaults.borderColor = '#d5d5d5';
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 12;

  // Track which sections have been initialized
  const initialized = { overview: false, catalogue: false, participants: false, conversations: false, analysis: false };

  // ── Navigation ──
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
      case 'participants': renderParticipants('all'); initParticipantFilters(); break;
      case 'conversations': renderConversationList(); break;
      case 'analysis': renderAnalysis(); break;
    }
  }

  // Init overview immediately (it's visible on load)
  initSection('overview');

  // ── Overview ──
  function renderStats() {
    const s = DATA.stats;
    const grid = document.getElementById('stats-grid');
    const cards = [
      { label: 'Conversations', value: s.totalConversations },
      { label: 'Participants', value: s.totalParticipants },
      { label: 'Catalogue Items', value: s.totalItems },
      { label: 'Total Turns', value: s.totalTurns },
      { label: 'Avg Turns / Conv', value: s.avgTurnsPerConversation },
      { label: 'Unique Dialogue Acts', value: Object.keys(s.tagCounts).length },
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

    // Dialogue acts bar chart (top 15)
    const tags = Object.entries(s.tagCounts).slice(0, 15);
    new Chart(document.getElementById('chart-dialogue-acts'), {
      type: 'bar',
      data: {
        labels: tags.map(t => t[0]),
        datasets: [{ label: 'Occurrences', data: tags.map(t => t[1]), backgroundColor: '#5b9bd588', borderColor: '#5b9bd5', borderWidth: 1 }]
      },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
    });

    // Item mentions
    const mentions = s.itemMentionFrequency;
    const allItemIds = Array.from({ length: 36 }, (_, i) => String(i + 1));
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

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderItems(cat) {
    const grid = document.getElementById('items-grid');
    const items = cat === 'all' ? DATA.items : DATA.items.filter(i => i.catalogue === cat);
    grid.innerHTML = items.map(item => {
      const cats = item.categories.slice(-3);
      const details = item.product_detail ? Object.entries(item.product_detail) : [];
      const about = (item.about_product || []).filter(a => !a.startsWith('Key words'));
      return `
        <div class="item-card">
          <div class="item-header">
            <span class="item-id">Item ${item.id} &bull; Cat ${item.catalogue.toUpperCase()}</span>
            <span class="item-rating">${item.product_rating ? item.product_rating + ' / 5' : ''}</span>
          </div>
          <div class="item-name">${escHtml(item.product_name)}</div>
          <div class="item-brand">${escHtml((item.product_brand || '').replace('Visit the ', '').replace(' Store', ''))}</div>
          <div class="item-categories">${cats.map(c => `<span class="cat-tag">${escHtml(c)}</span>`).join('')}</div>
          ${about.length ? `<ul class="item-about">${about.map(a => `<li>${escHtml(a)}</li>`).join('')}</ul>` : ''}
          ${details.length ? `<dl class="item-details">${details.map(([k, v]) => `<dt>${escHtml(k)}:</dt><dd>${escHtml(v)}</dd><br>`).join('')}</dl>` : ''}
        </div>`;
    }).join('');
  }

  // ── Participants ──
  const radarCharts = {};

  function initParticipantFilters() {
    document.querySelectorAll('[data-role]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-role]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderParticipants(btn.dataset.role);
      });
    });
  }

  function renderParticipants(roleFilter) {
    const grid = document.getElementById('participants-grid');
    // Destroy existing radar charts
    Object.values(radarCharts).forEach(c => { try { c.destroy(); } catch(e) {} });
    for (const k in radarCharts) delete radarCharts[k];

    let profiles = DATA.profiles;
    if (roleFilter === 'seeker') profiles = profiles.filter(p => p.participant_id.startsWith('s'));
    else if (roleFilter === 'assistant') profiles = profiles.filter(p => p.participant_id.startsWith('a'));

    grid.innerHTML = profiles.map(p => {
      const isSeeker = p.participant_id.startsWith('s');
      const role = isSeeker ? 'Seeker' : 'Assistant';
      const roleClass = isSeeker ? 'seeker' : 'assistant';
      return `
        <div class="participant-card">
          <div class="p-header">
            <span class="p-id">${escHtml(p.participant_id.toUpperCase())}</span>
            <span class="p-role ${roleClass}">${role}</span>
          </div>
          <div class="p-style">${escHtml(p.style_preferences)}</div>
          <div class="p-vibes">${escHtml(p.style_vibes)}</div>
          <div class="p-meta">
            <span class="meta-item"><span class="meta-label">Purchase:</span><span class="meta-value">${escHtml(p.purchase_frequency)}</span></span>
            <span class="meta-item"><span class="meta-label">Budget:</span><span class="meta-value">${escHtml(p.monthly_spend)}</span></span>
            <span class="meta-item"><span class="meta-label">Colors:</span><span class="meta-value">${escHtml(p.best_colors)}</span></span>
            <span class="meta-item"><span class="meta-label">Feel:</span><span class="meta-value">${escHtml(p.clothing_feel)}</span></span>
          </div>
          <div class="radar-container"><canvas id="radar-${p.participant_id}"></canvas></div>
        </div>`;
    }).join('');

    // Create radar charts after a frame so DOM is laid out
    requestAnimationFrame(() => {
      const dims = ['comfort', 'style', 'practicality', 'trends', 'brand', 'self_expression', 'sustainability', 'price', 'color_importance'];
      const dimLabels = ['Comfort', 'Style', 'Practicality', 'Trends', 'Brand', 'Self Expr.', 'Sustain.', 'Price', 'Color'];
      profiles.forEach(p => {
        const canvas = document.getElementById(`radar-${p.participant_id}`);
        if (!canvas) return;
        const vals = dims.map(d => parseInt(p[d]) || 0);
        const isSeeker = p.participant_id.startsWith('s');
        const color = isSeeker ? '#5b9bd5' : '#e07b54';
        radarCharts[p.participant_id] = new Chart(canvas, {
          type: 'radar',
          data: {
            labels: dimLabels,
            datasets: [{
              data: vals,
              backgroundColor: color + '22',
              borderColor: color,
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: color,
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
      const turns = c.conversation_content.length;
      const items = (c.gt_items || []).map(i => `Item ${i}`).join(', ') || 'None';
      return `
        <div class="conv-item" data-cid="${c.conversation_id}">
          <div class="conv-title">Conv ${c.conversation_id} &bull; Cat ${c.catalogue.toUpperCase()}</div>
          <div class="conv-meta">Scenario ${c.scenario} &bull; ${turns} turns &bull; Chosen: ${items}</div>
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
    const c = DATA.conversations.find(x => x.conversation_id === cid);
    if (!c) return;
    const main = document.getElementById('conv-main');
    const scenario = DATA.scenarios.find(s => s.Scenario === c.scenario);

    const turnsHtml = c.conversation_content.map(t => {
      const role = t.content.role;
      const utts = t.content.utterances.map((u, i) => {
        const tags = (t.content.tags[i] || []).map(tag => `<span class="tag">${escHtml(tag)}</span>`).join('');
        return `<div class="utterance">${escHtml(u)} ${tags}</div>`;
      }).join('');
      return `
        <div class="turn">
          <div class="turn-header">
            <span class="role-badge ${role}">${role}</span>
            <span class="timestamp">${t.timestamp}</span>
            <span style="color:#999;font-size:0.7rem">Turn ${t.turn}</span>
          </div>
          <div class="utterances">${utts}</div>
        </div>`;
    }).join('');

    const mentioned = (c.mentioned_items || []).map(i => `Item ${i}`).join(', ') || 'None';
    const chosen = (c.gt_items || []).map(i => `Item ${i}`).join(', ') || 'None';

    main.innerHTML = `
      <div class="conv-info">
        <h2>Conversation ${c.conversation_id}</h2>
        <div class="conv-details">
          <span>Catalogue ${c.catalogue.toUpperCase()} (${CATALOGUE_NAMES[c.catalogue]})</span>
          <span>Scenario ${c.scenario}</span>
          <span>Mentioned: ${mentioned}</span>
          <span>Chosen: ${chosen}</span>
          <span>${c.conversation_content.length} turns</span>
        </div>
        ${scenario ? `<div class="conv-scenario">${escHtml(scenario.Body)}</div>` : ''}
      </div>
      <div class="transcript">${turnsHtml}</div>`;
  }

  // ── Analysis ──
  function renderAnalysis() {
    // Likert satisfaction
    const likertLabels = [
      'Overall Satisfaction',
      'Recommendation Quality',
      'Understanding Preferences',
      'Conversation Flow',
      'Would Use Again'
    ];
    const likertData = [[], [], [], [], []];
    DATA.seekerRatings.forEach(r => {
      for (let i = 0; i < 5; i++) {
        const val = parseFloat(r[`likert_${i + 1}`]);
        if (!isNaN(val)) likertData[i].push(val);
      }
    });
    const likertAvg = likertData.map(arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

    new Chart(document.getElementById('chart-likert'), {
      type: 'bar',
      data: {
        labels: likertLabels,
        datasets: [{
          label: 'Average Score',
          data: likertAvg.map(v => Math.round(v * 100) / 100),
          backgroundColor: PALETTE.slice(0, 5).map(c => c + '88'),
          borderColor: PALETTE.slice(0, 5),
          borderWidth: 1,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 5, title: { display: true, text: 'Score (1-5)' } } }
      }
    });

    // Rating distribution
    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    DATA.seekerRatings.forEach(r => {
      for (let i = 1; i <= 36; i++) {
        const val = parseInt(r[`item_${i}`]);
        if (val >= 1 && val <= 5) ratingCounts[val]++;
      }
    });

    new Chart(document.getElementById('chart-rating-dist'), {
      type: 'doughnut',
      data: {
        labels: ['1 - Dislike', '2 - Below Avg', '3 - Neutral', '4 - Like', '5 - Love'],
        datasets: [{
          data: Object.values(ratingCounts),
          backgroundColor: ['#e06080', '#e07b54', '#d4d45a', '#6bc785', '#5b9bd5'],
          borderColor: '#ffffff',
          borderWidth: 2,
        }]
      },
      options: {
        plugins: { legend: { position: 'right', labels: { font: { size: 11 }, padding: 12 } } }
      }
    });

    // Dialogue acts by role
    const roleTags = { Seeker: {}, Assistant: {} };
    DATA.conversations.forEach(c => {
      c.conversation_content.forEach(t => {
        const role = t.content.role;
        if (!roleTags[role]) return;
        t.content.tags.forEach(tagList => {
          tagList.forEach(tag => {
            roleTags[role][tag] = (roleTags[role][tag] || 0) + 1;
          });
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
        <div class="s-num">Scenario ${s.Scenario}</div>
        <div class="s-body">${escHtml(s.Body)}</div>
      </div>
    `).join('');

    // Seeker vs Assistant agreement
    const agreements = [];
    DATA.conversations.forEach(c => {
      const cid = c.conversation_id;
      const sr = DATA.seekerRatings.find(r => parseInt(r.conversation_id) === cid);
      const ar = DATA.assistantRatings.find(r => parseInt(r.conversation_id) === cid);
      if (!sr || !ar) return;

      let diffs = [];
      for (let i = 1; i <= 36; i++) {
        const sv = parseInt(sr[`item_${i}`]);
        const av = parseInt(ar[`item_${i}`]);
        if (sv >= 1 && sv <= 5 && av >= 1 && av <= 5) {
          diffs.push(Math.abs(sv - av));
        }
      }
      if (diffs.length > 0) {
        const mae = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        agreements.push({ cid, mae });
      }
    });

    new Chart(document.getElementById('chart-agreement'), {
      type: 'bar',
      data: {
        labels: agreements.map(a => `C${a.cid}`),
        datasets: [{
          label: 'MAE (lower = better agreement)',
          data: agreements.map(a => Math.round(a.mae * 100) / 100),
          backgroundColor: agreements.map(a => a.mae < 1 ? '#6bc78588' : a.mae < 1.5 ? '#d4d45a88' : '#e0605088'),
          borderColor: agreements.map(a => a.mae < 1 ? '#6bc785' : a.mae < 1.5 ? '#d4d45a' : '#e06050'),
          borderWidth: 1,
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Mean Absolute Error' } },
          x: { ticks: { font: { size: 8 }, maxRotation: 90, minRotation: 45 } }
        }
      }
    });
  }
})();
