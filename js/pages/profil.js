window.PageProfil = (() => {
  const MAX_CARD_STATS = 3;

  let currentPlayer = null;
  let allPlayers = [];
  let allStatsCache = null;
  let chartStatKey = "playtime_seconds";
  let chartPeriod = "month"; // "week" | "month" | "year" | "all"
  const CHART_PERIODS = [
    { key: "week", label: "Semaine" },
    { key: "month", label: "Mois" },
    { key: "year", label: "Année" },
    { key: "all", label: "Tout" },
  ];
  let chartInstance = null;
  let radarInstance = null;
  let radarMode = "avg"; // "avg" | "record"
  let skinViewer3D = null;
  let cardSelectedKeys = [];
  const RADAR_KEYS = ["playtime_seconds", "player_kills", "mob_kills", "blocks_broken", "distance_meters", "jumps"];

  // Stats masquées : voir js/statsVisibility.js
  const visibleCategories = () => window.visibleStats("profil");
  const evolutionCategories = () => window.evolutionStats("profil");

  // ---------- Succès (advancements) ----------
  // Table attendue : player_advancements (une ligne par succès et par joueur).
  // Colonnes lues (tout est optionnel sauf uuid + un identifiant de succès) :
  //   - identifiant : advancement_id | advancement | key | id   (ex. "minecraft:story/mine_diamond")
  //   - état        : completed (bool) OU completed_at (date, null = verrouillé)
  //                   si aucune de ces colonnes n'existe, toute ligne présente = débloqué
  //   - date        : completed_at | unlocked_at | achieved_at
  //   - nom affiché : title | name (sinon dérivé de l'identifiant)
  const ADVANCEMENTS_TABLE = "player_advancements";
  // Noms d'icônes Lucide (voir js/icons.js)
  const ADV_TABS = {
    story: { label: "Histoire", icon: "📖" },
    nether: { label: "Nether", icon: "🔥" },
    end: { label: "End", icon: "🐉" },
    adventure: { label: "Aventure", icon: "🧭" },
    husbandry: { label: "Agriculture", icon: "🌾" },
  };
  
  const ADV_TAB_ORDER = ["story", "nether", "end", "adventure", "husbandry"];
  let advOpenTabs = new Set(["story"]); // onglets dépliés
  const ADV_FILTERS = [
    { key: "all", label: "Tous" },
    { key: "unlocked", label: "Débloqués" },
    { key: "locked", label: "Verrouillés" },
  ];
  let advFilter = "all";
  let currentAdvancements = [];

  // ---------- Favoris (localStorage) ----------
  const FAVORITES_KEY = "frienda_tracker_favorite_players";
  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function setFavorites(list) {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch {
      /* localStorage indisponible, tant pis */
    }
  }
  function isFavorite(username) {
    return getFavorites().some((u) => u.toLowerCase() === username.toLowerCase());
  }
  function toggleFavorite(username) {
    const favs = getFavorites();
    const idx = favs.findIndex((u) => u.toLowerCase() === username.toLowerCase());
    if (idx >= 0) favs.splice(idx, 1);
    else favs.unshift(username);
    setFavorites(favs.slice(0, 20));
  }

  // ---------- Lien partageable ----------
  function getUsernameFromHash() {
    const hash = location.hash || "";
    const qIndex = hash.indexOf("?");
    if (qIndex === -1) return null;
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    return params.get("p");
  }
  function profileShareUrl(username) {
    return `${location.origin}${location.pathname}#profil?p=${encodeURIComponent(username)}`;
  }

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Étoile pleine (favori) ou vide
  const starIcon = (on) => window.icon("star", 18).replace('fill="none"', on ? 'fill="currentColor"' : 'fill="none"');
  // Icône avec couleur explicite : html2canvas sérialise le SVG sans héritage CSS,
  // donc "currentColor" y serait rendu en noir sur la Player Card exportée.
  const cardIcon = (name, size, color) => window.icon(name, size).replace(/currentColor/g, color);

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

  async function fetchSessionsCount(uuid) {
    const { count, error } = await window.sb
      .from("player_sessions")
      .select("*", { count: "exact", head: true })
      .eq("uuid", uuid);
    if (error) return null;
    return count ?? 0;
  }

  // ---------- Succès : requête + normalisation ----------
  function prettifyAdvancementId(id) {
    const last = String(id).split("/").pop().split(":").pop();
    const words = last.replace(/_/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(id);
  }

  function normalizeAdvancement(row) {
    const id = row.advancement_id ?? row.advancement ?? row.key ?? row.id ?? "";
    let unlocked = true;
    if (row.unlocked !== undefined) unlocked = !!row.unlocked;
    else if (row.completed !== undefined) unlocked = !!row.completed;
    else if (row.completed_at !== undefined) unlocked = !!row.completed_at;
    const date = row.completed_at ?? row.unlocked_at ?? row.achieved_at ?? null;
    const path = String(id).split(":").pop();
    const tab = path.includes("/") ? path.split("/")[0] : "other";
    return {
      id: String(id),
      title: row.advancement_name || row.title || row.name || prettifyAdvancementId(id),
      unlocked,
      date: unlocked ? date : null,
      tab,
      icon: ADV_TABS[tab]?.icon ?? "🏅",
    };
  }

  async function fetchAdvancements(uuid) {
    try {
      const { data, error } = await window.sb
        .from(ADVANCEMENTS_TABLE)
        .select("*")
        .eq("uuid", uuid)
        .limit(1000);
      if (error) throw error;
      return (data ?? [])
        .map(normalizeAdvancement)
        .filter((a) => a.id && !/(^|:)recipes\//.test(a.id)) // on ignore les "succès" de recettes
        .sort((a, b) => {
          if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
          const da = a.date ? new Date(a.date).getTime() : 0;
          const db = b.date ? new Date(b.date).getTime() : 0;
          return db - da || a.title.localeCompare(b.title, "fr");
        });
    } catch (e) {
      console.error("Impossible de charger les succès", e);
      return [];
    }
  }

  function summarizeSessions(sessions) {
    const completed = sessions.filter((s) => s.left_at);
    if (!completed.length) return { avgSeconds: 0, longestSeconds: 0 };
    const durations = completed.map((s) => (new Date(s.left_at) - new Date(s.joined_at)) / 1000);
    return {
      avgSeconds: durations.reduce((a, b) => a + b, 0) / durations.length,
      longestSeconds: Math.max(...durations),
    };
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
    return visibleCategories()
      .map((c) => ({ cat: c, rank: rankOf(uuid, c.key, allStats) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, n)
      .map((x) => x.cat.key);
  }

  function filterHistoryByPeriod(history, period) {
    if (period === "all") return history;
    const days = { week: 7, month: 30, year: 365 }[period] ?? 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return history.filter((h) => new Date(h.recorded_at).getTime() >= cutoff);
  }

  function periodChipsHTML() {
    return window.ui.segmented(CHART_PERIODS, chartPeriod, "period", "chart-period-nav");
  }

  function computeRadarData(uuid, allStats, mode) {
    const player = allStats.find((p) => p.uuid === uuid);
    const chartLabels = [];
    const chartPlayerData = [];
    const chartCompareData = [];
    const rows = [];

    window.filterVisibleKeys(RADAR_KEYS, "profil").forEach((key) => {
      const cat = window.statByKey(key);
      const values = allStats.map((p) => p[key] ?? 0);
      const max = Math.max(1, ...values);
      const avg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
      const playerValue = player ? player[key] ?? 0 : 0;
      const compareValue = mode === "record" ? max : avg;

      chartLabels.push(cat.short);
      chartPlayerData.push(Math.round((playerValue / max) * 100));
      chartCompareData.push(Math.round((compareValue / max) * 100));

      let deltaText, deltaClass;
      if (mode === "record") {
        const pct = max > 0 ? Math.round((playerValue / max) * 100) : 0;
        if (max > 0 && playerValue >= max) {
          deltaText = "Record";
          deltaClass = "badge-solid";
        } else {
          deltaText = `${pct}% du record`;
          deltaClass = "";
        }
      } else {
        const diffPct = avg > 0 ? Math.round(((playerValue - avg) / avg) * 100) : playerValue > 0 ? 100 : 0;
        const sign = diffPct >= 0 ? "+" : "";
        deltaText = `${sign}${diffPct}% vs moy.`;
        deltaClass = diffPct >= 0 ? "badge-green" : "badge-red";
      }

      rows.push({ cat, playerValue, compareValue, deltaText, deltaClass });
    });

    return { chartLabels, chartPlayerData, chartCompareData, rows };
  }

  // ---------- Rendu ----------
  function searchBarHTML() {
    return `
      <section class="card p-5 mb-4">
        <div class="relative max-w-md">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none">${window.icon("search", 15)}</span>
          <input id="profil-search" type="text" placeholder="Pseudo du joueur…" autocomplete="off" aria-label="Rechercher un joueur"
            class="field !pl-9" />
          <div id="profil-suggestions" class="hidden absolute z-10 left-0 right-0 mt-1 card max-h-64 overflow-y-auto shadow-xl shadow-black/50"></div>
        </div>
        <div id="profil-favorites"></div>
      </section>`;
  }

  function emptyStateHTML() {
    return `<div class="card">${window.ui.empty("Recherche un pseudo ci-dessus pour afficher son profil complet.", "user")}</div>`;
  }

  function cardStatChipsHTML() {
    return visibleCategories().map((c) => {
      const active = cardSelectedKeys.includes(c.key);
      return `<button data-cardkey="${c.key}" class="chip-btn ${active ? "active" : ""}">${window.catIcon(c, 14)}${c.short}</button>`;
    }).join("");
  }

  function radarBreakdownHTML(rows, mode) {
    const refLabel = mode === "record" ? "Record" : "Moyenne";
    return rows
      .map(
        ({ cat, playerValue, compareValue, deltaText, deltaClass }) => `
        <div class="flex items-center gap-3 px-5 py-3">
          <span class="stat-icon sm">${window.catIcon(cat, 13)}</span>
          <div class="min-w-0 flex-1">
            <p class="text-[12.5px] text-muted truncate">${cat.label}</p>
            <p class="font-mono font-semibold text-sm">${window.fmt.statValue(cat.key, playerValue)}</p>
          </div>
          <div class="text-right shrink-0 hidden xl:block">
            <p class="text-[11.5px] text-dim">${refLabel}</p>
            <p class="font-mono text-[12.5px] text-muted">${window.fmt.statValue(cat.key, compareValue)}</p>
          </div>
          <span class="badge ${deltaClass} shrink-0">${deltaText}</span>
        </div>`
      )
      .join("");
  }

  // Classement du joueur, restylé comme la grille de stats (card 2)
  function rankGridHTML(uuid, allStats) {
    const n = allStats.length || 1;
    return visibleCategories().map((c) => {
      const rank = rankOf(uuid, c.key, allStats);
      return `
        <div class="tile p-3">
          <p class="text-[12.5px] text-muted truncate flex items-center gap-1.5">${window.catIcon(c, 13)}${c.short}</p>
          <p class="font-mono font-semibold text-lg mt-0.5 ${rank === 1 ? "text-ink" : ""}">#${rank}<span class="text-dim text-xs font-normal"> sur ${n}</span></p>
        </div>`;
    }).join("");
  }

  // ---------- Succès : rendu ----------
  
    function advancementFilterChipsHTML() {
    return ADV_FILTERS.map(
      (f) => `<button data-advfilter="${f.key}" class="chip-btn ${f.key === advFilter ? "active" : ""}">${f.label}</button>`
    ).join("");
  }

  function advBadgeHTML(a) {
    const dateLabel = a.unlocked && a.date
      ? new Date(a.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
      : a.unlocked ? "Débloqué" : "Verrouillé";
    return `
      <div class="card p-3 flex items-center gap-3 ${a.unlocked ? "border-gold/40" : "opacity-50 grayscale"}" title="${esc(a.id)}">
        <span class="w-9 h-9 rounded-md bg-bg shadow-slot flex items-center justify-center text-base shrink-0">${a.unlocked ? a.icon : "🔒"}</span>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-bold truncate ${a.unlocked ? "text-ink" : "text-muted"}">${esc(a.title)}</p>
          <p class="text-[10px] font-mono ${a.unlocked ? "text-gold" : "text-muted"}">${dateLabel}</p>
        </div>
      </div>`;
  }

  function advancementGroups(advs) {
    const map = new Map();
    advs.forEach((a) => {
      if (!map.has(a.tab)) map.set(a.tab, []);
      map.get(a.tab).push(a);
    });
    const rank = (k) => { const i = ADV_TAB_ORDER.indexOf(k); return i === -1 ? 99 : i; };
    return [...map.keys()]
      .sort((x, y) => rank(x) - rank(y) || x.localeCompare(y))
      .map((key) => ({
        key,
        meta: ADV_TABS[key] ?? { label: key === "other" ? "Autres" : prettifyAdvancementId(key), icon: "🏅" },
        items: map.get(key),
      }));
  }

  // Un bloc repliable par onglet, avec sa propre progression
  function advancementsListHTML(advs, filter) {
    const html = advancementGroups(advs)
      .map(({ key, meta, items }) => {
        const total = items.length;
        const done = items.filter((a) => a.unlocked).length;
        const pct = Math.round((done / total) * 100);
        const shown = items.filter((a) => (filter === "unlocked" ? a.unlocked : filter === "locked" ? !a.unlocked : true));
        if (!shown.length && filter !== "all") return "";
        return `
        <details data-advtab="${esc(key)}" ${advOpenTabs.has(key) ? "open" : ""} class="card overflow-hidden">
          <summary class="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <span class="text-lg">${meta.icon}</span>
            <span class="font-bold text-sm">${esc(meta.label)}</span>
            <span class="ml-auto font-mono text-xs ${done === total ? "text-gold" : "text-muted"}">${done}/${total}</span>
            <div class="w-20 h-1.5 rounded-full bg-bg shadow-slot overflow-hidden hidden sm:block">
              <div class="h-full bg-gold" style="width:${pct}%"></div>
            </div>
            <span class="text-muted text-xs">▾</span>
          </summary>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4 border-t border-border">
            ${shown.map(advBadgeHTML).join("")}
          </div>
        </details>`;
      })
      .join("");
    return html || `<p class="text-sm text-muted py-4 text-center">Aucun succès dans cette catégorie.</p>`;
  }

  function advancementsSectionHTML(advs) {
    if (!advs.length) {
      return `
      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🏆 Succès</p>
        <div class="card p-4"><p class="text-sm text-muted">Aucun succès enregistré pour ce joueur pour l'instant.</p></div>
      </section>`;
    }
    const unlockedCount = advs.filter((a) => a.unlocked).length;
    const pct = Math.round((unlockedCount / advs.length) * 100);
    return `
      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🏆 Succès</p>
        <div class="card p-4 mb-4">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <p class="text-sm text-muted">
              <span class="text-ink font-bold font-mono">${window.fmt.int(unlockedCount)}</span> / ${window.fmt.int(advs.length)} débloqués
              <span class="font-mono text-gold ml-1">(${pct}%)</span>
            </p>
            <div class="flex flex-wrap gap-2" id="adv-filter-nav">${advancementFilterChipsHTML()}</div>
          </div>
          <div class="h-2 rounded-full bg-bg shadow-slot overflow-hidden">
            <div class="h-full bg-gold" style="width:${pct}%"></div>
          </div>
        </div>
        <div id="adv-list" class="space-y-3">${advancementsListHTML(advs, advFilter)}</div>
      </section>`;
  }

  

  async function profileHTML(p, allStats, sessions, sessionsCount, advancements) {
    const online = await isOnline(p.uuid);
    const fav = isFavorite(p.username);
    const memberSince = p.first_seen
      ? new Date(p.first_seen).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" })
      : "N/A";
    const xpLevelText = p.xp_level != null ? window.fmt.int(p.xp_level) : "N/A";
    const lastSeenBadge =
      !online && sessions.length
        ? window.ui.badge(`Dernière connexion ${window.fmt.timeAgo(sessions[0].joined_at)}`, "", "history")
        : "";
    const { avgSeconds, longestSeconds } = summarizeSessions(sessions);
    const summaryNote =
      sessionsCount != null && sessionsCount > sessions.length
        ? `<p class="text-[12.5px] text-dim mb-3">Moyenne et record calculés sur les ${sessions.length} dernières sessions (${sessionsCount} au total).</p>`
        : "";
    const n = allStats.length || 1;
    const quick = window.filterVisibleKeys(["playtime_seconds", "player_kills", "blocks_broken", "distance_meters"], "profil").map((key) => {
      const cat = window.statByKey(key);
      return `
        <div class="min-w-0">
          <p class="text-[12.5px] text-muted flex items-center gap-1.5 truncate">${window.catIcon(cat, 13)}${cat.short}</p>
          <p class="font-mono font-semibold text-lg mt-0.5 truncate">${window.fmt.statValue(key, p[key])}</p>
          <p class="text-[11.5px] text-dim">#${rankOf(p.uuid, key, allStats)} sur ${n}</p>
        </div>`;
    }).join("");

    return `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <section class="card lg:col-span-2 p-6 flex flex-col">
          <div class="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
            <img src="${window.avatarHead(p.uuid, 128)}" width="64" height="64" class="w-16 h-16 rounded-lg bg-surface2 shrink-0" alt="" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 justify-center sm:justify-start">
                <h2 class="text-xl font-semibold tracking-tight truncate">${esc(p.username)}</h2>
                <button id="fav-toggle-btn" class="shrink-0 p-1.5 rounded-md hover:bg-surface2 transition-colors ${fav ? "text-ink" : "text-dim hover:text-ink"}"
                  title="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${starIcon(fav)}</button>
                <button id="share-profile-btn" class="shrink-0 p-1.5 rounded-md text-dim hover:text-ink hover:bg-surface2 transition-colors" title="Copier le lien du profil" aria-label="Copier le lien du profil">${window.icon("link", 17)}</button>
              </div>
              <p class="text-dim text-xs mt-0.5 truncate">${p.uuid}</p>
              <div class="flex items-center gap-2 mt-3 justify-center sm:justify-start flex-wrap">
                <span class="badge ${online ? "badge-green" : ""}">
                  <span class="w-1.5 h-1.5 rounded-full ${online ? "bg-green live-dot" : "bg-dim"}"></span>${online ? "En ligne" : "Hors ligne"}
                </span>
                ${window.ui.badge(`Niveau XP ${xpLevelText}`, "", "star")}
                ${window.ui.badge(`Membre depuis le ${memberSince}`, "", "calendar")}
                ${lastSeenBadge}
              </div>
            </div>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 mt-6 pt-6 border-t border-border">${quick}</div>
        </section>

        <section class="card p-3">
          <div class="w-full h-[300px] rounded-lg bg-bg overflow-hidden cursor-grab active:cursor-grabbing">
            <canvas id="profil-skin-3d" width="320" height="300" class="w-full h-full"></canvas>
          </div>
        </section>
      </div>

      ${window.ui.panel({
        title: "Statistiques",
        desc: "Toutes les statistiques de ce joueur.",
        cls: "mb-4",
        body: `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          ${visibleCategories().map(
            (c) => `
            <div class="tile p-3">
              <p class="text-[12.5px] text-muted truncate flex items-center gap-1.5">${window.catIcon(c, 13)}${c.short}</p>
              <p class="font-mono font-semibold text-lg mt-0.5">${window.fmt.statValue(c.key, p[c.key])}</p>
            </div>`
          ).join("")}
        </div>`,
      })}

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        ${window.ui.panel({
          title: "Évolution",
          desc: "Historique de la statistique choisie.",
          cls: "lg:col-span-2",
          action: periodChipsHTML(),
          body: `
            <div class="flex flex-wrap gap-1.5 mb-5" id="chart-cat-nav">
              ${evolutionCategories().map(
                (c) => `<button data-key="${c.key}" class="chip-btn ${c.key === chartStatKey ? "active" : ""}">${window.catIcon(c, 14)}${c.short}</button>`
              ).join("")}
            </div>
            <div style="height:300px">
              <canvas id="evo-chart"></canvas>
            </div>
            <div id="evo-empty" class="hidden">${window.ui.empty("Pas encore assez de données historiques sur cette période pour tracer une courbe.", "chart-line")}</div>`,
        })}

        ${window.ui.panel({
          title: "Profil vs serveur",
          desc: "Six statistiques clés. 100 % = record du serveur.",
          action: window.ui.segmented([{ key: "avg", label: "Moyenne" }, { key: "record", label: "Record" }], radarMode, "mode", "radar-mode-nav"),
          body: `<div style="height:300px"><canvas id="profil-radar"></canvas></div>`,
        })}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
        ${window.ui.panel({
          title: "Classement du joueur",
          desc: "Sa place sur le serveur, catégorie par catégorie.",
          cls: "lg:col-span-2",
          body: `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">${rankGridHTML(p.uuid, allStats)}</div>`,
        })}
        ${window.ui.panel({
          title: "Écart avec le serveur",
          desc: "Sur les six statistiques du graphique.",
          bodyCls: "!p-0 pt-1",
          body: `<div class="divide-rows" id="radar-breakdown"></div>`,
        })}
      </div>

      ${advancementsSectionHTML(advancements)}

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        ${window.ui.panel({
          title: "Player Card",
          desc: `Choisis jusqu'à ${MAX_CARD_STATS} statistiques à afficher sur la carte.`,
          body: `
            <div class="flex flex-col sm:flex-row gap-6 items-start">
              <div class="flex-1 min-w-0">
                <p class="text-[12.5px] text-muted mb-3"><span class="text-ink font-medium" id="card-count">0</span> sur ${MAX_CARD_STATS} sélectionnée(s)</p>
                <div class="flex flex-wrap gap-1.5 mb-5" id="card-stat-nav">${cardStatChipsHTML()}</div>
                <button id="gen-card-btn" class="btn">${window.icon("download", 15)}Télécharger la Player Card</button>
                <p class="text-[12px] text-dim mt-2">L'aperçu est à l'échelle. Le fichier téléchargé est en haute résolution.</p>
              </div>
              <div class="mx-auto sm:mx-0 shrink-0">
                <div class="relative rounded-[20px] overflow-hidden border border-border" style="width:220px;aspect-ratio:3/4;">
                  <div id="player-card-preview-inner" style="width:380px;aspect-ratio:3/4;transform-origin:top left;transform:scale(0.5789);"></div>
                </div>
              </div>
            </div>`,
        })}

        ${window.ui.panel({
          title: "Historique de connexions",
          desc: "Les 25 dernières sessions.",
          body: `
            <div class="grid grid-cols-3 gap-3 mb-4">
              <div class="tile p-3"><p class="text-[12.5px] text-muted truncate">Sessions</p><p class="font-mono font-semibold text-lg mt-0.5">${sessionsCount != null ? window.fmt.int(sessionsCount) : "–"}</p></div>
              <div class="tile p-3"><p class="text-[12.5px] text-muted truncate">Durée moyenne</p><p class="font-mono font-semibold text-lg mt-0.5">${avgSeconds ? window.fmt.duration(avgSeconds) : "–"}</p></div>
              <div class="tile p-3"><p class="text-[12.5px] text-muted truncate">Plus longue</p><p class="font-mono font-semibold text-lg mt-0.5">${longestSeconds ? window.fmt.duration(longestSeconds) : "–"}</p></div>
            </div>
            ${summaryNote}
            <div id="sessions-list" class="tile divide-rows max-h-[320px] overflow-y-auto">${sessionsListHTML(sessions)}</div>`,
        })}
      </div>
    `;
  }

  function sessionsListHTML(sessions) {
    if (!sessions.length) return window.ui.empty("Aucune session enregistrée pour l'instant.", "history");
    return sessions
      .map((s) => {
        const duration = s.left_at
          ? window.fmt.duration((new Date(s.left_at) - new Date(s.joined_at)) / 1000)
          : "en cours";
        return `
        <div class="flex items-center justify-between px-4 py-2.5 text-sm">
          <div class="flex items-center gap-2.5">
            <span class="w-1.5 h-1.5 rounded-full ${s.left_at ? "bg-border2" : "bg-green live-dot"}"></span>
            <span>${window.fmt.dateTime(s.joined_at)}</span>
          </div>
          <span class="text-[12.5px] ${s.left_at ? "text-muted" : "text-green"}">${duration}</span>
        </div>`;
      })
      .join("");
  }

  async function renderChart(uuid) {
    const canvas = document.getElementById("evo-chart");
    const emptyMsg = document.getElementById("evo-empty");
    if (!canvas) return;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const fullHistory = await fetchHistory(uuid, chartStatKey);
    const history = filterHistoryByPeriod(fullHistory, chartPeriod);

    if (history.length < 2) {
      canvas.parentElement.classList.add("hidden");
      if (emptyMsg) emptyMsg.classList.remove("hidden");
      return;
    }
    canvas.parentElement.classList.remove("hidden");
    if (emptyMsg) emptyMsg.classList.add("hidden");

    const cat = window.statByKey(chartStatKey);

    const labelFormat =
      chartPeriod === "year" || chartPeriod === "all"
        ? { day: "2-digit", month: "2-digit", year: "2-digit" }
        : { day: "2-digit", month: "2-digit" };

    const T = window.THEME;
    chartInstance = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: history.map((h) => new Date(h.recorded_at).toLocaleDateString("fr-FR", labelFormat)),
        datasets: [
          {
            label: cat.label,
            data: history.map((h) => h[chartStatKey]),
            borderColor: T.ink,
            borderWidth: 1.5,
            backgroundColor: T.fillSoft,
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: T.ink,
            pointHoverBorderColor: "#09090B",
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            bodyColor: T.ink,
            callbacks: {
              title: (items) => window.fmt.dateTime(history[items[0].dataIndex].recorded_at),
              label: (item) => `${cat.label} : ${window.fmt.statValue(chartStatKey, item.parsed.y)}`,
            },
          },
        },
        scales: {
          x: window.axisOpts(),
          y: {
            ...window.axisOpts(),
            ticks: {
              ...window.axisOpts().ticks,
              callback: (value) => window.fmt.statValue(chartStatKey, value),
            },
          },
        },
      },
    });
  }

  function renderProfileRadar(uuid, allStats) {
    const canvas = document.getElementById("profil-radar");
    const breakdown = document.getElementById("radar-breakdown");
    if (!canvas) return;
    if (radarInstance) radarInstance.destroy();

    const { chartLabels, chartPlayerData, chartCompareData, rows } = computeRadarData(uuid, allStats, radarMode);
    const compareLabel = radarMode === "record" ? "Record du serveur" : "Moyenne du serveur";

    const T = window.THEME;
    radarInstance = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels: chartLabels,
        datasets: [
          { label: compareLabel, data: chartCompareData, borderColor: T.dim, borderDash: [4, 3], borderWidth: 1.5, backgroundColor: "transparent", pointRadius: 2, pointBackgroundColor: T.dim },
          {
            label: "Ce joueur",
            data: chartPlayerData,
            borderColor: T.ink,
            borderWidth: 1.5,
            backgroundColor: T.fillMid,
            pointRadius: 3,
            pointHoverRadius: 5,
            pointBackgroundColor: T.ink,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        plugins: { legend: { position: "bottom" } },
        scales: {
          r: {
            angleLines: { color: T.grid },
            grid: { color: T.grid },
            pointLabels: { color: T.dim, font: { size: 10.5 } },
            ticks: { display: false, backdropColor: "transparent" },
            suggestedMin: 0, suggestedMax: 100,
          },
        },
      },
    });

    if (breakdown) breakdown.innerHTML = radarBreakdownHTML(rows, radarMode);
  }

  // ---------- Skin 3D interactif (rotation à la souris/au doigt) ----------
  let skinview3dLibPromise = null;
  function loadSkinview3DLib() {
    // Chargement paresseux du module (une seule fois) : le paquet npm skinview3d
    // n'expose pas de bundle UMD global fiable sur les CDN, on passe donc par
    // l'endpoint ESM de jsDelivr et un import() dynamique.
    if (!skinview3dLibPromise) {
      skinview3dLibPromise = import("https://cdn.jsdelivr.net/npm/skinview3d@3.4.1/+esm");
    }
    return skinview3dLibPromise;
  }

  async function renderSkin3D(uuid) {
    const canvas = document.getElementById("profil-skin-3d");
    if (!canvas) return;

    if (skinViewer3D) {
      skinViewer3D.dispose();
      skinViewer3D = null;
    }

    let lib;
    try {
      lib = await loadSkinview3DLib();
    } catch (e) {
      console.error("Impossible de charger skinview3d", e);
      canvas.parentElement.innerHTML = `<div class="w-full h-full flex items-center justify-center text-dim text-xs px-3 text-center">Skin 3D indisponible (chargement de la librairie impossible)</div>`;
      return;
    }

    // Le canvas peut avoir été remplacé entre-temps si le profil a re-render pendant le chargement.
    const liveCanvas = document.getElementById("profil-skin-3d");
    if (!liveCanvas) return;

    const rect = liveCanvas.parentElement.getBoundingClientRect();
    skinViewer3D = new lib.SkinViewer({
      canvas: liveCanvas,
      width: rect.width || 320,
      height: rect.height || 300,
      skin: `https://mc-heads.net/skin/${uuid}`,
    });
    skinViewer3D.autoRotate = false;
    skinViewer3D.controls.enableZoom = false;
    skinViewer3D.controls.enablePan = false;
    skinViewer3D.zoom = 0.9;
  }

  // ---------- Player Card (export image + aperçu en direct) ----------
  // Bordure via "border" et non "box-shadow: inset" : html2canvas rend mal les ombres internes
  // (cadre gris opaque sur l'image exportée).
  function playerCardInnerHTML(p, selectedKeys, globalRank) {
    return `
      <div style="position:absolute;inset:0;background:linear-gradient(160deg,#1F1F23,#09090B 55%,#09090B);"></div>
      <div style="position:absolute;inset:0;border:1px solid rgba(250,250,250,.22);border-radius:20px;box-sizing:border-box;"></div>
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;height:100%;padding:22px 18px;">
        <div style="font-size:12px;font-weight:500;letter-spacing:.02em;color:#A1A1AA;">Frienda Tracker</div>
        <div style="font-size:36px;font-weight:600;letter-spacing:-.02em;color:#FAFAFA;margin-top:6px;">#${globalRank}</div>
        <img src="${window.avatarBody3D(p.uuid, 190)}" style="height:180px;margin-top:6px;filter:drop-shadow(0 10px 18px rgba(0,0,0,.6));" crossorigin="anonymous" />
        <div style="font-weight:600;font-size:20px;margin-top:8px;">${esc(p.username)}</div>
        <div style="width:100%;height:1px;background:rgba(255,255,255,.12);margin:14px 0;"></div>
        <div style="display:flex;width:100%;justify-content:space-between;gap:8px;">
          ${selectedKeys
            .map((key) => {
              const cat = window.statByKey(key);
              return `
            <div style="flex:1;text-align:center;">
              <div style="display:flex;justify-content:center;height:20px;">${cardIcon(cat.icon, 20, "#A1A1AA")}</div>
              <div style="font-weight:600;font-size:14px;color:#FAFAFA;margin-top:4px;">${window.fmt.statValue(cat.key, p[cat.key])}</div>
              <div style="font-size:10px;color:#A1A1AA;margin-top:2px;">${cat.short}</div>
            </div>`;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function playerCardEmptyPreviewHTML() {
    return `
      <div style="position:absolute;inset:0;background:linear-gradient(160deg,#1F1F23,#09090B 55%,#09090B);"></div>
      <div style="position:absolute;inset:0;border:1px solid #27272A;border-radius:20px;box-sizing:border-box;"></div>
      <div style="position:relative;z-index:1;display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;font-size:13px;color:#A1A1AA;">
        Choisis au moins une statistique pour voir l'aperçu
      </div>
    `;
  }

  function updatePlayerCardPreview(p, allStats) {
    const wrap = document.getElementById("player-card-preview-inner");
    if (!wrap) return;
    if (!cardSelectedKeys.length) {
      wrap.innerHTML = playerCardEmptyPreviewHTML();
      return;
    }
    const globalRank = rankOf(p.uuid, "playtime_seconds", allStats);
    wrap.innerHTML = playerCardInnerHTML(p, cardSelectedKeys, globalRank);
  }

  function buildPlayerCardNode(p, selectedKeys, globalRank) {
    const node = window.el("div", { id: "player-card-export" });
    node.innerHTML = playerCardInnerHTML(p, selectedKeys, globalRank);
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
      window.showToast("Player Card téléchargée", "success");
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
    if (!matches.length) return `<div class="px-3 py-2.5 text-sm text-muted">Aucun joueur trouvé.</div>`;
    return matches
      .map(
        (p) => `<button data-pick="${esc(p.username)}" class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface2 text-sm">
                  ${window.ui.avatar(p.uuid, 20)}${esc(p.username)}
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
    wrap.innerHTML = window.skeletonRows(3, "h-24");
    try {
      const p = await fetchPlayerByUsername(username);
      if (!p) {
        wrap.innerHTML = `<div class="card">${window.ui.empty("Aucun joueur ne porte ce pseudo.", "search")}</div>`;
        return;
      }
      currentPlayer = p;
      history.replaceState(null, "", profileShareUrl(p.username));

      // sélection par défaut de la Player Card = les 3 meilleures catégories du joueur
      const [allStats, sessions, sessionsCount, advancements] = await Promise.all([
        fetchAllStats(),
        fetchSessions(p.uuid),
        fetchSessionsCount(p.uuid),
        fetchAdvancements(p.uuid),
      ]);
      cardSelectedKeys = bestCategoryKeys(p.uuid, allStats, MAX_CARD_STATS);
      currentAdvancements = advancements;
      advFilter = "all";
      advOpenTabs = new Set(["story"]);

      wrap.innerHTML = await profileHTML(p, allStats, sessions, sessionsCount, advancements);
      updateCardCountLabel();
      renderProfileRadar(p.uuid, allStats);
      renderSkin3D(p.uuid);
      updatePlayerCardPreview(p, allStats);

      document.getElementById("fav-toggle-btn").addEventListener("click", (e) => {
        toggleFavorite(p.username);
        const nowFav = isFavorite(p.username);
        const btn = e.currentTarget;
        btn.innerHTML = starIcon(nowFav);
        btn.classList.toggle("text-ink", nowFav);
        btn.classList.toggle("text-dim", !nowFav);
        btn.title = nowFav ? "Retirer des favoris" : "Ajouter aux favoris";
        btn.setAttribute("aria-label", btn.title);
        renderFavoritesRow();
      });

      document.getElementById("share-profile-btn").addEventListener("click", async (e) => {
        const url = profileShareUrl(p.username);
        try {
          await navigator.clipboard.writeText(url);
          window.showToast("Lien du profil copié", "success");
        } catch (err) {
          window.showToast("Impossible de copier le lien", "error");
        }
      });

      document.getElementById("chart-cat-nav").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-key]");
        if (!btn) return;
        chartStatKey = btn.dataset.key;
        window.$$("#chart-cat-nav .chip-btn").forEach((b) => b.classList.toggle("active", b === btn));
        renderChart(p.uuid);
      });

      document.getElementById("chart-period-nav").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-period]");
        if (!btn) return;
        chartPeriod = btn.dataset.period;
        window.$$("#chart-period-nav .chip-btn").forEach((b) => b.classList.toggle("active", b === btn));
        renderChart(p.uuid);
      });

      document.getElementById("radar-mode-nav").addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-mode]");
        if (!btn) return;
        radarMode = btn.dataset.mode;
        window.$$("#radar-mode-nav .chip-btn").forEach((b) => b.classList.toggle("active", b === btn));
        renderProfileRadar(p.uuid, allStats);
      });

            // Filtre + dépliage des succès
      const advNav = document.getElementById("adv-filter-nav");
      const advList = document.getElementById("adv-list");
      if (advNav && advList) {
        advNav.addEventListener("click", (e) => {
          const btn = e.target.closest("button[data-advfilter]");
          if (!btn) return;
          advFilter = btn.dataset.advfilter;
          window.$$("#adv-filter-nav .chip-btn").forEach((b) => b.classList.toggle("active", b === btn));
          advList.innerHTML = advancementsListHTML(currentAdvancements, advFilter);
        });
        // "toggle" ne remonte pas dans le DOM : on l'écoute en phase de capture
        advList.addEventListener("toggle", (e) => {
          const key = e.target?.dataset?.advtab;
          if (key == null) return;
          if (e.target.open) advOpenTabs.add(key);
          else advOpenTabs.delete(key);
        }, true);
      }

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
        updatePlayerCardPreview(p, allStats);
      });

      document.getElementById("gen-card-btn").addEventListener("click", () => generatePlayerCard(p));

      renderChart(p.uuid);
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class="card p-5">${window.ui.errorMsg("Erreur lors du chargement du profil.")}</div>`;
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      ${window.ui.pageHeader("Toutes les informations d'un joueur, en détail.")}
      ${searchBarHTML()}
      <div id="profil-content">${emptyStateHTML()}</div>
    `;
  }

  function favoritesRowHTML() {
    const favs = getFavorites();
    if (!favs.length) return "";
    return `
      <div class="flex items-center gap-2 flex-wrap mt-4">
        <span class="lbl inline-flex items-center gap-1.5 mr-1 shrink-0">${window.icon("star", 14)}Favoris</span>
        ${favs
          .map(
            (u) => `<button data-fav-pick="${esc(u)}" class="chip-btn">
                      <img src="${window.avatarHead(u, 32)}" width="16" height="16" class="w-4 h-4 rounded-sm" alt="" />${esc(u)}
                    </button>`
          )
          .join("")}
      </div>`;
  }

  function renderFavoritesRow() {
    const el = document.getElementById("profil-favorites");
    if (!el) return;
    el.innerHTML = favoritesRowHTML();
    el.querySelectorAll("button[data-fav-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const uname = btn.dataset.favPick;
        const input = document.getElementById("profil-search");
        if (input) input.value = uname;
        loadProfile(uname);
      });
    });
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
    renderFavoritesRow();
    try {
      allPlayers = await fetchAllPlayersLight();
    } catch (e) {
      console.error(e);
    }

    // Lien partageable : #profil?p=Pseudo charge directement ce profil.
    const sharedUsername = getUsernameFromHash();
    if (sharedUsername) {
      const input = document.getElementById("profil-search");
      if (input) input.value = sharedUsername;
      loadProfile(sharedUsername);
    }

    return () => {
      if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
      if (radarInstance) { radarInstance.destroy(); radarInstance = null; }
      if (skinViewer3D) { skinViewer3D.dispose(); skinViewer3D = null; }
    };
  }

  return { render };
})();
