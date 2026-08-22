window.PageServerStats = (() => {
  const EARTH_CIRCUMFERENCE_M = 40075000;
  const PERIODS = [
    { key: "week", label: "Semaine", days: 7 },
    { key: "month", label: "Mois", days: 30 },
    { key: "year", label: "Année", days: 365 },
    { key: "all", label: "Total", days: null },
  ];
  const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  let activePeriod = "month";
  let chartInstance = null;

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

  async function fetchSessions(sinceIso) {
    let q = window.sb.from("player_sessions").select("uuid, username, joined_at, left_at").order("joined_at");
    if (sinceIso) q = q.gte("joined_at", sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  async function fetchHistorySince(sinceIso) {
    let q = window.sb.from("player_stats_history").select("recorded_at, playtime_seconds").order("recorded_at");
    if (sinceIso) q = q.gte("recorded_at", sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

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

  function buildHeatmapMatrix(sessions) {
    // matrix[day][hour] = nombre de connexions démarrées à ce créneau
    const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
    sessions.forEach((s) => {
      const d = new Date(s.joined_at);
      let day = d.getDay(); // 0=dimanche
      day = day === 0 ? 6 : day - 1; // -> 0=lundi ... 6=dimanche
      const hour = d.getHours();
      matrix[day][hour]++;
    });
    return matrix;
  }

  function heatmapHTML(matrix) {
    const max = Math.max(1, ...matrix.flat());
    const cellColor = (v) => {
      if (v === 0) return "#151B23";
      const intensity = v / max;
      // dégradé enchant -> gold selon intensité
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
      rows += `<div class="grid grid-cols-24 gap-[3px] items-center mb-[3px]" style="grid-template-columns:repeat(24,minmax(0,1fr));">${cells}</div>`;
    }
    return `
      <div class="flex gap-2">
        <div class="flex flex-col justify-between py-[2px] text-[10px] font-mono text-muted shrink-0">
          ${DAY_LABELS.map((d) => `<span style="height:calc((100% / 7))">${d}</span>`).join("")}
        </div>
        <div class="flex-1">${rows}</div>
      </div>
      <div class="flex justify-between text-[10px] font-mono text-muted mt-2 px-8">
        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>`;
  }

  function activityChartData(history) {
    // regroupe par jour : dernier snapshot connu du total playtime cumulé (proxy d'activité)
    const byDay = {};
    history.forEach((h) => {
      const day = new Date(h.recorded_at).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1; // nombre de sauvegardes ce jour = proxy d'activité
    });
    const labels = Object.keys(byDay).sort();
    return { labels, values: labels.map((l) => byDay[l]) };
  }

  function renderChart(history) {
    const canvas = document.getElementById("activity-chart");
    if (!canvas) return;
    if (chartInstance) chartInstance.destroy();
    const { labels, values } = activityChartData(history);
    if (labels.length < 2) {
      canvas.parentElement.innerHTML = `<p class="text-sm text-muted py-6 text-center">Pas encore assez d'historique sur cette période.</p>`;
      return;
    }
    chartInstance = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: labels.map((l) => new Date(l).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [{ label: "Activité (sauvegardes)", data: values, backgroundColor: "#8B6CF2" }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#8B98A8" }, grid: { display: false } },
          y: { ticks: { color: "#8B98A8" }, grid: { color: "#1A222D" } },
        },
      },
    });
  }

  async function loadPeriodData() {
    const contentWrap = document.getElementById("stats-content");
    contentWrap.innerHTML = window.skeletonRows(4, "h-24");

    try {
      const sinceIso = periodStartDate(activePeriod);
      const [players, sessions, history] = await Promise.all([
        fetchPlayers(),
        fetchSessions(sinceIso),
        fetchHistorySince(sinceIso),
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

        <section>
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">📊 Activité sur la période</p>
          <div class="card p-4"><canvas id="activity-chart" height="90"></canvas></div>
        </section>
      `;

      renderChart(history);
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
    return () => { if (chartInstance) { chartInstance.destroy(); chartInstance = null; } };
  }

  return { render };
})();
