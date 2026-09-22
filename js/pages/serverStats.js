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


  const T = window.THEME;
  const BAR = "#52525B"; // barres neutres : seul le maximum passe en blanc

  // Couleurs par barre : la valeur la plus haute ressort, le reste reste discret.
  const highlightMax = (values) => {
    const max = Math.max(0, ...values);
    return values.map((v) => (max > 0 && v === max ? T.ink : BAR));
  };


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
    return window.ui.segmented(PERIODS, activePeriod, "period", "period-nav");
  }

  // Étiquette de portée : indique si un bloc suit le sélecteur de période ou non.
  function scopeBadge(kind) {
    return kind === "period" ? window.ui.badge("Sur la période", "solid") : window.ui.badge("Depuis toujours");
  }

  function sectionHeader(title, badgeKind, caption) {
    return `
      <div class="mb-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 class="text-base font-semibold tracking-tight">${title}</h2>
          ${badgeKind ? scopeBadge(badgeKind) : ""}
        </div>
        ${caption ? `<p class="text-[13px] text-muted mt-1.5 max-w-3xl">${caption}</p>` : ""}
      </div>`;
  }

  // Tuile de record : pas de graphique, juste icône + nombre. Un total
  // cumulé (ex: "12 480 sauts") n'a rien à comparer visuellement.
  function recordTile(cat, value) {
    return `
      <div class="card p-4 flex items-center gap-3">
        <span class="stat-icon">${window.catIcon(cat, 16)}</span>
        <div class="min-w-0">
          <p class="text-[12.5px] text-muted truncate">${cat.short}</p>
          <p class="font-mono font-semibold text-lg truncate">${value}</p>
        </div>
      </div>`;
  }

  function chartCard(id, title, caption, height = 220) {
    return window.ui.panel({
      title,
      desc: caption,
      body: `<div style="height:${height}px"><canvas id="${id}"></canvas></div>`,
    });
  }

  function renderEmptyIfNeeded(canvas, condition, msg) {
    if (!condition) return false;
    canvas.parentElement.innerHTML = window.ui.empty(msg, "chart-column");
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

  function trendSub(delta, { fallback = "" } = {}) {
    if (delta === undefined) return fallback;
    return window.ui.delta(delta, "vs période précédente");
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
    return window.visibleStats("serverStats").filter(
      (c) => !["distance_meters"].includes(c.key)
    ).map((c) => ({ cat: c, total: players.reduce((sum, p) => sum + (p[c.key] ?? 0), 0) }));
  }

  // Pour chaque statistique du profil : la moyenne de tous les joueurs,
  // le record actuel du serveur (et qui le détient), et le % que représente
  // la moyenne par rapport à ce record. Ces valeurs alimentent à la fois le
  // radar (l'axe) et la légende (le détail exact, pour ne pas laisser le
  // "100%" de chaque axe sans explication).
  function serverProfileRows(players) {
    return window.filterVisibleKeys(PROFILE_KEYS, "serverStats").map((key) => {
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
  // Graphiques Chart.js
  // ---------------------------------------------------------------
  const intAxis = () => {
    const a = window.axisOpts();
    return { ...a, ticks: { ...a.ticks, precision: 0 } };
  };

  function buildPeakHoursChart(sessions) {
    const canvas = document.getElementById("chart-peak-hours");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, sessions.length === 0, "Aucune connexion sur cette période.")) return;
    const counts = peakHours(sessions);
    charts.peakHours = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: counts.map((_, h) => `${h}h`),
        datasets: [{ data: counts, backgroundColor: highlightMax(counts), hoverBackgroundColor: T.ink, borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} connexion(s)` } } },
        scales: {
          x: { ...window.axisOpts(), grid: { display: false }, ticks: { ...window.axisOpts().ticks, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          y: intAxis(),
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
        datasets: [{ data: counts, backgroundColor: highlightMax(counts), hoverBackgroundColor: T.ink, borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} connexion(s)` } } },
        scales: { x: { ...window.axisOpts(), grid: { display: false } }, y: intAxis() },
      },
    });
  }

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
          borderColor: T.ink,
          borderWidth: 1.5,
          backgroundColor: T.fillSoft,
          fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: T.ink,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} joueur(s) unique(s)` } } },
        scales: { x: window.axisOpts(), y: intAxis() },
      },
    });
  }

  function buildComboChart(sessions) {
    const canvas = document.getElementById("chart-combo");
    if (!canvas) return;
    const { labels, counts, avgMinutes } = sessionsPerDay(sessions);
    if (renderEmptyIfNeeded(canvas, labels.length < 2, "Pas encore assez de sessions sur cette période.")) return;
    const ax = window.axisOpts();
    charts.combo = new Chart(canvas.getContext("2d"), {
      data: {
        labels: labels.map((l) => new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [
          { type: "bar", label: "Sessions ouvertes", data: counts, backgroundColor: BAR, hoverBackgroundColor: T.soft, yAxisID: "y", borderRadius: 3 },
          { type: "line", label: "Durée moy. session (min)", data: avgMinutes, borderColor: T.ink, backgroundColor: T.ink, borderWidth: 1.5, yAxisID: "y1", tension: 0.35, pointRadius: 0, pointHoverRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: ax,
          y: { ...ax, position: "left", title: { display: true, text: "sessions", color: T.dim } },
          y1: { ...ax, position: "right", grid: { display: false }, title: { display: true, text: "minutes", color: T.dim } },
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
        datasets: [{ data: counts, backgroundColor: highlightMax(counts), hoverBackgroundColor: T.ink, borderRadius: 3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ...window.axisOpts(), grid: { display: false } }, y: intAxis() },
      },
    });
  }

  function buildNewPlayersChart(firstSeenRows, sinceIso) {
    const canvas = document.getElementById("chart-new-players");
    if (!canvas) return;
    const { labels, values, cumulative } = newPlayersPerBucket(firstSeenRows, sinceIso);
    if (renderEmptyIfNeeded(canvas, labels.length < 1, "Aucun nouveau joueur sur cette période.")) return;
    const ax = intAxis();
    charts.newPlayers = new Chart(canvas.getContext("2d"), {
      data: {
        labels,
        datasets: [
          { type: "bar", label: "Nouveaux joueurs", data: values, backgroundColor: BAR, hoverBackgroundColor: T.soft, yAxisID: "y", borderRadius: 3 },
          { type: "line", label: "Total cumulé", data: cumulative, borderColor: T.ink, backgroundColor: T.ink, borderWidth: 1.5, yAxisID: "y1", tension: 0.35, pointRadius: 0, pointHoverRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: window.axisOpts(),
          y: { ...ax, position: "left" },
          y1: { ...ax, position: "right", grid: { display: false } },
        },
      },
    });
  }

  // Ici la couleur porte une information : récent (vert), tiède (neutre), parti (rouge).
  function buildRetentionChart(lastSeenRows) {
    const canvas = document.getElementById("chart-retention");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, lastSeenRows.length === 0, "Aucune connexion enregistrée pour l'instant.")) return;
    const buckets = retentionBuckets(lastSeenRows);
    charts.retention = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: Object.keys(buckets),
        datasets: [{ data: Object.values(buckets), backgroundColor: [T.green, T.faint, T.red], borderRadius: 3, barThickness: 22 }],
      },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: intAxis(), y: { ...window.axisOpts(), grid: { display: false } } },
      },
    });
  }

  // Radar, avec un tooltip qui donne la valeur exacte (pas juste le %) et une
  // légende à côté qui étale moyenne / record / détenteur du record.
  function buildRadar(players) {
    const canvas = document.getElementById("chart-radar");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, players.length === 0, "Aucun joueur suivi pour l'instant.")) return;
    const rows = serverProfileRows(players);
    charts.radar = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [{
          label: "Moyenne des joueurs",
          data: rows.map((r) => r.pct),
          borderColor: T.ink,
          borderWidth: 1.5,
          backgroundColor: T.fillMid,
          pointRadius: 3,
          pointBackgroundColor: T.ink,
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
          angleLines: { color: T.grid }, grid: { color: T.grid },
          pointLabels: { color: T.dim, font: { size: 10.5 } },
          ticks: { display: false, backdropColor: "transparent" }, min: 0, max: 100,
        } },
      },
    });
    const legendEl = document.getElementById("radar-legend");
    if (legendEl) {
      legendEl.innerHTML = rows.map((row) => {
        const cat = window.statByKey(row.key);
        const avgFmt = window.fmt.statValue(row.key, Math.round(row.avg));
        const maxFmt = window.fmt.statValue(row.key, row.max);
        return `
          <div class="tile p-3">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[12.5px] text-muted flex items-center gap-1.5 min-w-0">${window.catIcon(cat, 13)}<span class="truncate">${cat.short}</span></span>
              <span class="font-mono font-semibold text-sm">${row.pct}%</span>
            </div>
            <p class="text-[11.5px] text-dim mt-1 truncate">${avgFmt} / ${maxFmt}${row.holderName ? ` (${window.esc(row.holderName)})` : ""}</p>
          </div>`;
      }).join("");
    }
  }

  // Classement K/D en liste : même habillage de rang que la page Classements.
  function kdListHTML(top) {
    if (!top.length) return window.ui.empty("Pas encore assez de kills pour établir un classement K/D.", "swords");
    const maxRatio = Math.max(...top.map((t) => t.ratio));
    return `<div class="divide-rows -my-1">` + top.map((t, i) => `
      <div class="flex items-center gap-3 py-2.5">
        ${window.ui.rankBadge(i)}
        <p class="text-sm font-medium w-24 sm:w-36 truncate">${window.esc(t.username)}</p>
        <div class="bar-track flex-1"><div class="bar-fill ${i === 0 ? "" : "soft"}" style="width:${Math.max(4, (t.ratio / maxRatio) * 100).toFixed(0)}%"></div></div>
        <p class="font-mono text-sm font-semibold w-14 text-right">${(Math.round(t.ratio * 100) / 100).toLocaleString("fr-FR")}</p>
      </div>`).join("") + `</div>`;
  }

  // ---------------------------------------------------------------
  // Sous-navigation collante (onglets) + scrollspy
  // ---------------------------------------------------------------
  function subNavHTML() {
    const links = SECTIONS.map(
      (s) => `<a href="#${s.id}" data-section="${s.id}" class="subnav-link">${s.label}</a>`
    ).join("");
    return `<nav id="stats-subnav" class="subnav" aria-label="Sections de la page">${links}</nav>`;
  }

  function bindSubNav() {
    const nav = document.getElementById("stats-subnav");
    if (!nav) return;
    const first = nav.querySelector("a[data-section]");
    first?.classList.add("is-active");
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
          nav.querySelectorAll("a[data-section]").forEach((l) => l.classList.remove("is-active"));
          nav.querySelector(`a[data-section="${entry.target.id}"]`)?.classList.add("is-active");
        });
      },
      { rootMargin: "-120px 0px -70% 0px", threshold: 0 }
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
        <!-- Repères "depuis toujours" : ne dépendent jamais du sélecteur de période. -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          ${window.ui.kpi({
            label: "Âge du serveur",
            value: launch ? `Jour ${window.fmt.int(launch.days)}` : "–",
            sub: launch ? `Première connexion le ${launch.launch.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : "Pas encore de données",
            icon: "calendar",
          })}
          ${window.ui.kpi({ label: "Joueurs suivis", value: window.fmt.int(totalPlayers), icon: "users" })}
          ${window.ui.kpi({ label: "Temps de jeu cumulé", value: window.fmt.duration(totalPlaytimeAllTime), icon: "clock" })}
          ${window.ui.kpi({
            label: "Distance parcourue",
            value: window.fmt.distance(totalDistance),
            sub: `Soit ${laps.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} fois le tour de la Terre`,
            icon: "footprints",
          })}
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
          <p class="text-[13px] text-muted">Le reste de la page suit la période choisie, sauf mention « Depuis toujours ».</p>
          ${periodNavHTML()}
        </div>

        ${subNavHTML()}

        <section id="sec-pouls" class="mb-12 scroll-mt-32">
          ${sectionHeader("Pouls de la communauté", "period")}
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
            ${window.ui.kpi({ label: "Nouveaux joueurs", value: window.fmt.int(firstSeenRows.length), sub: trendSub(deltaPct(firstSeenRows.length, prevNewPlayers, hasPrev), { fallback: `<span class="text-dim">Depuis toujours</span>` }), icon: "user-plus" })}
            ${window.ui.kpi({ label: "Joueurs connectés (uniques)", value: window.fmt.int(uniqueConnected), sub: trendSub(deltaPct(uniqueConnected, prevUniqueConnected, hasPrev)), icon: "plug" })}
            ${window.ui.kpi({ label: "Temps de jeu moyen par joueur", value: window.fmt.duration(avgPlaytimeInPeriod), sub: trendSub(deltaPct(avgPlaytimeInPeriod, prevAvgPlaytime, hasPrev)), icon: "timer" })}
            ${window.ui.kpi({ label: "Sessions moyennes par joueur", value: avgSessionsPerPlayer.toLocaleString("fr-FR", { maximumFractionDigits: 1 }), sub: trendSub(deltaPct(avgSessionsPerPlayer, prevAvgSessions, hasPrev)), icon: "repeat" })}
          </div>

          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            ${chartCard("chart-peak-hours", "Connexions par heure", "À quelle heure ça joue. Le pic ressort en blanc.", 220)}
            ${chartCard("chart-peak-days", "Connexions par jour de la semaine", "Quel jour ça joue. Le pic ressort en blanc.", 220)}
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-active-players", "Joueurs actifs par jour", "Joueurs uniques connectés au moins une fois ce jour-là.", 240)}
            ${chartCard("chart-combo", "Sessions et durée moyenne", "Sessions ouvertes par jour. Un même joueur peut se reconnecter plusieurs fois.", 240)}
          </div>
        </section>

        <section id="sec-joueurs" class="mb-12 scroll-mt-32">
          ${sectionHeader("Joueurs", "period")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
            ${chartCard("chart-new-players", "Nouveaux joueurs et croissance cumulée", `Regroupé par ${groupByMonth ? "mois" : "jour"} sur cette période.`, 240)}
            ${chartCard("chart-session-hist", "Durée des sessions", "Sessions terminées uniquement. Les parties en cours ne sont pas encore comptées.", 240)}
          </div>
          ${sectionHeader("Statut des joueurs", "alltime", "Basé sur la dernière connexion de chaque joueur, tous historiques confondus. Indépendant de la période choisie.")}
          ${chartCard("chart-retention", "Ancienneté depuis la dernière connexion", "", 170)}
        </section>

        <section id="sec-combat" class="mb-12 scroll-mt-32">
          ${sectionHeader("Combat", "alltime")}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            ${window.ui.kpi({
              label: "Ratio K/D global du serveur",
              value: globalRatio.toLocaleString("fr-FR", { maximumFractionDigits: 2 }),
              sub: "Kills PvP divisés par les morts, tous joueurs confondus.",
              icon: "swords",
            })}
            ${window.ui.panel({
              cls: "lg:col-span-2",
              title: "Meilleurs ratios K/D individuels",
              desc: "Top 6, calculé en kills / (morts + 1) pour rester défini même à 0 mort.",
              body: kdListHTML(top),
            })}
          </div>
        </section>

        <section id="sec-records" class="mb-12 scroll-mt-32">
          ${sectionHeader("Records cumulés", "alltime", "Somme de la statistique sur tous les joueurs suivis, depuis toujours.")}
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            ${records.map((r) => {
              const isPlaytime = r.cat.key === "playtime_seconds" || r.cat.key === "playtime";
              const val = isPlaytime
                ? `${window.fmt.int(Math.round(r.total / 3600))} h`
                : window.fmt.int(r.total);
              return recordTile(r.cat, val);
            }).join("")}
          </div>
        </section>

        <section id="sec-profil" class="scroll-mt-32">
          ${sectionHeader("Profil du serveur", "alltime", "Chaque axe est indépendant : 100 % = le record actuel du serveur pour cette statistique précise. Survole un point ou lis la légende pour les valeurs exactes.")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            ${chartCard("chart-radar", "Profil moyen", "", 330)}
            ${window.ui.panel({
              title: "Détail par statistique",
              desc: "Moyenne des joueurs sur record du serveur, avec le détenteur du record entre parenthèses.",
              body: `<div id="radar-legend" class="grid grid-cols-2 gap-2"></div>`,
            })}
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
      contentWrap.innerHTML = window.ui.errorMsg("Erreur lors du chargement des statistiques serveur.");
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      ${window.ui.pageHeader(`Vue d'ensemble de l'activité de ${window.esc(window.APP_CONFIG.SERVER_NAME)}, indépendante des statistiques d'un joueur en particulier.`)}
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
