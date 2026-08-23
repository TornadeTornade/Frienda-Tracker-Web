window.PageProfil = (() => {
  const MAX_CARD_STATS = 3;

  let currentPlayer = null;
  let allPlayers = [];
  let allStatsCache = null;
  let chartStatKey = "playtime_seconds";
  let chartInstance = null;
  let radarInstance = null;
  let cardSelectedKeys = [];
  const RADAR_KEYS = ["playtime_seconds", "player_kills", "mob_kills", "blocks_broken", "distance_meters", "jumps"];

  async function fetchAllPlayersLight() {
    const { data, error } = await window.sb.from("player_stats").select("uuid, username").order("username");
    if (error) throw error;
    return data ?? [];
  }

  async function fetchPlayerByUsername(username) {
    const { data, error } = await window.sb
      .from("player_stats")
      .select("*")
      .ilike("username", username)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function fetchAllStats() {
    if (allStatsCache) return allStatsCache;
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    allStatsCache = data ?? [];
    return allStatsCache;
  }

  async function fetchHistory(uuid, statKey) {
    const { data, error } = await window.sb
      .from("player_stats_history")
      .select(`recorded_at, ${statKey}`)
      .eq("uuid", uuid)
      .order("recorded_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  }

  async function fetchSessions(uuid) {
    const { data, error } = await window.sb
      .from("player_sessions")
      .select("*")
      .eq("uuid", uuid)
      .order("joined_at", { ascending: false })
      .limit(25);
    if (error) throw error;
    return data ?? [];
  }

  async function isOnline(uuid) {
    const { count, error } = await window.sb
      .from("player_sessions")
      .select("*", { count: "exact", head: true })
      .eq("uuid", uuid)
      .is("left_at", null);
    if (error) return false;
    return (count ?? 0) > 0;
  }

  // ---------- Rangs ----------
  function rankOf(uuid, key, allStats) {
    const sorted = [...allStats].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
    return sorted.findIndex((p) => p.uuid === uuid) + 1;
  }

  function bestCategoryKeys(uuid, allStats, n = MAX_CARD_STATS) {
    return window.STAT_CATEGORIES
      .map((c) => ({ cat: c, rank: rankOf(uuid, c.key, allStats) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, n)
      .map((x) => x.cat.key);
  }

  function radarVsAverage(uuid, allStats) {
    const playerData = [];
    const avgData = [];
    RADAR_KEYS.forEach((key) => {
      const values = allStats.map((p) => p[key] ?? 0);
      const max = Math.max(1, ...values);
      const player = allStats.find((p) => p.uuid === uuid);
      const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
      playerData.push(Math.round(((player ? player[key] ?? 0 : 0) / max) * 100));
      avgData.push(Math.round((avg / max) * 100));
    });
    return { labels: RADAR_KEYS.map((k) => window.statByKey(k).short), playerData, avgData };
  }

  // ---------- Rendu ----------
  function searchBarHTML() {
    return `
      <div class="card p-4 relative mb-7">
        <label class="block text-[11px] font-mono uppercase tracking-wider text-muted mb-2">Rechercher un joueur</label>
        <input id="profil-search" type="text" placeholder="Pseudo exact du joueur…" autocomplete="off"
          class="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-enchant transition-colors" />
        <div id="profil-suggestions" class="hidden absolute z-10 left-4 right-4 mt-1 card max-h-64 overflow-y-auto shadow-card"></div>
      </div>`;
  }

  function emptyStateHTML() {
    return `<p class="text-muted text-sm">Recherche un pseudo ci-dessus pour afficher son profil complet.</p>`;
  }

  function cardStatChipsHTML() {
    return window.STAT_CATEGORIES.map((c) => {
      const active = cardSelectedKeys.includes(c.key);
      return `<button data-cardkey="${c.key}" class="chip-btn ${active ? "active" : ""}">${c.icon} ${c.short}</button>`;
    }).join("");
  }

  function rankBarsHTML(uuid, allStats) {
    const n = allStats.length || 1;
    return window.STAT_CATEGORIES.map((c) => {
      const rank = rankOf(uuid, c.key, allStats);
      const percentile = Math.round(((n - rank + 1) / n) * 100);
      return `
        <div class="flex items-center gap-3 py-2">
          <span class="w-[120px] shrink-0 text-xs text-muted font-mono truncate">${c.icon} ${c.short}</span>
          <div class="flex-1 h-2 rounded-full bg-bg overflow-hidden shadow-slot">
            <div class="h-full rounded-full bg-gradient-to-r from-enchant to-gold" style="width:${percentile}%"></div>
          </div>
          <span class="w-16 shrink-0 text-right text-xs font-mono text-ink">#${rank}<span class="text-muted">/${n}</span></span>
        </div>`;
    }).join("");
  }

  async function profileHTML(p, allStats) {
    const online = await isOnline(p.uuid);
    return `
      <div class="card p-6 flex flex-col sm:flex-row items-center sm:items-start gap-6 mb-6">
        <div class="relative shrink-0">
          <img src="${window.avatarBody3D(p.uuid, 140)}" class="h-[160px] drop-shadow-[0_8px_16px_rgba(0,0,0,.5)]" alt="" />
          <span class="absolute -bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border ${
            online ? "bg-green/10 border-green/40 text-green" : "bg-surface2 border-border text-muted"
          }">
            <span class="w-1.5 h-1.5 rounded-full ${online ? "bg-green live-dot" : "bg-muted"}"></span>
            ${online ? "En ligne" : "Hors ligne"}
          </span>
        </div>
        <div class="flex-1 min-w-0 text-center sm:text-left">
          <h2 class="text-xl font-extrabold">${p.username}</h2>
          <p class="text-muted text-xs font-mono mt-1">${p.uuid}</p>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">
        ${window.STAT_CATEGORIES.map(
          (c) => `
          <div class="card p-3">
            <p class="text-[10px] font-mono uppercase text-muted truncate">${c.icon} ${c.short}</p>
            <p class="font-mono font-bold text-lg">${window.fmt.statValue(c.key, p[c.key])}</p>
          </div>`
        ).join("")}
      </div>

      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">📊 Classement du joueur</p>
        <div class="card p-5 divide-y divide-border/60">${rankBarsHTML(p.uuid, allStats)}</div>
      </section>

      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🕸️ Profil vs moyenne du serveur</p>
        <div class="card p-4" style="height:300px"><canvas id="profil-radar"></canvas></div>
      </section>

      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">📈 Évolution</p>
        <div class="flex flex-wrap gap-2 mb-4" id="chart-cat-nav">
          ${window.STAT_CATEGORIES.map(
            (c) => `<button data-key="${c.key}" class="chip-btn ${c.key === chartStatKey ? "active" : ""}">${c.icon} ${c.short}</button>`
          ).join("")}
        </div>
        <div class="card p-4">
          <canvas id="evo-chart" height="90"></canvas>
        </div>
      </section>

      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🕑 Historique de connexions</p>
        <div id="sessions-list" class="card divide-y divide-border">${window.skeletonRows(4, "h-12")}</div>
      </section>

      <section>
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🃏 Player Card</p>
        <div class="card p-5">
          <p class="text-sm text-muted mb-3">
            Choisis jusqu'à ${MAX_CARD_STATS} statistiques à afficher sur la carte
            (<span class="text-ink font-medium" id="card-count">0</span>/${MAX_CARD_STATS} sélectionnée(s)).
          </p>
          <div class="flex flex-wrap gap-2 mb-4" id="card-stat-nav">${cardStatChipsHTML()}</div>
          <button id="gen-card-btn" class="chip-btn active !bg-gradient-to-b !from-enchant !to-enchant2">
            ⬇️ Télécharger la Player Card
          </button>
        </div>
      </section>
    `;
  }

  function sessionsListHTML(sessions) {
    if (!sessions.length) return `<p class="p-4 text-sm text-muted">Aucune session enregistrée pour l'instant.</p>`;
    return sessions
      .map((s) => {
        const duration = s.left_at
          ? window.fmt.duration((new Date(s.left_at) - new Date(s.joined_at)) / 1000)
          : "en cours…";
        return `
        <div class="flex items-center justify-between px-4 py-3 text-sm">
          <div class="flex items-center gap-2">
            <span class="${s.left_at ? "text-muted" : "text-green"}">${s.left_at ? "●" : "🟢"}</span>
            <span>${window.fmt.dateTime(s.joined_at)}</span>
          </div>
          <span class="font-mono text-xs text-muted">${duration}</span>
        </div>`;
      })
      .join("");
  }

  async function renderChart(uuid) {
    const history = await fetchHistory(uuid, chartStatKey);
    const canvas = document.getElementById("evo-chart");
    if (!canvas) return;
    if (chartInstance) chartInstance.destroy();

    if (history.length < 2) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Pas encore assez de données historiques pour tracer une courbe (reviens après quelques sauvegardes groupées).</p>`;
      return;
    }

    chartInstance = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: history.map((h) => new Date(h.recorded_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [
          {
            label: window.statByKey(chartStatKey).label,
            data: history.map((h) => h[chartStatKey]),
            borderColor: "#8B6CF2",
            backgroundColor: "rgba(139,108,242,.15)",
            fill: true,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#8B98A8" }, grid: { color: "#1A222D" } },
          y: { ticks: { color: "#8B98A8" }, grid: { color: "#1A222D" } },
        },
      },
    });
  }

  function renderProfileRadar(uuid, allStats) {
    const canvas = document.getElementById("profil-radar");
    if (!canvas) return;
    if (radarInstance) radarInstance.destroy();
    const { labels, playerData, avgData } = radarVsAverage(uuid, allStats);
    radarInstance = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels,
        datasets: [
          { label: "Moyenne du serveur", data: avgData, borderColor: "#8B98A8", backgroundColor: "rgba(139,152,168,.12)", pointRadius: 2 },
          { label: "Ce joueur", data: playerData, borderColor: "#F2B33D", backgroundColor: "rgba(242,179,61,.25)", pointRadius: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#8B98A8", font: { size: 11 } } } },
        scales: {
          r: {
            angleLines: { color: "#1A222D" },
            grid: { color: "#1A222D" },
            pointLabels: { color: "#8B98A8", font: { size: 10, family: "JetBrains Mono" } },
            ticks: { display: false, backdropColor: "transparent" },
            suggestedMin: 0, suggestedMax: 100,
          },
        },
      },
    });
  }

  // ---------- Player Card (export image) ----------
  function buildPlayerCardNode(p, selectedKeys, globalRank) {
    const node = window.el("div", { id: "player-card-export" });
    node.innerHTML = `
      <div style="position:absolute;inset:0;background:linear-gradient(160deg,#1A1030,#0B0F14 55%,#0B0F14);"></div>
      <div style="position:absolute;inset:0;box-shadow:inset 0 0 0 2px rgba(242,179,61,.5);border-radius:20px;"></div>
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;height:100%;padding:22px 18px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.1em;color:#F2B33D;">FRIENDA TRACKER</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:34px;font-weight:700;color:#F2B33D;margin-top:6px;">#${globalRank}</div>
        <img src="${window.avatarBody3D(p.uuid, 190)}" style="height:180px;margin-top:6px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.6));" crossorigin="anonymous" />
        <div style="font-weight:800;font-size:20px;margin-top:8px;">${p.username}</div>
        <div style="width:100%;height:1px;background:rgba(255,255,255,.12);margin:14px 0;"></div>
        <div style="display:flex;width:100%;justify-content:space-between;gap:8px;">
          ${selectedKeys
            .map((key) => {
              const cat = window.statByKey(key);
              return `
            <div style="flex:1;text-align:center;">
              <div style="font-size:20px;">${cat.icon}</div>
              <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px;color:#F2B33D;margin-top:2px;">${window.fmt.statValue(cat.key, p[cat.key])}</div>
              <div style="font-size:9px;color:#8B98A8;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">${cat.short}</div>
            </div>`;
            })
            .join("")}
        </div>
      </div>
    `;
    return node;
  }

  async function generatePlayerCard(p) {
    if (!cardSelectedKeys.length) {
      window.showToast("Choisis au moins une statistique pour la carte", "error");
      return;
    }
    window.showToast("Génération de la carte…");
    try {
      const allStats = await fetchAllStats();
      const globalRank = rankOf(p.uuid, "playtime_seconds", allStats);

      const node = buildPlayerCardNode(p, cardSelectedKeys, globalRank);
      node.style.position = "fixed";
      node.style.left = "-9999px";
      document.body.appendChild(node);

      await new Promise((r) => setTimeout(r, 400));

      const canvas = await html2canvas(node, { backgroundColor: null, scale: 2, useCORS: true });
      document.body.removeChild(node);

      const link = document.createElement("a");
      link.download = `frienda-card-${p.username}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      window.showToast("Player Card téléchargée !", "success");
    } catch (e) {
      console.error(e);
      window.showToast("Échec de la génération de la carte", "error");
    }
  }

  // ---------- Recherche ----------
  function suggestionsHTML(query) {
    const q = query.trim().toLowerCase();
    if (!q) return "";
    const matches = allPlayers.filter((p) => p.username.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) return `<div class="px-3 py-2 text-sm text-muted">Aucun joueur trouvé.</div>`;
    return matches
      .map(
        (p) => `<button data-pick="${p.username}" class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface2 text-sm">
                  <img src="${window.avatarHead(p.uuid, 20)}" class="w-5 h-5 rounded" alt="" />${p.username}
                </button>`
      )
      .join("");
  }

  function updateCardCountLabel() {
    const label = document.getElementById("card-count");
    if (label) label.textContent = String(cardSelectedKeys.length);
  }

  async function loadProfile(username) {
    const wrap = document.getElementById("profil-content");
    wrap.innerHTML = window.skeletonRows(3, "h-16");
    try {
      const p = await fetchPlayerByUsername(username);
      if (!p) {
        wrap.innerHTML = `<p class="text-sm text-muted">Aucun joueur ne porte ce pseudo.</p>`;
        return;
      }
      currentPlayer = p;

      // sélection par défaut de la Player Card = les 3 meilleures catégories du joueur
      const allStats = await fetchAllStats();
      cardSelectedKeys = bestCategoryKeys(p.uuid, allStats, MAX_CARD_STATS);

      wrap.innerHTML = await profileHTML(p, allStats);
      updateCardCountLabel();
      renderProfileRadar(p.uuid, allStats);

      document.getElementById("chart-cat-nav").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        chartStatKey = btn.dataset.key;
        window.$$("#chart-cat-nav .chip-btn").forEach((b) => b.classList.toggle("active", b === btn));
        renderChart(p.uuid);
      });

      document.getElementById("card-stat-nav").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-cardkey]");
        if (!btn) return;
        const key = btn.dataset.cardkey;
        if (cardSelectedKeys.includes(key)) {
          cardSelectedKeys = cardSelectedKeys.filter((k) => k !== key);
          btn.classList.remove("active");
        } else {
          if (cardSelectedKeys.length >= MAX_CARD_STATS) {
            window.showToast(`Maximum ${MAX_CARD_STATS} statistiques sur la carte`, "error");
            return;
          }
          cardSelectedKeys.push(key);
          btn.classList.add("active");
        }
        updateCardCountLabel();
      });

      document.getElementById("gen-card-btn").addEventListener("click", () => generatePlayerCard(p));

      renderChart(p.uuid);
      fetchSessions(p.uuid).then((sessions) => {
        document.getElementById("sessions-list").innerHTML = sessionsListHTML(sessions);
      });
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<p class="text-red text-sm">Erreur lors du chargement du profil.</p>`;
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-2">
        <h1 class="text-2xl font-extrabold tracking-tight">Profils</h1>
        <p class="text-muted text-sm mt-1">Toutes les informations d'un joueur, en détail.</p>
      </header>
      ${searchBarHTML()}
      <div id="profil-content">${emptyStateHTML()}</div>
    `;
  }

  function bindEvents() {
    const input = document.getElementById("profil-search");
    const suggBox = document.getElementById("profil-suggestions");

    input.addEventListener("input", () => {
      suggBox.innerHTML = suggestionsHTML(input.value);
      suggBox.classList.toggle("hidden", !input.value.trim());
    });
    input.addEventListener("blur", () => setTimeout(() => suggBox.classList.add("hidden"), 150));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        suggBox.classList.add("hidden");
        loadProfile(input.value.trim());
      }
    });
    suggBox.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-pick]");
      if (!btn) return;
      input.value = btn.dataset.pick;
      suggBox.classList.add("hidden");
      loadProfile(btn.dataset.pick);
    });
  }

  async function render() {
    allStatsCache = null;
    renderAll();
    bindEvents();
    try {
      allPlayers = await fetchAllPlayersLight();
    } catch (e) {
      console.error(e);
    }
    return () => {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      if (radarInstance) { radarInstance.destroy(); radarInstance = null; }
    };
  }

  return { render };
})();
