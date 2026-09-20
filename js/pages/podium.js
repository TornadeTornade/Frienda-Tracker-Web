window.PagePodium = (() => {
  let players = [];
  let activeKey = "playtime_seconds";

  async function fetchPlayers() {
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    return data ?? [];
  }

  const ranked = (key) => [...players].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));

  function categoryNav() {
    return window.STAT_CATEGORIES.map(
      (c) => `<button data-key="${c.key}" class="chip-btn ${c.key === activeKey ? "active" : ""}">${window.catIcon(c, 14)}${c.short}</button>`
    ).join("");
  }

  function podiumStep(p, place, heightClass) {
    if (!p) {
      return `<div class="flex-1 flex flex-col items-center justify-end">
                <div class="podium-step s${place} w-full ${heightClass}"></div>
              </div>`;
    }
    return `
      <div class="flex-1 flex flex-col items-center min-w-0">
        ${window.ui.avatar(p.uuid, place === 1 ? 56 : 48, "mb-3")}
        <p class="font-semibold text-sm text-center truncate max-w-full px-1">${window.esc(p.username)}</p>
        <p class="font-mono text-muted text-[13px] mb-3">${window.fmt.statValue(activeKey, p[activeKey])}</p>
        <div class="podium-step s${place} w-full ${heightClass} !justify-start pt-3">
          <span class="text-2xl font-semibold ${place === 1 ? "text-ink" : "text-muted"}">${place}</span>
        </div>
      </div>`;
  }

  function podiumHTML() {
    const [p1, p2, p3] = ranked(activeKey);
    const cat = window.statByKey(activeKey);
    return `
      <div id="podium-export" class="p-8 bg-surface rounded-xl">
        <div class="text-center mb-8">
          <p class="text-[13px] text-muted">${window.esc(window.APP_CONFIG.SERVER_NAME)}</p>
          <p class="font-semibold text-lg mt-0.5 flex items-center justify-center gap-2">${window.catIcon(cat, 18)}${cat.label}</p>
        </div>
        <div class="flex items-end gap-3 max-w-md mx-auto border-b border-border2">
          ${podiumStep(p2, 2, "h-24")}
          ${podiumStep(p1, 1, "h-32")}
          ${podiumStep(p3, 3, "h-16")}
        </div>
      </div>`;
  }

  function nextRowsHTML() {
    const rest = ranked(activeKey).slice(3, 10);
    if (!rest.length) return window.ui.empty("Pas encore de joueurs au-delà du podium.", "users");
    return `<div class="divide-rows -my-1">${rest
      .map(
        (p, i) => `
        <div class="flex items-center gap-3 py-2.5">
          ${window.ui.rankBadge(i + 3)}
          ${window.ui.avatar(p.uuid, 28)}
          <p class="text-sm font-medium truncate flex-1">${window.esc(p.username)}</p>
          <p class="font-mono text-sm text-muted shrink-0">${window.fmt.statValue(activeKey, p[activeKey])}</p>
        </div>`
      )
      .join("")}</div>`;
  }

  function renderPodium() {
    document.getElementById("podium-wrap").innerHTML = podiumHTML();
    document.getElementById("podium-next").innerHTML = nextRowsHTML();
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      ${window.ui.pageHeader(
        "Le top 3 du serveur, catégorie par catégorie.",
        `<button id="export-btn" class="btn">${window.icon("download", 15)}Exporter en image</button>`
      )}

      <div class="card p-4 mb-4">
        <div class="flex flex-wrap gap-1.5" id="cat-nav">${window.skeletonRows(1, "h-8")}</div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div class="card lg:col-span-2 p-2">
          <div id="podium-wrap">${window.skeletonRows(1, "h-72")}</div>
        </div>
        ${window.ui.panel({
          title: "Places 4 à 10",
          desc: "Ceux qui suivent le podium.",
          body: `<div id="podium-next">${window.skeletonRows(4, "h-10")}</div>`,
        })}
      </div>
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
      if (!node) return;
      try {
        const canvas = await html2canvas(node, { backgroundColor: "#0F0F11", scale: 2, useCORS: true });
        const link = document.createElement("a");
        link.download = `frienda-podium-${activeKey}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        window.showToast("Podium exporté", "success");
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
      document.getElementById("podium-wrap").innerHTML = `<div class="p-6">${window.ui.errorMsg("Erreur de chargement.")}</div>`;
      return;
    }
    document.getElementById("cat-nav").innerHTML = categoryNav();
    renderPodium();
  }

  return { render };
})();
