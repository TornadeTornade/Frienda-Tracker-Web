window.PageServerStats = (() => {
  const EARTH_CIRCUMFERENCE_M = 40075000;
  const PERIODS = [
    { key: "week", label: "Semaine", days: 7 },
    { key: "month", label: "Mois", days: 30 },
    { key: "year", label: "Année", days: 365 },
    { key: "all", label: "Total", days: null },
  ];
  const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const RADAR_KEYS = ["playtime_seconds", "player_kills", "mob_kills", "blocks_broken", "distance_meters", "jumps"];
  const CHART_COLORS = {
    enchant: "#8B6CF2",
    enchant2: "#6D4FE0",
    gold: "#F2B33D",
    green: "#48D982",
    red: "#F2545B",
    silver: "#B9C2CC",
    bronze: "#C97A4A",
    muted: "#8B98A8",
    grid: "#1A222D",
  };

  let activePeriod = "month";
  let charts = {}; // id -> Chart instance

  // ---------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------
  function periodStartDate(key) {
    const p = PERIODS.find((x) => x.key === key);
    if (!p.days) return null;
    const d = new Date();
    d.setDate(d.getDate() - p.days);
    return d.toISOString();
  }

  async function fetchPlayers() {
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    return data ?? [];
  }

  async function fetchFirstSeen(sinceIso) {
    let q = window.sb.from("player_stats").select("uuid, username, first_seen").order("first_seen");
    if (sinceIso) q = q.gte("first_seen", sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function fetchSessions(sinceIso) {
    let q = window.sb
      .from("player_sessions")
      .select("uuid, username, joined_at, left_at, session_seconds")
      .order("joined_at");
    if (sinceIso) q = q.gte("joined_at", sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function fetchHistorySince(sinceIso) {
    let q = window.sb
      .from("player_stats_history")
      .select("uuid, recorded_at, playtime_seconds, blocks_broken")
      .order("recorded_at");
    if (sinceIso) q = q.gte("recorded_at", sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  // ---------------------------------------------------------------
  // Helpers de rendu
  // ---------------------------------------------------------------
  function periodNavHTML() {
    return PERIODS.map(
      (p) => `<button data-period="${p.key}" class="chip-btn ${p.key === activePeriod ? "active" : ""}">${p.label}</button>`
    ).join("");
  }

  function statCard(icon, label, value, sub) {
    return `
      <div class="card p-4">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted">${icon} ${label}</p>
        <p class="font-mono font-extrabold text-2xl mt-1">${value}</p>
        ${sub ? `<p class="text-xs text-muted mt-1">${sub}</p>` : ""}
      </div>`;
  }

  function chartCard(id, title, height = 220) {
    return `
      <div class="card p-4">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">${title}</p>
        <div style="height:${height}px"><canvas id="${id}"></canvas></div>
      </div>`;
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
  }

  const axisOpts = {
    ticks: { color: CHART_COLORS.muted, font: { family: "JetBrains Mono", size: 10 } },
    grid: { color: CHART_COLORS.grid },
  };

  // ---------------------------------------------------------------
  // Heatmap heures de pointe
  // ---------------------------------------------------------------
  function buildHeatmapMatrix(sessions) {
    const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    sessions.forEach((s) => {
      const d = new Date(s.joined_at);
      let day = d.getDay();
      day = day === 0 ? 6 : day - 1;
      matrix[day][d.getHours()]++;
    });
    return matrix;
  }

  function heatmapHTML(matrix) {
    const max = Math.max(1, ...matrix.flat());
    const cellColor = (v) => {
      if (v === 0) return "#151B23";
      const intensity = v / max;
      const r = Math.round(139 + (242 - 139) * intensity);
      const g = Math.round(108 + (179 - 108) * intensity);
      const b = Math.round(242 + (61 - 242) * intensity);
      return `rgba(${r},${g},${b},${0.25 + intensity * 0.75})`;
    };
    let rows = "";
    for (let day = 0; day < 7; day++) {
      let cells = "";
      for (let hour = 0; hour < 24; hour++) {
        const v = matrix[day][hour];
        cells += `<div class="heat-cell w-full aspect-square" title="${DAY_LABELS[day]} ${hour}h : ${v} connexion(s)" style="background:${cellColor(v)}"></div>`;
      }
      rows += `<div class="grid gap-[3px] items-center mb-[3px]" style="grid-template-columns:repeat(24,minmax(0,1fr));">${cells}</div>`;
    }
    return `
      <div class="flex gap-2">
        <div class="flex flex-col justify-between py-[2px] text-[10px] font-mono text-muted shrink-0">
          ${DAY_LABELS.map((d) => `<span style="height:calc(100% / 7)">${d}</span>`).join("")}
        </div>
        <div class="flex-1">${rows}</div>
      </div>
      <div class="flex justify-between text-[10px] font-mono text-muted mt-2 px-8">
        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Calculs pour les graphiques
  // ---------------------------------------------------------------
  function sessionsPerDay(sessions) {
    const byDay = {};
    sessions.forEach((s) => {
      const day = new Date(s.joined_at).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { count: 0, durations: [] };
      byDay[day].count++;
      if (s.session_seconds != null) byDay[day].durations.push(s.session_seconds);
    });
    const labels = Object.keys(byDay).sort();
    return {
      labels,
      counts: labels.map((l) => byDay[l].count),
      avgMinutes: labels.map((l) => {
        const d = byDay[l].durations;
        if (!d.length) return 0;
        return Math.round((d.reduce((a, b) => a + b, 0) / d.length / 60) * 10) / 10;
      }),
    };
  }

  function communityPlaytimeSeries(history) {
    // pour chaque joueur, on garde le dernier instantané connu par jour,
    // puis on additionne entre joueurs -> courbe de croissance cumulée.
    const perDayPerPlayer = {}; // day -> uuid -> value
    history.forEach((h) => {
      const day = new Date(h.recorded_at).toISOString().slice(0, 10);
      perDayPerPlayer[day] = perDayPerPlayer[day] || {};
      perDayPerPlayer[day][h.uuid] = h.playtime_seconds;
    });
    const days = Object.keys(perDayPerPlayer).sort();
    // report du dernier total connu pour les joueurs absents un jour donné
    const lastKnown = {};
    const totals = days.map((day) => {
      Object.assign(lastKnown, perDayPerPlayer[day]);
      return Object.values(lastKnown).reduce((a, b) => a + b, 0);
    });
    return { labels: days, totals };
  }

  function totalsByCategory(players) {
    return window.STAT_CATEGORIES.map((c) => ({
      cat: c,
      total: players.reduce((sum, p) => sum + (p[c.key] ?? 0), 0),
    }));
  }

  function radarProfile(players) {
    const avgData = [];
    const topData = [];
    RADAR_KEYS.forEach((key) => {
      const values = players.map((p) => p[key] ?? 0);
      const max = Math.max(1, ...values);
      const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
      avgData.push(Math.round((avg / max) * 100));
      topData.push(100);
    });
    return { labels: RADAR_KEYS.map((k) => window.statByKey(k).short), avgData, topData };
  }

  const DURATION_BUCKETS = [
    { max: 900, label: "< 15 min" },
    { max: 1800, label: "15-30 min" },
    { max: 3600, label: "30-60 min" },
    { max: 7200, label: "1-2 h" },
    { max: Infinity, label: "2 h +" },
  ];

  function sessionDurationHistogram(sessions) {
    const counts = DURATION_BUCKETS.map(() => 0);
    sessions.forEach((s) => {
      if (s.session_seconds == null) return;
      const idx = DURATION_BUCKETS.findIndex((b) => s.session_seconds < b.max);
      counts[idx === -1 ? DURATION_BUCKETS.length - 1 : idx]++;
    });
    return counts;
  }

  function newPlayersPerBucket(firstSeenRows, sinceIso) {
    // regroupe par jour si période courte (semaine/mois), par mois pour année/total
    const groupByMonth = !sinceIso || (new Date() - new Date(sinceIso)) / 86400000 > 60;
    const byBucket = {};
    firstSeenRows.forEach((r) => {
      const d = new Date(r.first_seen);
      const key = groupByMonth
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : d.toISOString().slice(0, 10);
      byBucket[key] = (byBucket[key] || 0) + 1;
    });
    const labels = Object.keys(byBucket).sort();
    return {
      labels: labels.map((l) =>
        groupByMonth
          ? new Date(l + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })
          : new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
      ),
      values: labels.map((l) => byBucket[l]),
    };
  }

  function kdData(players) {
    const totalKills = players.reduce((s, p) => s + (p.player_kills ?? 0), 0);
    const totalDeaths = players.reduce((s, p) => s + (p.deaths ?? 0), 0);
    const globalRatio = totalDeaths ? totalKills / totalDeaths : totalKills;
    const top = players
      .filter((p) => p.deaths >= 1 || p.player_kills >= 1)
      .map((p) => ({ username: p.username, ratio: p.deaths ? p.player_kills / p.deaths : p.player_kills }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 6);
    return { globalRatio, top };
  }

  // ---------------------------------------------------------------
  // Construction des graphiques Chart.js
  // ---------------------------------------------------------------
  function buildCommunityAreaChart(history) {
    const canvas = document.getElementById("chart-community-area");
    const { labels, totals } = communityPlaytimeSeries(history);
    if (!canvas) return;
    if (labels.length < 2) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Pas encore assez d'historique sur cette période.</p>`;
      return;
    }
    charts.communityArea = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels.map((l) => new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [{
          label: "Temps de jeu cumulé (communauté)",
          data: totals.map((s) => Math.round(s / 3600)),
          borderColor: CHART_COLORS.enchant,
          backgroundColor: "rgba(139,108,242,.18)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y.toLocaleString("fr-FR")} h cumulées` } } },
        scales: { x: axisOpts, y: { ...axisOpts, title: { display: true, text: "heures", color: CHART_COLORS.muted } } },
      },
    });
  }

  function buildComboChart(sessions) {
    const canvas = document.getElementById("chart-combo");
    const { labels, counts, avgMinutes } = sessionsPerDay(sessions);
    if (!canvas) return;
    if (labels.length < 2) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Pas encore assez de connexions sur cette période.</p>`;
      return;
    }
    charts.combo = new Chart(canvas.getContext("2d"), {
      data: {
        labels: labels.map((l) => new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [
          { type: "bar", label: "Connexions", data: counts, backgroundColor: CHART_COLORS.enchant, yAxisID: "y", borderRadius: 4 },
          { type: "line", label: "Durée moy. session (min)", data: avgMinutes, borderColor: CHART_COLORS.gold, backgroundColor: CHART_COLORS.gold, yAxisID: "y1", tension: 0.35, pointRadius: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: CHART_COLORS.muted, font: { size: 11 } } } },
        scales: {
          x: axisOpts,
          y: { ...axisOpts, position: "left", title: { display: true, text: "connexions", color: CHART_COLORS.muted } },
          y1: { ...axisOpts, position: "right", grid: { display: false }, title: { display: true, text: "minutes", color: CHART_COLORS.muted } },
        },
      },
    });
  }

  function buildTotalsBarCharts(players) {
    const totals = totalsByCategory(players);
    const counters = totals.filter((t) => ["deaths", "player_kills", "mob_kills", "jumps", "items_enchanted", "items_dropped"].includes(t.cat.key));
    const volumes = totals.filter((t) => ["playtime_seconds", "blocks_broken", "blocks_placed", "damage_dealt", "damage_taken"].includes(t.cat.key));

    const c1 = document.getElementById("chart-totals-counters");
    if (c1) {
      charts.totalsCounters = new Chart(c1.getContext("2d"), {
        type: "bar",
        data: {
          labels: counters.map((t) => `${t.cat.icon} ${t.cat.short}`),
          datasets: [{ data: counters.map((t) => t.total), backgroundColor: CHART_COLORS.enchant, borderRadius: 4 }],
        },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: axisOpts, y: axisOpts },
        },
      });
    }

    const c2 = document.getElementById("chart-totals-volumes");
    if (c2) {
      charts.totalsVolumes = new Chart(c2.getContext("2d"), {
        type: "bar",
        data: {
          labels: volumes.map((t) => `${t.cat.icon} ${t.cat.short}`),
          datasets: [{ data: volumes.map((t) => t.total), backgroundColor: CHART_COLORS.gold, borderRadius: 4 }],
        },
        options: {
          indexAxis: "y", responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: axisOpts, y: axisOpts },
        },
      });
    }
  }

  function buildDoughnuts(players) {
    const pvp = players.reduce((s, p) => s + (p.player_kills ?? 0), 0);
    const mob = players.reduce((s, p) => s + (p.mob_kills ?? 0), 0);
    const broken = players.reduce((s, p) => s + (p.blocks_broken ?? 0), 0);
    const placed = players.reduce((s, p) => s + (p.blocks_placed ?? 0), 0);

    const c1 = document.getElementById("chart-doughnut-kills");
    if (c1) {
      charts.doughnutKills = new Chart(c1.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: ["⚔️ Kills PvP", "🗡️ Kills Mobs"],
          datasets: [{ data: [pvp, mob], backgroundColor: [CHART_COLORS.red, CHART_COLORS.enchant], borderColor: "#121821", borderWidth: 3 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: CHART_COLORS.muted, font: { size: 11 } } } },
        },
      });
    }

    const c2 = document.getElementById("chart-doughnut-blocks");
    if (c2) {
      charts.doughnutBlocks = new Chart(c2.getContext("2d"), {
        type: "doughnut",
        data: {
          labels: ["⛏️ Blocs cassés", "🧱 Blocs posés"],
          datasets: [{ data: [broken, placed], backgroundColor: [CHART_COLORS.bronze, CHART_COLORS.green], borderColor: "#121821", borderWidth: 3 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { color: CHART_COLORS.muted, font: { size: 11 } } } },
        },
      });
    }
  }

  function buildRadar(players) {
    const canvas = document.getElementById("chart-radar");
    if (!canvas) return;
    const { labels, avgData, topData } = radarProfile(players);
    charts.radar = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels,
        datasets: [
          { label: "Record du serveur", data: topData, borderColor: CHART_COLORS.gold, backgroundColor: "rgba(242,179,61,.08)", pointRadius: 2 },
          { label: "Moyenne des joueurs", data: avgData, borderColor: CHART_COLORS.enchant, backgroundColor: "rgba(139,108,242,.25)", pointRadius: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: CHART_COLORS.muted, font: { size: 11 } } } },
        scales: {
          r: {
            angleLines: { color: CHART_COLORS.grid },
            grid: { color: CHART_COLORS.grid },
            pointLabels: { color: CHART_COLORS.muted, font: { size: 10, family: "JetBrains Mono" } },
            ticks: { display: false, backdropColor: "transparent" },
            suggestedMin: 0, suggestedMax: 100,
          },
        },
      },
    });
  }

  function buildSessionHistogram(sessions) {
    const canvas = document.getElementById("chart-session-hist");
    if (!canvas) return;
    const counts = sessionDurationHistogram(sessions);
    if (counts.every((c) => c === 0)) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Pas encore de sessions terminées sur cette période.</p>`;
      return;
    }
    charts.sessionHist = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: DURATION_BUCKETS.map((b) => b.label),
        datasets: [{ data: counts, backgroundColor: CHART_COLORS.green, borderRadius: 4 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: axisOpts, y: { ...axisOpts, ticks: { ...axisOpts.ticks, precision: 0 } } },
      },
    });
  }

  function buildNewPlayersChart(firstSeenRows, sinceIso) {
    const canvas = document.getElementById("chart-new-players");
    if (!canvas) return;
    const { labels, values } = newPlayersPerBucket(firstSeenRows, sinceIso);
    if (labels.length < 1) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Aucun nouveau joueur sur cette période.</p>`;
      return;
    }
    charts.newPlayers = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: CHART_COLORS.silver, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: axisOpts, y: { ...axisOpts, ticks: { ...axisOpts.ticks, precision: 0 } } },
      },
    });
  }

  function buildKdChart(players) {
    const canvas = document.getElementById("chart-kd");
    if (!canvas) return;
    const { top } = kdData(players);
    if (!top.length) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Pas assez de données pour un classement K/D.</p>`;
      return;
    }
    charts.kd = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: top.map((t) => t.username),
        datasets: [{ data: top.map((t) => Math.round(t.ratio * 100) / 100), backgroundColor: CHART_COLORS.red, borderRadius: 4 }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: axisOpts, y: axisOpts },
      },
    });
  }

  // ---------------------------------------------------------------
  // Chargement + rendu
  // ---------------------------------------------------------------
  async function loadPeriodData() {
    const contentWrap = document.getElementById("stats-content");
    contentWrap.innerHTML = window.skeletonRows(4, "h-24");
    destroyCharts();

    try {
      const sinceIso = periodStartDate(activePeriod);
      const [players, sessions, history, firstSeenRows] = await Promise.all([
        fetchPlayers(),
        fetchSessions(sinceIso),
        fetchHistorySince(sinceIso),
        fetchFirstSeen(sinceIso),
      ]);

      const totalPlayers = players.length;
      const totalDistance = players.reduce((sum, p) => sum + (p.distance_meters ?? 0), 0);
      const totalPlaytime = players.reduce((sum, p) => sum + (p.playtime_seconds ?? 0), 0);
      const totalDeaths = players.reduce((sum, p) => sum + (p.deaths ?? 0), 0);
      const avgPlaytime = totalPlayers ? totalPlaytime / totalPlayers : 0;
      const avgDeaths = totalPlayers ? totalDeaths / totalPlayers : 0;
      const laps = totalDistance / EARTH_CIRCUMFERENCE_M;
      const uniqueConnected = new Set(sessions.map((s) => s.uuid)).size;

      contentWrap.innerHTML = `
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          ${statCard("👥", "Joueurs trackés", window.fmt.int(totalPlayers))}
          ${statCard("🔌", "Connexions (période)", window.fmt.int(uniqueConnected) + " joueur(s)")}
          ${statCard("⏱️", "Temps de jeu moyen", window.fmt.duration(avgPlaytime))}
          ${statCard("💀", "Morts moyennes / joueur", window.fmt.int(avgDeaths))}
        </div>

        <div class="card p-6 mb-8 text-center">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-2">🌍 Compteur global de la communauté</p>
          <p class="font-mono font-extrabold text-3xl text-gold">${window.fmt.distance(totalDistance)}</p>
          <p class="text-sm text-muted mt-1">
            soit environ <span class="text-ink font-semibold">${laps.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}×</span> le tour de la Terre 🌐
          </p>
        </div>

        <section class="mb-8">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🔥 Heures de pointe</p>
          <div class="card p-4">${heatmapHTML(buildHeatmapMatrix(sessions))}</div>
        </section>

        <section class="mb-8">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">📈 Activité de la communauté</p>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-community-area", "Temps de jeu cumulé (aire)")}
            ${chartCard("chart-combo", "Connexions & durée moyenne (combo barres + courbe)")}
          </div>
        </section>

        <section class="mb-8">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🧑‍🤝‍🧑 Joueurs</p>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-new-players", "Nouveaux joueurs sur la période", 240)}
            ${chartCard("chart-session-hist", "Répartition des durées de session", 240)}
          </div>
        </section>

        <section class="mb-8">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">⚔️ Ratio Kills / Morts</p>
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="card p-5 flex flex-col justify-center">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-2">Ratio K/D global du serveur</p>
              <p class="font-mono font-extrabold text-3xl text-red">${(kdData(players).globalRatio).toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</p>
            </div>
            <div class="lg:col-span-2">${chartCard("chart-kd", "Top 6 meilleurs ratios K/D individuels", 240)}</div>
          </div>
        </section>

        <section class="mb-8">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🧮 Totaux cumulés (toutes périodes)</p>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-totals-counters", "Compteurs (kills, morts, sauts…)", 260)}
            ${chartCard("chart-totals-volumes", "Volumes (temps, blocs, dégâts…)", 260)}
          </div>
        </section>

        <section class="mb-8">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🥧 Répartitions</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${chartCard("chart-doughnut-kills", "Kills : PvP vs Mobs", 240)}
            ${chartCard("chart-doughnut-blocks", "Blocs : cassés vs posés", 240)}
          </div>
        </section>

        <section>
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🕸️ Profil du serveur (toile)</p>
          ${chartCard("chart-radar", "Moyenne des joueurs vs record du serveur (normalisé)", 320)}
        </section>
      `;

      buildCommunityAreaChart(history);
      buildComboChart(sessions);
      buildNewPlayersChart(firstSeenRows, sinceIso);
      buildSessionHistogram(sessions);
      buildKdChart(players);
      buildTotalsBarCharts(players);
      buildDoughnuts(players);
      buildRadar(players);
    } catch (e) {
      console.error(e);
      contentWrap.innerHTML = `<p class="text-red text-sm">Erreur lors du chargement des statistiques serveur.</p>`;
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-7">
        <h1 class="text-2xl font-extrabold tracking-tight">Serveur Stats</h1>
        <p class="text-muted text-sm mt-1">Vue d'ensemble de l'activité de ${window.APP_CONFIG.SERVER_NAME}.</p>
      </header>
      <div class="flex flex-wrap gap-2 mb-6" id="period-nav">${periodNavHTML()}</div>
      <div id="stats-content">${window.skeletonRows(4, "h-24")}</div>
    `;
  }

  function bindEvents() {
    document.getElementById("period-nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-period]");
      if (!btn) return;
      activePeriod = btn.dataset.period;
      document.getElementById("period-nav").innerHTML = periodNavHTML();
      loadPeriodData();
    });
  }

  async function render() {
    renderAll();
    bindEvents();
    await loadPeriodData();
    return () => destroyCharts();
  }

  return { render };
})();
