window.PagePodium = (() => {
  let players = [];
  let activeKey = "playtime_seconds";

  async function fetchPlayers() {
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    return data ?? [];
  }

  function top3(key) {
    return [...players].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, 3);
  }

  function categoryNav() {
    return window.STAT_CATEGORIES.map(
      (c) => `<button data-key="${c.key}" class="chip-btn ${c.key === activeKey ? "active" : ""}">${c.icon} ${c.short}</button>`
    ).join("");
  }

  function podiumStep(p, place, heightClass) {
    if (!p) {
      return `<div class="flex-1 flex flex-col items-center justify-end">
                <div class="podium-step s${place} w-full ${heightClass}"></div>
              </div>`;
    }
    const cat = window.statByKey(activeKey);
    const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
    return `
      <div class="flex-1 flex flex-col items-center">
        <div class="text-2xl mb-1">${medal}</div>
        <img src="${window.avatarHead(p.uuid, 56)}" class="w-14 h-14 rounded-lg shadow-slot bg-bg mb-2" alt="" />
        <p class="font-bold text-sm text-center truncate max-w-[110px]">${p.username}</p>
        <p class="font-mono text-gold text-xs mb-2">${window.fmt.statValue(activeKey, p[activeKey])}</p>
        <div class="podium-step s${place} w-full ${heightClass}"></div>
      </div>`;
  }

  function podiumHTML() {
    const [p1, p2, p3] = top3(activeKey);
    return `
      <div id="podium-export" class="card p-8">
        <div class="text-center mb-6">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted">${window.APP_CONFIG.SERVER_NAME} · Podium</p>
          <p class="font-extrabold text-lg mt-1">${window.statByKey(activeKey).icon} ${window.statByKey(activeKey).label}</p>
        </div>
        <div class="flex items-end gap-3 max-w-md mx-auto">
          ${podiumStep(p2, 2, "h-20")}
          ${podiumStep(p1, 1, "h-28")}
          ${podiumStep(p3, 3, "h-14")}
        </div>
      </div>`;
  }

  function renderPodium() {
    document.getElementById("podium-wrap").innerHTML = podiumHTML();
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-7 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight">Podium</h1>
          <p class="text-muted text-sm mt-1">Le top 3 du serveur, catégorie par catégorie.</p>
        </div>
        <button id="export-btn" class="chip-btn active !bg-gradient-to-b !from-gold !to-[#C98A22] !text-bg !font-bold">
          ⬇️ Exporter en image
        </button>
      </header>

      <div class="flex flex-wrap gap-2 mb-6" id="cat-nav">${window.skeletonRows(1, "h-9")}</div>
      <div id="podium-wrap">${window.skeletonRows(1, "h-64")}</div>
    `;
  }

  function bindEvents() {
    document.getElementById("cat-nav").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-key]");
      if (!btn) return;
      activeKey = btn.dataset.key;
      document.getElementById("cat-nav").innerHTML = categoryNav();
      renderPodium();
    });

    document.getElementById("export-btn").addEventListener("click", async () => {
      const node = document.getElementById("podium-export");
      try {
        const canvas = await html2canvas(node, { backgroundColor: "#0B0F14", scale: 2 });
        const link = document.createElement("a");
        link.download = `frienda-podium-${activeKey}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        window.showToast("Podium exporté !", "success");
      } catch (e) {
        console.error(e);
        window.showToast("Échec de l'export", "error");
      }
    });
  }

  async function render() {
    renderAll();
    bindEvents();
    try {
      players = await fetchPlayers();
    } catch (e) {
      console.error(e);
      document.getElementById("podium-wrap").innerHTML = `<p class="text-red text-sm">Erreur de chargement.</p>`;
      return;
    }
    document.getElementById("cat-nav").innerHTML = categoryNav();
    renderPodium();
  }

  return { render };
})();
