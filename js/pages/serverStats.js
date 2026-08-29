window.PageServerStats = (() => {
  const EARTH_CIRCUMFERENCE_M = 40075000;
  const PERIODS = [
    { key: "week", label: "Semaine", days: 7 },
    { key: "month", label: "Mois", days: 30 },
    { key: "year", label: "Année", days: 365 },
    { key: "all", label: "Total", days: null },
  ];
  const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  // Statistiques affichées dans la section "Profil" — le joueur moyen
  // comparé au record du serveur sur chacune d'elles.
  const PROFILE_KEYS = ["playtime_seconds", "player_kills", "mob_kills", "blocks_broken", "distance_meters", "jumps"];

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
  const MEDAL_COLORS = [CHART_COLORS.gold, CHART_COLORS.silver, CHART_COLORS.bronze];

  // Nouvelle table des matières : la page ne raconte plus "voici des
  // cartes", elle raconte "voici le pouls du serveur, puis ses joueurs, ses
  // combats, ses records, son profil".
  const SECTIONS = [
    { id: "sec-pouls", label: "Pouls" },
    { id: "sec-joueurs", label: "Joueurs" },
    { id: "sec-combat", label: "Combat" },
    { id: "sec-records", label: "Records" },
    { id: "sec-profil", label: "Profil" },
  ];

  let activePeriod = "month";
  let charts = {};
  let sectionObserver = null;
  // Sessions de la période actuellement chargée, gardées en mémoire pour
  // que le clic sur un point/une barre "Tendance sur la période" puisse
  // retrouver le détail jour par jour sans re-fetch.
  let currentSessions = [];
  let selectedDayIso = null;

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

  function previousPeriodRange(key) {
    const p = PERIODS.find((x) => x.key === key);
    if (!p.days) return null;
    const untilIso = periodStartDate(key);
    const prevStart = new Date();
    prevStart.setDate(prevStart.getDate() - p.days * 2);
    return { sinceIso: prevStart.toISOString(), untilIso };
  }

  async function fetchPlayers() {
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    return data ?? [];
  }

  async function fetchFirstSeen(sinceIso, untilIso) {
    let q = window.sb.from("player_stats").select("uuid, username, first_seen").order("first_seen");
    if (sinceIso) q = q.gte("first_seen", sinceIso);
    if (untilIso) q = q.lt("first_seen", untilIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function fetchSessions(sinceIso, untilIso) {
    let q = window.sb
      .from("player_sessions")
      .select("uuid, username, joined_at, left_at, session_seconds")
      .order("joined_at");
    if (sinceIso) q = q.gte("joined_at", sinceIso);
    if (untilIso) q = q.lt("joined_at", untilIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function fetchLastSeen() {
    const { data, error } = await window.sb
      .from("player_sessions")
      .select("uuid, username, joined_at")
      .order("joined_at", { ascending: false });
    if (error) throw error;
    const lastByUuid = {};
    (data ?? []).forEach((row) => {
      if (!lastByUuid[row.uuid]) lastByUuid[row.uuid] = row;
    });
    return Object.values(lastByUuid);
  }

  // ---------------------------------------------------------------
  // Petits composants
  // ---------------------------------------------------------------
  function periodNavHTML() {
    return PERIODS.map(
      (p) => `<button data-period="${p.key}" class="chip-btn ${p.key === activePeriod ? "active" : ""}">${p.label}</button>`
    ).join("");
  }

  function periodBadge(kind) {
    if (kind === "period") {
      return `<span class="ml-2 align-middle text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-enchant/15 text-enchant border border-enchant/30">Période</span>`;
    }
    return `<span class="ml-2 align-middle text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface2 text-muted border border-border">All-time</span>`;
  }

  function sectionTitle(icon, text, badgeKind, caption) {
    return `
      <div class="mb-3">
        <div class="flex items-center gap-2.5">
          <div class="stat-icon sm">${icon}</div>
          <p class="font-sans text-[15px] font-bold text-ink leading-tight">${text}${badgeKind ? periodBadge(badgeKind) : ""}</p>
        </div>
        ${caption ? `<p class="text-xs text-muted mt-1 ml-[38px]">${caption}</p>` : ""}
      </div>`;
  }

  // Sous-en-tête discret DANS une section (ex: "En bref" avant les stat
  // cards, "Quand est-ce que ça joue ?" avant les graphiques d'horaires) —
  // pour donner un fil de lecture au lieu d'un mur de cartes identiques.
  function subHeading(text) {
    return `<p class="text-[10px] font-mono uppercase tracking-widest text-muted/70 mb-2 mt-6 first:mt-0">${text}</p>`;
  }

  function statCard(icon, label, value, sub, badgeKind) {
    return `
      <div class="card p-4">
        <div class="flex items-center gap-2.5 mb-2">
          <div class="stat-icon">${icon}</div>
          <p class="font-sans text-[13px] font-semibold text-muted leading-tight">${label}${badgeKind ? periodBadge(badgeKind) : ""}</p>
        </div>
        <p class="font-mono font-extrabold text-2xl">${value}</p>
        ${sub ? `<p class="text-xs mt-1">${sub}</p>` : ""}
      </div>`;
  }

  // Tuile de record : pas de graphique, juste icône + nombre. Un total
  // cumulé (ex: "12 480 sauts") n'a rien à comparer visuellement — un bar
  // chart pour ça n'ajoutait rien qu'un gros nombre en gras ne dit déjà.
  function recordTile(icon, label, value) {
    return `
      <div class="card p-4 flex items-center gap-3">
        <div class="stat-icon shrink-0">${icon}</div>
        <div class="min-w-0">
          <p class="text-[10px] font-mono uppercase tracking-wider text-muted truncate">${label}</p>
          <p class="font-mono font-extrabold text-xl text-ink truncate">${value}</p>
        </div>
      </div>`;
  }

  function chartCard(id, title, caption, height = 220) {
    return `
      <div class="card p-4">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted">${title}</p>
        <p class="text-[11px] text-muted/70 mb-3 min-h-[14px]">${caption ?? ""}</p>
        <div style="height:${height}px"><canvas id="${id}"></canvas></div>
      </div>`;
  }

  function emptyStateHTML(msg) {
    return `<div class="h-full flex items-center justify-center min-h-[100px]"><p class="text-sm text-muted text-center px-6">${msg}</p></div>`;
  }

  function renderEmptyIfNeeded(canvas, condition, msg) {
    if (!condition) return false;
    canvas.parentElement.innerHTML = emptyStateHTML(msg);
    return true;
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
    if (sectionObserver) {
      sectionObserver.disconnect();
      sectionObserver = null;
    }
  }

  const axisOpts = {
    ticks: { color: CHART_COLORS.muted, font: { family: "JetBrains Mono", size: 10 } },
    grid: { color: CHART_COLORS.grid },
  };

  function trendSub(delta, { fallback = "" } = {}) {
    if (delta === undefined) return fallback;
    if (delta === null) return `<span class="font-mono text-green">↑ nouveau ce cycle</span>`;
    const flat = Math.abs(delta) < 1;
    const up = delta > 0;
    const cls = flat ? "text-muted" : up ? "text-green" : "text-red";
    const arrow = flat ? "→" : up ? "↑" : "↓";
    return `<span class="font-mono ${cls}">${arrow} ${Math.abs(delta).toFixed(0)}% vs période précédente</span>`;
  }

  function deltaPct(cur, prev, hasPrev) {
    if (!hasPrev) return undefined;
    if (prev === 0) return cur === 0 ? 0 : null;
    return ((cur - prev) / prev) * 100;
  }

  // ---------------------------------------------------------------
  // Calculs
  // ---------------------------------------------------------------

  // Remplace intégralement le heatmap 7×24. Un lecteur devait décoder une
  // grille de 168 cellules colorées, sans légende de valeurs, pour répondre
  // à une question simple : "à quelle heure / quel jour ça joue le plus ?".
  // Deux bar charts triés répondent à la même question en une seconde,
  // avec des axes lisibles et des valeurs exactes au survol.
  function peakHours(sessions) {
    const counts = Array(24).fill(0);
    sessions.forEach((s) => counts[new Date(s.joined_at).getHours()]++);
    return counts;
  }

  function peakDays(sessions) {
    const counts = Array(7).fill(0);
    sessions.forEach((s) => {
      const d = new Date(s.joined_at).getDay();
      counts[d === 0 ? 6 : d - 1]++;
    });
    return counts;
  }

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

  function activePlayersPerDay(sessions) {
    const byDay = {};
    sessions.forEach((s) => {
      const day = new Date(s.joined_at).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = new Set();
      byDay[day].add(s.uuid);
    });
    const labels = Object.keys(byDay).sort();
    return { labels, counts: labels.map((l) => byDay[l].size) };
  }

  // Exclut aussi distance_meters : déjà mis en avant comme "fun fact" dédié
  // juste sous le hero, pas la peine de le répéter une 2e fois en tuile.
  function recordCategories(players) {
    return window.STAT_CATEGORIES.filter(
      (c) => !["distance_meters"].includes(c.key)
    ).map((c) => ({ cat: c, total: players.reduce((sum, p) => sum + (p[c.key] ?? 0), 0) }));
  }

  // Pour chaque statistique du profil : la moyenne de tous les joueurs,
  // le record actuel du serveur (et qui le détient), et le % que représente
  // la moyenne par rapport à ce record. Ces valeurs alimentent à la fois le
  // radar (l'axe) et la légende (le détail exact, pour ne pas laisser le
  // "100%" de chaque axe sans explication).
  function serverProfileRows(players) {
    return PROFILE_KEYS.map((key) => {
      const cat = window.statByKey(key);
      const values = players.map((p) => p[key] ?? 0);
      const max = Math.max(0, ...values);
      const holder = max > 0 ? players.find((p) => (p[key] ?? 0) === max) : null;
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      const pct = max > 0 ? Math.round((avg / max) * 100) : 0;
      return { key, icon: cat.icon, label: cat.label, avg, max, pct, holderName: holder ? holder.username : null };
    });
  }

  const DURATION_BUCKETS = [
    { max: 900, label: "< 15 min" },
    { max: 1800, label: "15-30 min" },
    { max: 3600, label: "30-60 min" },
    { max: 7200, label: "1-2 h" },
    { max: Infinity, label: "2 h +" },
  ];

  function sessionDurationHistogram(sessions) {
    const finished = sessions.filter((s) => s.session_seconds != null);
    const counts = DURATION_BUCKETS.map(() => 0);
    finished.forEach((s) => {
      const idx = DURATION_BUCKETS.findIndex((b) => s.session_seconds < b.max);
      counts[idx === -1 ? DURATION_BUCKETS.length - 1 : idx]++;
    });
    return { counts, finishedCount: finished.length };
  }

  function newPlayersPerBucket(firstSeenRows, sinceIso) {
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
    const values = labels.map((l) => byBucket[l]);
    let running = 0;
    const cumulative = values.map((v) => (running += v));
    return {
      labels: labels.map((l) =>
        groupByMonth
          ? new Date(l + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })
          : new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
      ),
      values, cumulative, groupByMonth,
    };
  }

  function kdData(players) {
    const totalKills = players.reduce((s, p) => s + (p.player_kills ?? 0), 0);
    const totalDeaths = players.reduce((s, p) => s + (p.deaths ?? 0), 0);
    const globalRatio = totalDeaths ? totalKills / totalDeaths : totalKills;
    const top = players
      .filter((p) => (p.player_kills ?? 0) >= 1)
      .map((p) => ({ username: p.username, ratio: (p.player_kills ?? 0) / ((p.deaths ?? 0) + 1) }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 6);
    return { globalRatio, top };
  }

  function retentionBuckets(lastSeenRows) {
    const now = Date.now();
    const buckets = { "≤ 7 jours": 0, "8 – 30 jours": 0, "> 30 jours": 0 };
    lastSeenRows.forEach((r) => {
      const days = (now - new Date(r.joined_at).getTime()) / 86400000;
      if (days <= 7) buckets["≤ 7 jours"]++;
      else if (days <= 30) buckets["8 – 30 jours"]++;
      else buckets["> 30 jours"]++;
    });
    return buckets;
  }

  // Jour du serveur = ancienneté depuis la toute première connexion jamais
  // enregistrée. C'est le nouvel élément "signature" de la page : un seul
  // gros repère narratif tout en haut, plutôt qu'une rangée de cartes KPI.
  function launchInfo(players) {
    const dates = players.map((p) => p.first_seen).filter(Boolean).map((d) => new Date(d).getTime());
    if (!dates.length) return null;
    const launch = new Date(Math.min(...dates));
    const days = Math.max(1, Math.floor((Date.now() - launch.getTime()) / 86400000) + 1);
    return { launch, days };
  }

  // ---------------------------------------------------------------
  // Détail d'une journée — alimente le panneau sous "Tendance sur la
  // période" quand on clique un point (joueurs actifs) ou une barre
  // (sessions). isoDay est au format "YYYY-MM-DD".
  // ---------------------------------------------------------------
  function dayDetailHTML(isoDay, sessions) {
    const dayLabel = new Date(isoDay + "T00:00:00").toLocaleDateString("fr-FR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    const daySessions = sessions.filter((s) => new Date(s.joined_at).toISOString().slice(0, 10) === isoDay);

    if (!daySessions.length) {
      return `
        <p class="text-[11px] font-mono uppercase tracking-wider text-enchant mb-1">${dayLabel}</p>
        <p class="text-sm text-muted py-4 text-center">Aucune session enregistrée ce jour-là.</p>`;
    }

    const byPlayer = {};
    daySessions.forEach((s) => {
      if (!byPlayer[s.uuid]) byPlayer[s.uuid] = { username: s.username, seconds: 0, sessions: 0 };
      byPlayer[s.uuid].seconds += s.session_seconds ?? 0;
      byPlayer[s.uuid].sessions++;
    });
    const rows = Object.values(byPlayer).sort((a, b) => b.seconds - a.seconds);
    const totalSeconds = rows.reduce((s, r) => s + r.seconds, 0);

    return `
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p class="text-[11px] font-mono uppercase tracking-wider text-enchant">${dayLabel}</p>
        <p class="text-[11px] text-muted">${rows.length} joueur(s) · ${daySessions.length} session(s) · ${window.fmt.duration(totalSeconds)} cumulées</p>
      </div>
      <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        ${rows.map((r, i) => `
          <div class="flex items-center gap-3 px-2.5 py-1.5 rounded ${i === 0 ? "bg-surface2" : ""}">
            <p class="font-sans text-sm font-semibold text-ink flex-1 truncate">${r.username}</p>
            <p class="font-mono text-xs text-muted">${r.sessions} session(s)</p>
            <p class="font-mono text-sm font-bold text-ink w-16 text-right">${window.fmt.duration(r.seconds)}</p>
          </div>`).join("")}
      </div>`;
  }

  function renderDayDetail(isoDay) {
    const panel = document.getElementById("day-detail-panel");
    if (!panel) return;
    selectedDayIso = isoDay;
    panel.innerHTML = dayDetailHTML(isoDay, currentSessions);
  }

  function dayDetailPlaceholderHTML() {
    return `<p class="text-sm text-muted text-center py-6">Clique un point (joueurs actifs) ou une barre (sessions) ci-dessus pour voir le détail d'une journée.</p>`;
  }

  // ---------------------------------------------------------------
  // Graphiques Chart.js
  // ---------------------------------------------------------------
  function buildPeakHoursChart(sessions) {
    const canvas = document.getElementById("chart-peak-hours");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, sessions.length === 0, "Aucune connexion sur cette période.")) return;
    const counts = peakHours(sessions);
    charts.peakHours = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: counts.map((_, h) => `${h}h`),
        datasets: [{ data: counts, backgroundColor: CHART_COLORS.enchant, borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} connexion(s)` } } },
        scales: {
          x: { ...axisOpts, ticks: { ...axisOpts.ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: { ...axisOpts, ticks: { ...axisOpts.ticks, precision: 0 } },
        },
      },
    });
  }

  function buildPeakDaysChart(sessions) {
    const canvas = document.getElementById("chart-peak-days");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, sessions.length === 0, "Aucune connexion sur cette période.")) return;
    const counts = peakDays(sessions);
    charts.peakDays = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: DAY_LABELS,
        datasets: [{ data: counts, backgroundColor: CHART_COLORS.gold, borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} connexion(s)` } } },
        scales: { x: axisOpts, y: { ...axisOpts, ticks: { ...axisOpts.ticks, precision: 0 } } },
      },
    });
  }

  // Interactif : chaque point représente un jour. Clic → détail des
  // joueurs actifs ce jour-là dans le panneau "day-detail-panel". Le
  // curseur passe en pointeur au survol d'un point pour signaler que
  // c'est cliquable.
  function buildActivePlayersChart(sessions) {
    const canvas = document.getElementById("chart-active-players");
    if (!canvas) return;
    const { labels, counts } = activePlayersPerDay(sessions);
    if (renderEmptyIfNeeded(canvas, labels.length < 2, "Pas encore assez de connexions sur cette période pour tracer une courbe.")) return;
    charts.activePlayers = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: labels.map((l) => new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [{
          label: "Joueurs uniques",
          data: counts,
          borderColor: CHART_COLORS.enchant,
          backgroundColor: "rgba(139,108,242,.18)",
          fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 6,
          pointBackgroundColor: (ctx) => (labels[ctx.dataIndex] === selectedDayIso ? CHART_COLORS.gold : CHART_COLORS.enchant),
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        onHover: (evt, elements) => { canvas.style.cursor = elements.length ? "pointer" : "default"; },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          renderDayDetail(labels[elements[0].index]);
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} joueur(s) unique(s) — clique pour le détail` } } },
        scales: { x: axisOpts, y: { ...axisOpts, ticks: { ...axisOpts.ticks, precision: 0 } } },
      },
    });
  }

  // Interactif : chaque barre représente un jour. Clic sur une barre (ou
  // le point de durée moyenne associé) → même panneau de détail que le
  // graphique "Joueurs actifs par jour", pour explorer une journée sous
  // les deux angles avec un seul geste.
  function buildComboChart(sessions) {
    const canvas = document.getElementById("chart-combo");
    if (!canvas) return;
    const { labels, counts, avgMinutes } = sessionsPerDay(sessions);
    if (renderEmptyIfNeeded(canvas, labels.length < 2, "Pas encore assez de sessions sur cette période.")) return;
    charts.combo = new Chart(canvas.getContext("2d"), {
      data: {
        labels: labels.map((l) => new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [
          {
            type: "bar", label: "Sessions ouvertes", data: counts, yAxisID: "y", borderRadius: 4,
            backgroundColor: (ctx) => (labels[ctx.dataIndex] === selectedDayIso ? CHART_COLORS.gold : CHART_COLORS.enchant),
          },
          { type: "line", label: "Durée moy. session (min)", data: avgMinutes, borderColor: CHART_COLORS.gold, backgroundColor: CHART_COLORS.gold, yAxisID: "y1", tension: 0.35, pointRadius: 3, pointHoverRadius: 6 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        onHover: (evt, elements) => { canvas.style.cursor = elements.length ? "pointer" : "default"; },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          renderDayDetail(labels[elements[0].index]);
        },
        plugins: {
          legend: { labels: { color: CHART_COLORS.muted, font: { size: 11 } } },
          tooltip: { callbacks: { afterBody: () => "Clique pour le détail de cette journée" } },
        },
        scales: {
          x: axisOpts,
          y: { ...axisOpts, position: "left", title: { display: true, text: "sessions", color: CHART_COLORS.muted } },
          y1: { ...axisOpts, position: "right", grid: { display: false }, title: { display: true, text: "minutes", color: CHART_COLORS.muted } },
        },
      },
    });
  }

  function buildSessionHistogram(sessions) {
    const canvas = document.getElementById("chart-session-hist");
    if (!canvas) return;
    const { counts, finishedCount } = sessionDurationHistogram(sessions);
    if (renderEmptyIfNeeded(canvas, finishedCount === 0, "Aucune session terminée sur cette période (les parties en cours ne comptent pas encore).")) return;
    charts.sessionHist = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: DURATION_BUCKETS.map((b) => b.label),
        datasets: [{ data: counts, backgroundColor: CHART_COLORS.enchant, borderRadius: 4 }],
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
    const { labels, values, cumulative } = newPlayersPerBucket(firstSeenRows, sinceIso);
    if (renderEmptyIfNeeded(canvas, labels.length < 1, "Aucun nouveau joueur sur cette période.")) return;
    charts.newPlayers = new Chart(canvas.getContext("2d"), {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Nouveaux joueurs", data: values, backgroundColor: CHART_COLORS.green, yAxisID: "y", borderRadius: 4 },
          { type: "line", label: "Total cumulé", data: cumulative, borderColor: CHART_COLORS.gold, backgroundColor: CHART_COLORS.gold, yAxisID: "y1", tension: 0.35, pointRadius: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: CHART_COLORS.muted, font: { size: 11 } } } },
        scales: {
          x: axisOpts,
          y: { ...axisOpts, position: "left", ticks: { ...axisOpts.ticks, precision: 0 } },
          y1: { ...axisOpts, position: "right", grid: { display: false }, ticks: { ...axisOpts.ticks, precision: 0 } },
        },
      },
    });
  }

  function buildRetentionChart(lastSeenRows) {
    const canvas = document.getElementById("chart-retention");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, lastSeenRows.length === 0, "Aucune connexion enregistrée pour l'instant.")) return;
    const buckets = retentionBuckets(lastSeenRows);
    charts.retention = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: Object.keys(buckets),
        datasets: [{ data: Object.values(buckets), backgroundColor: [CHART_COLORS.green, CHART_COLORS.gold, CHART_COLORS.red], borderRadius: 4 }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ...axisOpts, ticks: { ...axisOpts.ticks, precision: 0 } }, y: axisOpts },
      },
    });
  }

  // Radar, mais avec deux ajouts pour lever l'ambiguïté du "100%" : un
  // tooltip qui donne la valeur exacte (pas juste le %) au survol de chaque
  // sommet, et une légende à côté qui étale moyenne / record / détenteur du
  // record pour chaque statistique, plutôt qu'un simple pourcentage nu.
  function buildRadar(players) {
    const canvas = document.getElementById("chart-radar");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, players.length === 0, "Aucun joueur tracké pour l'instant.")) return;
    const rows = serverProfileRows(players);
    charts.radar = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels: rows.map((r) => `${r.icon} ${r.label}`),
        datasets: [{
          label: "Moyenne des joueurs",
          data: rows.map((r) => r.pct),
          borderColor: CHART_COLORS.enchant,
          backgroundColor: "rgba(139,108,242,.25)",
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS.enchant,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const row = rows[ctx.dataIndex];
                const avgFmt = window.fmt.statValue(row.key, Math.round(row.avg));
                const maxFmt = window.fmt.statValue(row.key, row.max);
                return [`${row.pct}% du record`, `Moyenne : ${avgFmt}`, `Record : ${maxFmt}${row.holderName ? ` (${row.holderName})` : ""}`];
              },
            },
          },
        },
        scales: { r: {
          angleLines: { color: CHART_COLORS.grid }, grid: { color: CHART_COLORS.grid },
          pointLabels: { color: CHART_COLORS.muted, font: { size: 10, family: "JetBrains Mono" } },
          ticks: { display: false, backdropColor: "transparent" }, min: 0, max: 100,
        } },
      },
    });
    const legendEl = document.getElementById("radar-legend");
    if (legendEl) {
      legendEl.innerHTML = rows.map((row) => {
        const avgFmt = window.fmt.statValue(row.key, Math.round(row.avg));
        const maxFmt = window.fmt.statValue(row.key, row.max);
        return `
          <div class="flex flex-col gap-0.5 text-xs font-mono px-2.5 py-2 rounded bg-surface2">
            <div class="flex items-center justify-between">
              <span class="text-muted">${row.icon} ${row.label}</span>
              <span class="text-ink font-bold">${row.pct}%</span>
            </div>
            <span class="text-muted/70 text-[10px]">${avgFmt} / ${maxFmt}${row.holderName ? ` (${row.holderName})` : ""}</span>
          </div>`;
      }).join("");
    }
  }

  // Classement K/D en liste (pas en bar chart) : chaque ligne porte son
  // rang avec la même palette médaille que la page Podium (rank-badge
  // r1/r2/r3), pour que ce top se lise comme un vrai podium plutôt que
  // comme un énième graphique en barres.
  function kdListHTML(top) {
    if (!top.length) return emptyStateHTML("Pas encore assez de kills pour établir un classement K/D.");
    const maxRatio = Math.max(...top.map((t) => t.ratio));
    return `<div class="space-y-2">` + top.map((t, i) => `
      <div class="flex items-center gap-3 p-2 rounded-lg ${i < 3 ? "bg-surface2" : ""}">
        <div class="rank-badge ${i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : ""} shrink-0 w-7 h-7 flex items-center justify-center text-xs font-mono font-bold rounded-full border border-border">${i + 1}</div>
        <p class="font-sans text-sm font-semibold text-ink w-24 sm:w-32 truncate">${t.username}</p>
        <div class="flex-1 h-2 rounded-full bg-surface2 overflow-hidden">
          <div class="h-full rounded-full" style="width:${Math.max(4, (t.ratio / maxRatio) * 100).toFixed(0)}%; background:${i < 3 ? MEDAL_COLORS[i] : CHART_COLORS.enchant}"></div>
        </div>
        <p class="font-mono text-sm font-bold text-ink w-12 text-right">${(Math.round(t.ratio * 100) / 100).toLocaleString("fr-FR")}</p>
      </div>`).join("") + `</div>`;
  }

  // ---------------------------------------------------------------
  // Sous-nav collante + scrollspy
  // ---------------------------------------------------------------
  function subNavHTML() {
    const links = SECTIONS.map(
      (s) => `<a href="#${s.id}" data-section="${s.id}" class="subnav-link shrink-0 px-3 py-1.5 rounded-full text-[11px] font-mono border border-border text-muted hover:text-ink hover:border-enchant transition-colors">${s.label}</a>`
    ).join("");
    return `<nav id="stats-subnav" class="sticky top-0 z-20 -mx-4 sm:-mx-6 md:-mx-10 px-4 sm:px-6 md:px-10 py-2 mb-6 bg-bg/95 backdrop-blur border-b border-border flex gap-2 overflow-x-auto">${links}</nav>`;
  }

  function bindSubNav() {
    const nav = document.getElementById("stats-subnav");
    if (!nav) return;
    nav.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-section]");
      if (!a) return;
      e.preventDefault();
      document.getElementById(a.dataset.section)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    sectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          nav.querySelectorAll("a[data-section]").forEach((l) => l.classList.remove("bg-surface2", "text-ink", "border-enchant"));
          nav.querySelector(`a[data-section="${entry.target.id}"]`)?.classList.add("bg-surface2", "text-ink", "border-enchant");
        });
      },
      { rootMargin: "-100px 0px -70% 0px", threshold: 0 }
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) sectionObserver.observe(el);
    });
  }

  // ---------------------------------------------------------------
  // Chargement + rendu
  // ---------------------------------------------------------------
  async function loadPeriodData() {
    const contentWrap = document.getElementById("stats-content");
    contentWrap.innerHTML = window.skeletonRows(4, "h-24");
    destroyCharts();
    selectedDayIso = null;

    try {
      const sinceIso = periodStartDate(activePeriod);
      const prevRange = previousPeriodRange(activePeriod);
      const hasPrev = !!prevRange;

      const [players, sessions, firstSeenRows, lastSeenRows, prevSessions, prevFirstSeenRows] = await Promise.all([
        fetchPlayers(),
        fetchSessions(sinceIso),
        fetchFirstSeen(sinceIso),
        fetchLastSeen(),
        hasPrev ? fetchSessions(prevRange.sinceIso, prevRange.untilIso) : Promise.resolve([]),
        hasPrev ? fetchFirstSeen(prevRange.sinceIso, prevRange.untilIso) : Promise.resolve([]),
      ]);

      currentSessions = sessions;

      const totalPlayers = players.length;
      const totalDistance = players.reduce((sum, p) => sum + (p.distance_meters ?? 0), 0);
      const totalPlaytimeAllTime = players.reduce((sum, p) => sum + (p.playtime_seconds ?? 0), 0);
      const laps = totalDistance / EARTH_CIRCUMFERENCE_M;
      const launch = launchInfo(players);

      const uniqueConnected = new Set(sessions.map((s) => s.uuid)).size;
      const totalSessionSeconds = sessions.reduce((s, x) => s + (x.session_seconds ?? 0), 0);
      const avgPlaytimeInPeriod = uniqueConnected ? totalSessionSeconds / uniqueConnected : 0;
      const avgSessionsPerPlayer = uniqueConnected ? sessions.length / uniqueConnected : 0;

      const prevUniqueConnected = hasPrev ? new Set(prevSessions.map((s) => s.uuid)).size : 0;
      const prevTotalSessionSeconds = hasPrev ? prevSessions.reduce((s, x) => s + (x.session_seconds ?? 0), 0) : 0;
      const prevAvgPlaytime = prevUniqueConnected ? prevTotalSessionSeconds / prevUniqueConnected : 0;
      const prevAvgSessions = prevUniqueConnected ? prevSessions.length / prevUniqueConnected : 0;
      const prevNewPlayers = hasPrev ? prevFirstSeenRows.length : 0;

      const { groupByMonth } = newPlayersPerBucket(firstSeenRows, sinceIso);
      const { globalRatio, top } = kdData(players);
      const records = recordCategories(players);

      contentWrap.innerHTML = `
        <!-- HERO — élément signature de la page : un seul repère narratif
             ("Jour N depuis la 1ère connexion") plutôt qu'une rangée de
             cartes KPI. Purement all-time, ne dépend jamais du sélecteur
             de période plus bas : la distinction que le rapport pointait
             comme mélangée est ici une séparation physique, pas juste un
             badge. -->
        <div class="card p-8 md:p-10 mb-4 text-center" style="background:linear-gradient(180deg, rgba(139,108,242,.08), transparent)">
          <p class="text-[11px] font-mono uppercase tracking-widest text-muted mb-2">${window.APP_CONFIG.SERVER_NAME}${periodBadge("alltime")}</p>
          ${launch ? `
            <p class="font-mono font-extrabold text-5xl md:text-6xl text-ink">Jour ${window.fmt.int(launch.days)}</p>
            <p class="text-sm text-muted mt-2">depuis la toute première connexion enregistrée, le ${launch.launch.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
          ` : `<p class="font-mono font-extrabold text-3xl text-ink">Pas encore de données</p>`}
          <div class="flex flex-wrap justify-center gap-x-8 gap-y-3 mt-6 pt-6 border-t border-border">
            <div><p class="font-mono font-bold text-xl text-ink">${window.fmt.int(totalPlayers)}</p><p class="text-[11px] text-muted">joueurs trackés</p></div>
            <div><p class="font-mono font-bold text-xl text-ink">${window.fmt.duration(totalPlaytimeAllTime)}</p><p class="text-[11px] text-muted">jouées cumulées</p></div>
            <div><p class="font-mono font-bold text-xl text-gold">${window.fmt.distance(totalDistance)}</p><p class="text-[11px] text-muted">soit ${laps.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}× le tour de la Terre 🌍</p></div>
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
          <p class="text-xs text-muted">Le reste de la page suit la période choisie ci-dessous, sauf mention "All-time".</p>
          <div class="flex flex-wrap gap-2" id="period-nav">${periodNavHTML()}</div>
        </div>

        ${subNavHTML()}

        <section id="sec-pouls" class="mb-10 scroll-mt-20">
          ${sectionTitle("💓", "Pouls de la communauté", "period")}

          ${subHeading("En bref")}
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${statCard("✨", "Nouveaux joueurs", window.fmt.int(firstSeenRows.length), trendSub(deltaPct(firstSeenRows.length, prevNewPlayers, hasPrev), { fallback: `<span class="text-muted">depuis toujours</span>` }))}
            ${statCard("🔌", "Joueurs connectés (uniques)", window.fmt.int(uniqueConnected), trendSub(deltaPct(uniqueConnected, prevUniqueConnected, hasPrev)))}
            ${statCard("⏱️", "Temps de jeu moyen / joueur", window.fmt.duration(avgPlaytimeInPeriod), trendSub(deltaPct(avgPlaytimeInPeriod, prevAvgPlaytime, hasPrev)))}
            ${statCard("🔁", "Sessions moy. / joueur", avgSessionsPerPlayer.toLocaleString("fr-FR", { maximumFractionDigits: 1 }), trendSub(deltaPct(avgSessionsPerPlayer, prevAvgSessions, hasPrev)))}
          </div>

          ${subHeading("Quand est-ce que ça joue ?")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-peak-hours", "Connexions par heure de la journée", "Toutes les connexions de la période, cumulées par heure (0h–23h).", 200)}
            ${chartCard("chart-peak-days", "Connexions par jour de la semaine", "Toutes les connexions de la période, cumulées par jour.", 200)}
          </div>

          ${subHeading("Tendance sur la période")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-active-players", "Joueurs actifs par jour", "Joueurs uniques connectés au moins une fois ce jour-là. Clique un point pour le détail.")}
            ${chartCard("chart-combo", "Sessions & durée moyenne", "Nombre de sessions ouvertes par jour — un même joueur peut se reconnecter plusieurs fois. Clique une barre pour le détail.")}
          </div>
          <div class="card p-4 mt-4" id="day-detail-panel">${dayDetailPlaceholderHTML()}</div>
        </section>

        <section id="sec-joueurs" class="mb-10 scroll-mt-20">
          ${sectionTitle("🧑‍🤝‍🧑", "Joueurs", "period")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-new-players", "Nouveaux joueurs & croissance cumulée", `Regroupé par ${groupByMonth ? "mois" : "jour"} sur cette période.`, 240)}
            ${chartCard("chart-session-hist", "Répartition des durées de session", "Sessions terminées uniquement — les parties en cours ne sont pas encore comptabilisées.", 240)}
          </div>
        </section>
        <section id="sec-joueurs" class="mb-10 scroll-mt-20">
          ${sectionTitle("🟢", "Statut des joueurs", "alltime", "Basé sur la dernière connexion de chaque joueur, tous historiques confondus — indépendant de la période choisie plus haut.")}
          ${chartCard("chart-retention", "Ancienneté depuis la dernière connexion", "", 170)}
        </section>

        <section id="sec-combat" class="mb-10 scroll-mt-20">
          ${sectionTitle("⚔️", "Combat", "alltime")}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="card p-5 flex flex-col justify-center gap-1 text-center lg:text-left">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted">Ratio K/D global du serveur</p>
              <p class="font-mono font-extrabold text-4xl text-gold">${globalRatio.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</p>
              <p class="text-xs text-muted mt-1">Total des kills PvP sur total des morts, tous joueurs confondus.</p>
            </div>
            <div class="lg:col-span-2 card p-4">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted">Top 6 meilleurs ratios K/D individuels</p>
              <p class="text-[11px] text-muted/70 mb-3">Calculé en kills / (morts + 1) pour rester défini même à 0 mort.</p>
              ${kdListHTML(top)}
            </div>
          </div>
        </section>

        <section id="sec-records" class="mb-10 scroll-mt-20">
          ${sectionTitle("🏅", "Records cumulés", "alltime", "Somme de la statistique sur tous les joueurs trackés, depuis toujours.")}
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            ${records.map((r) => {
              const isPlaytime = r.cat.key === "playtime_seconds" || r.cat.key === "playtime";
              const val = isPlaytime 
                ? `${window.fmt.int(Math.round(r.total / 3600))} h` 
                : window.fmt.int(r.total);
              return recordTile(r.cat.icon, r.cat.short, val);
            }).join("")}
          </div>
        </section>

        <section id="sec-profil" class="scroll-mt-20">
          ${sectionTitle("🕸️", "Profil du serveur", "alltime", "Chaque axe est indépendant : 100% = le record actuel du serveur pour CETTE statistique précise, pas un maximum commun à tous les axes. Survole un point ou regarde la légende pour les valeurs exactes.")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-radar", "Profil moyen (toile)", "", 320)}
            <div class="card p-4">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-1">Détail par statistique</p>
              <p class="text-[11px] text-muted/70 mb-3">Moyenne des joueurs / record du serveur (détenteur du record entre parenthèses).</p>
              <div id="radar-legend" class="grid grid-cols-2 gap-2"></div>
            </div>
          </div>
        </section>
      `;

      document.getElementById("period-nav").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-period]");
        if (!btn) return;
        activePeriod = btn.dataset.period;
        loadPeriodData();
      });

      bindSubNav();
      buildPeakHoursChart(sessions);
      buildPeakDaysChart(sessions);
      buildActivePlayersChart(sessions);
      buildComboChart(sessions);
      buildNewPlayersChart(firstSeenRows, sinceIso);
      buildSessionHistogram(sessions);
      buildRetentionChart(lastSeenRows);
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
        <p class="text-muted text-sm mt-1">Vue d'ensemble de l'activité de ${window.APP_CONFIG.SERVER_NAME}</p>
      </header>
      <div id="stats-content">${window.skeletonRows(4, "h-24")}</div>
    `;
  }

  async function render() {
    renderAll();
    await loadPeriodData();
    return () => destroyCharts();
  }

  return { render };
})();
