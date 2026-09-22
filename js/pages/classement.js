window.PageClassement = (() => {
  const HALL_OF_FAME_KEYS = ["playtime_seconds", "player_kills", "blocks_broken", "distance_meters"];

  let players = [];
  let activeKey = "playtime_seconds";
  let expandedUuid = null;

  async function fetchPlayers() {
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    return data ?? [];
  }

  const sum = (key) => players.reduce((s, p) => s + (p[key] ?? 0), 0);

  function sorted(key) {
    return [...players].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  }

  // ---------- KPI ----------
  function kpisHTML() {
    return [
      window.ui.kpi({ label: "Joueurs suivis", value: window.fmt.int(players.length), icon: "users" }),
      window.ui.kpi({ label: "Temps de jeu cumulé", value: window.fmt.duration(sum("playtime_seconds")), icon: "clock" }),
      window.ui.kpi({ label: "Blocs cassés", value: window.fmt.int(sum("blocks_broken")), icon: "pickaxe" }),
      window.ui.kpi({ label: "Distance parcourue", value: window.fmt.distance(sum("distance_meters")), icon: "footprints" }),
    ].join("");
  }

  // ---------- Recordmen ----------
  function recordHolderRow(key) {
    const cat = window.statByKey(key);
    const top = sorted(key)[0];
    if (!top) return "";
    return `
      <div class="flex items-center gap-3 py-3">
        <span class="stat-icon">${window.catIcon(cat, 16)}</span>
        <div class="min-w-0 flex-1">
          <p class="text-[12.5px] text-muted truncate">${cat.label}</p>
          <div class="flex items-center gap-2 mt-0.5">
            ${window.ui.avatar(top.uuid, 18)}
            <p class="text-sm font-medium truncate">${window.esc(top.username)}</p>
          </div>
        </div>
        <p class="font-mono text-sm font-semibold shrink-0">${window.fmt.statValue(key, top[key])}</p>
      </div>`;
  }

  // ---------- Classement ----------
  function categoryNav() {
    return window.visibleStats("classement").map(
      (c) => `<button data-key="${c.key}" class="chip-btn ${c.key === activeKey ? "active" : ""}">${window.catIcon(c, 14)}${c.short}</button>`
    ).join("");
  }

  function detailGrid(p) {
    return `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 px-5 pb-5 pt-1">
        ${window.visibleStats("classement").map(
          (c) => `
          <div class="tile px-3 py-2">
            <p class="text-[12px] text-muted truncate flex items-center gap-1.5">${window.catIcon(c, 12)}${c.short}</p>
            <p class="font-mono font-semibold text-sm mt-0.5">${window.fmt.statValue(c.key, p[c.key])}</p>
          </div>`
        ).join("")}
      </div>`;
  }

  function listHTML() {
    const list = sorted(activeKey);
    if (!list.length) return window.ui.empty("Aucun joueur n'a encore été suivi.", "users");
    const leader = list[0][activeKey] || 0;
    return list
      .map((p, i) => {
        const isOpen = expandedUuid === p.uuid;
        const share = leader > 0 ? Math.max(2, Math.round(((p[activeKey] ?? 0) / leader) * 100)) : 0;
        return `
        <div>
          <button class="player-row w-full flex items-center gap-3 px-5 py-3 text-left" data-toggle="${p.uuid}" aria-expanded="${isOpen}">
            ${window.ui.rankBadge(i)}
            ${window.ui.avatar(p.uuid, 30)}
            <span class="flex-1 min-w-0">
              <span class="block text-sm font-medium truncate">${window.esc(p.username)}</span>
              <span class="block bar-track mt-1.5 max-w-[220px]"><span class="bar-fill ${i === 0 ? "" : "soft"} block" style="width:${share}%"></span></span>
            </span>
            <span class="font-mono text-sm font-semibold shrink-0">${window.fmt.statValue(activeKey, p[activeKey])}</span>
            <span class="text-dim shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}">${window.icon("chevron-down", 16)}</span>
          </button>
          ${isOpen ? detailGrid(p) : ""}
        </div>`;
      })
      .join("");
  }

  function renderList() {
    const listWrap = document.getElementById("classement-list");
    if (listWrap) listWrap.innerHTML = listHTML();
    const desc = document.getElementById("classement-desc");
    if (desc) desc.textContent = `Trié par ${window.statByKey(activeKey).label.toLowerCase()}. Clique sur un joueur pour voir toutes ses statistiques.`;
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      ${window.ui.pageHeader(`Le tableau d'honneur du serveur ${window.esc(window.APP_CONFIG.SERVER_NAME)}.`)}

      <div id="kpi-grid" class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
        ${window.skeletonRows(4, "h-[112px]").replace(/mb-2/g, "")}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <section class="card lg:col-span-2 overflow-hidden">
          <div class="card-head">
            <div>
              <h3 class="card-title">Classement</h3>
              <p class="card-desc" id="classement-desc">Chargement…</p>
            </div>
          </div>
          <div id="cat-nav-wrap" class="flex flex-wrap gap-1.5 px-5 pt-4 pb-4 border-b border-border">${window.skeletonRows(1, "h-8")}</div>
          <div id="classement-list" class="divide-rows">${window.skeletonRows(6, "h-14")}</div>
        </section>

        <div id="hof-wrap" class="lg:sticky lg:top-[72px]">
          ${window.ui.panel({
            title: "Recordmen",
            desc: "Le meilleur joueur dans quatre catégories clés.",
            body: `<div id="hof-grid" class="divide-rows -my-1">${window.skeletonRows(4, "h-12")}</div>`,
          })}
        </div>
      </div>
    `;
  }

  function bindEvents() {
    const catWrap = document.getElementById("cat-nav-wrap");
    catWrap.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-key]");
      if (!btn) return;
      activeKey = btn.dataset.key;
      expandedUuid = null;
      catWrap.innerHTML = categoryNav();
      renderList();
    });

    document.getElementById("classement-list").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-toggle]");
      if (!btn) return;
      const uuid = btn.dataset.toggle;
      expandedUuid = expandedUuid === uuid ? null : uuid;
      renderList();
    });
  }

  async function render() {
    renderAll();
    bindEvents();
    try {
      players = await fetchPlayers();
    } catch (e) {
      console.error(e);
      document.getElementById("classement-list").innerHTML = `<div class="p-5">${window.ui.errorMsg("Impossible de charger le classement.")}</div>`;
      return;
    }

    document.getElementById("kpi-grid").innerHTML = kpisHTML();
    document.getElementById("hof-grid").innerHTML = window.filterVisibleKeys(HALL_OF_FAME_KEYS, "classement").map(recordHolderRow).join("");
    document.getElementById("cat-nav-wrap").innerHTML = categoryNav();
    renderList();
  }

  return { render };
})();
