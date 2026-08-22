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

  function sorted(key) {
    return [...players].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
  }

  function hallOfFameCard(key) {
    const cat = window.statByKey(key);
    const top = sorted(key)[0];
    if (!top) return "";
    return `
      <div class="card p-4 flex items-center gap-3 relative overflow-hidden">
        <div class="absolute -right-4 -top-4 text-6xl opacity-10">${cat.icon}</div>
        <img src="${window.avatarHead(top.uuid, 44)}" class="w-11 h-11 rounded-md shadow-slot bg-bg" alt="" />
        <div class="min-w-0">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted truncate">${cat.label}</p>
          <p class="font-bold truncate">${top.username}</p>
          <p class="font-mono text-gold text-sm">${window.fmt.statValue(key, top[key])}</p>
        </div>
      </div>`;
  }

  function categoryNav() {
    return `
      <div class="flex flex-wrap gap-2" id="cat-nav">
        ${window.STAT_CATEGORIES.map(
          (c) => `<button data-key="${c.key}" class="chip-btn ${c.key === activeKey ? "active" : ""}">
                    ${c.icon} ${c.short}
                  </button>`
        ).join("")}
      </div>`;
  }

  function detailGrid(p) {
    return `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 px-4 pb-4 pt-1">
        ${window.STAT_CATEGORIES.map(
          (c) => `
          <div class="rounded-lg bg-bg/60 border border-border px-3 py-2">
            <p class="text-[10px] font-mono uppercase text-muted truncate">${c.icon} ${c.short}</p>
            <p class="font-mono font-semibold text-sm">${window.fmt.statValue(c.key, p[c.key])}</p>
          </div>`
        ).join("")}
      </div>`;
  }

  function listHTML() {
    const list = sorted(activeKey);
    const cat = window.statByKey(activeKey);
    return list
      .map((p, i) => {
        const rank = i + 1;
        const rankClass = rank === 1 ? "r1" : rank === 2 ? "r2" : rank === 3 ? "r3" : "";
        const isOpen = expandedUuid === p.uuid;
        return `
        <div class="card mb-2 overflow-hidden">
          <button class="player-row w-full flex items-center gap-3 px-4 py-3 text-left" data-toggle="${p.uuid}">
            <span class="rank-badge ${rankClass}">${rank}</span>
            <img src="${window.avatarHead(p.uuid, 36)}" class="w-9 h-9 rounded-md shadow-slot bg-bg" alt="" />
            <span class="flex-1 min-w-0">
              <span class="block font-semibold truncate">${p.username}</span>
              <span class="block text-[11px] text-muted font-mono">${cat.icon} ${cat.label}</span>
            </span>
            <span class="font-mono font-bold text-gold shrink-0">${window.fmt.statValue(activeKey, p[activeKey])}</span>
            <span class="text-muted transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}">⌄</span>
          </button>
          ${isOpen ? detailGrid(p) : ""}
        </div>`;
      })
      .join("");
  }

  function renderList() {
    const listWrap = document.getElementById("classement-list");
    if (listWrap) listWrap.innerHTML = listHTML();
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-7">
        <h1 class="text-2xl font-extrabold tracking-tight">Classements</h1>
        <p class="text-muted text-sm mt-1">Le tableau d'honneur du serveur ${window.APP_CONFIG.SERVER_NAME}.</p>
      </header>

      <section class="mb-8">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🏅 Hall of Fame</p>
        <div id="hof-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          ${window.skeletonRows(4, "h-[68px]")}
        </div>
      </section>

      <section>
        <div class="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted">Trier par catégorie</p>
        </div>
        <div id="cat-nav-wrap" class="mb-5">${window.skeletonRows(1, "h-9")}</div>
        <div id="classement-list">${window.skeletonRows(6)}</div>
      </section>
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
      const hof = document.getElementById("hof-grid");
      // le hall of fame reste indépendant de la catégorie sélectionnée
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
      document.getElementById("classement-list").innerHTML =
        `<p class="text-red text-sm">Impossible de charger le classement.</p>`;
      return;
    }

    document.getElementById("hof-grid").innerHTML = HALL_OF_FAME_KEYS.map(hallOfFameCard).join("");
    document.getElementById("cat-nav-wrap").innerHTML = categoryNav();
    renderList();
  }

  return { render };
})();
