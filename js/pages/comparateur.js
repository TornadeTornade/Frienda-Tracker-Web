window.PageComparateur = (() => {
  const MAX_PLAYERS = 4;
  const MIN_PLAYERS = 2;

  let allPlayers = []; // {uuid, username}
  let selected = []; // uuid[]
  let globalMax = null; // { [statKey]: maxValue } sur l'ensemble des joueurs
  let radarInstance = null;
  let draggedUuid = null; // uuid en cours de drag dans les chips

  const RADAR_COLORS = ["#8B6CF2", "#F2B33D", "#48D982", "#F2545B"];

  async function fetchAllPlayersLight() {
    const { data, error } = await window.sb.from("player_stats").select("uuid, username").order("username");
    if (error) throw error;
    return data ?? [];
  }

  async function fetchStatsFor(uuids) {
    if (!uuids.length) return [];
    const { data, error } = await window.sb.from("player_stats").select("*").in("uuid", uuids);
    if (error) throw error;
    // conserver l'ordre de sélection
    return uuids.map((u) => data.find((d) => d.uuid === u)).filter(Boolean);
  }

  async function fetchGlobalMax() {
    if (globalMax) return globalMax;
    const { data, error } = await window.sb.from("player_stats").select("*");
    if (error) throw error;
    globalMax = {};
    window.STAT_CATEGORIES.forEach((c) => {
      globalMax[c.key] = Math.max(1, ...(data ?? []).map((p) => p[c.key] ?? 0));
    });
    return globalMax;
  }

  // --- URL partageable ---------------------------------------------------

  function readSelectedFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get("p") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_PLAYERS);
  }

  function updateUrl() {
    const params = new URLSearchParams(window.location.search);
    if (selected.length) {
      params.set("p", selected.join(","));
    } else {
      params.delete("p");
    }
    const qs = params.toString();
    const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
  }

  // --- Rendu ---------------------------------------------------------------

  function chipsHTML() {
    if (!selected.length) return `<p class="text-sm text-muted">Aucun joueur sélectionné pour le moment.</p>`;
    return selected
      .map((uuid) => {
        const p = allPlayers.find((x) => x.uuid === uuid);
        return `
        <span draggable="true" data-chip="${uuid}" title="Glisser pour réordonner"
          class="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1.5 rounded-full bg-surface2 border border-border cursor-grab active:cursor-grabbing select-none">
          <span class="text-muted text-xs px-0.5 pointer-events-none">⠿</span>
          <img src="${window.avatarHead(uuid, 22)}" class="w-5 h-5 rounded pointer-events-none" alt="" />
          <span class="text-sm font-medium pointer-events-none">${p ? p.username : uuid}</span>
          <button data-remove="${uuid}" class="text-muted hover:text-red text-xs ml-1">✕</button>
        </span>`;
      })
      .join("");
  }

  function suggestionsHTML(query) {
    const q = query.trim().toLowerCase();
    if (!q) return "";
    const matches = allPlayers
      .filter((p) => p.username.toLowerCase().includes(q) && !selected.includes(p.uuid))
      .slice(0, 8);
    if (!matches.length) return `<div class="px-3 py-2 text-sm text-muted">Aucun joueur trouvé.</div>`;
    return matches
      .map(
        (p) => `
        <button data-pick="${p.uuid}" class="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface2 text-sm">
          <img src="${window.avatarHead(p.uuid, 20)}" class="w-5 h-5 rounded" alt="" />
          ${p.username}
        </button>`
      )
      .join("");
  }

  function cellHTML(cat, value, max) {
    const isMax = value === max && max > 0;
    if (isMax) {
      return `<td class="py-2.5 px-3 text-center font-mono text-sm text-green font-bold">
                ${window.fmt.statValue(cat.key, value)}
              </td>`;
    }
    const diff = max - value;
    const pct = max > 0 ? Math.round((diff / max) * 100) : 0;
    return `<td class="py-2.5 px-3 text-center font-mono text-sm text-muted">
              <span class="text-red">−${window.fmt.statValue(cat.key, diff)}</span>
              <span class="block text-[10px] opacity-70">(${pct}%)</span>
            </td>`;
  }

  function tableHTML(stats) {
    if (stats.length < MIN_PLAYERS) {
      return `<p class="text-sm text-muted mt-4">Sélectionne au moins ${MIN_PLAYERS} joueurs pour lancer la comparaison.</p>`;
    }
    const rows = window.STAT_CATEGORIES.map((cat) => {
      const values = stats.map((s) => s[cat.key] ?? 0);
      const max = Math.max(...values);
      return `
        <tr class="border-b border-border last:border-0">
          <td class="py-2.5 pr-3 text-muted text-sm whitespace-nowrap">${cat.icon} ${cat.label}</td>
          ${stats.map((s) => cellHTML(cat, s[cat.key] ?? 0, max)).join("")}
        </tr>`;
    }).join("");

    return `
      <div class="card overflow-x-auto mt-5">
        <table class="w-full min-w-[560px]">
          <thead>
            <tr class="border-b border-border">
              <th class="py-3 pl-4 pr-3 text-left text-[11px] font-mono uppercase text-muted">Statistique</th>
              ${stats
                .map(
                  (s) => `
                <th class="py-3 px-3 text-center">
                  <div class="flex flex-col items-center gap-1.5">
                    <img src="${window.avatarHead(s.uuid, 32)}" class="w-8 h-8 rounded-md shadow-slot bg-bg" alt="" />
                    <span class="text-sm font-semibold">${s.username}</span>
                  </div>
                </th>`
                )
                .join("")}
            </tr>
          </thead>
          <tbody class="[&_td]:px-4">${rows}</tbody>
        </table>
      </div>
      <p class="text-xs text-muted mt-3">🟢 = meilleure valeur du groupe · les autres cellules affichent l'écart par rapport au meilleur.</p>`;
  }

  async function renderRadar(stats) {
    const canvas = document.getElementById("compare-radar");
    if (!canvas) return;
    if (radarInstance) { radarInstance.destroy(); radarInstance = null; }
    if (stats.length < 2) return;

    const max = await fetchGlobalMax();
    radarInstance = new Chart(canvas.getContext("2d"), {
      type: "radar",
      data: {
        labels: window.STAT_CATEGORIES.map((c) => c.short),
        datasets: stats.map((s, i) => ({
          label: s.username,
          data: window.STAT_CATEGORIES.map((c) => Math.round(((s[c.key] ?? 0) / max[c.key]) * 100)),
          borderColor: RADAR_COLORS[i],
          backgroundColor: RADAR_COLORS[i] + "33",
          pointRadius: 2,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { color: "#8B98A8", font: { size: 11 } } } },
        scales: {
          r: {
            angleLines: { color: "#1A222D" },
            grid: { color: "#1A222D" },
            pointLabels: { color: "#8B98A8", font: { size: 9, family: "JetBrains Mono" } },
            ticks: { display: false, backdropColor: "transparent" },
            suggestedMin: 0, suggestedMax: 100,
          },
        },
      },
    });
  }

  async function refreshTable() {
    const wrap = document.getElementById("compare-table-wrap");
    wrap.innerHTML = window.skeletonRows(4, "h-10");
    try {
      const stats = await fetchStatsFor(selected);
      wrap.innerHTML = tableHTML(stats);
      const radarSection = document.getElementById("compare-radar-section");
      const toolbar = document.getElementById("compare-toolbar");
      const showExtras = stats.length >= 2;
      radarSection.style.display = showExtras ? "" : "none";
      toolbar.style.display = showExtras ? "" : "none";
      if (showExtras) await renderRadar(stats);
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<p class="text-red text-sm mt-4">Erreur lors du chargement des statistiques.</p>`;
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-7">
        <h1 class="text-2xl font-extrabold tracking-tight">Comparateur</h1>
        <p class="text-muted text-sm mt-1">Compare de 2 à 4 joueurs sur l'ensemble des statistiques.</p>
      </header>

      <div class="card p-4 relative">
        <label class="block text-[11px] font-mono uppercase tracking-wider text-muted mb-2">Ajouter un joueur</label>
        <input id="player-search" type="text" placeholder="Rechercher un pseudo…" autocomplete="off"
          class="w-full bg-bg border border-border rounded-lg px-3 py-2.5 text-sm outline-none focus:border-enchant transition-colors" />
        <div id="suggestions" class="hidden absolute z-10 left-4 right-4 mt-1 card max-h-64 overflow-y-auto shadow-card"></div>

        <div class="flex flex-wrap gap-2 mt-4" id="chips">${chipsHTML()}</div>
      </div>

      <div class="flex items-center justify-between mt-6 mb-2" id="compare-toolbar" style="display:none">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted">Résultats</p>
        <div class="flex gap-2">
          <button id="btn-copy-link" class="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-surface2 transition-colors">🔗 Copier le lien</button>
          <button id="btn-export-img" class="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-surface2 transition-colors">🖼️ Exporter en image</button>
        </div>
      </div>

      <div id="compare-export-zone">
        <div id="compare-table-wrap"></div>

        <section class="mt-8" id="compare-radar-section" style="display:none">
          <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">🕸️ Profils comparés (toile)</p>
          <div class="card p-4" style="height:340px"><canvas id="compare-radar"></canvas></div>
          <p class="text-xs text-muted mt-2">Chaque axe est normalisé par rapport au record du serveur sur cette statistique (100% = meilleur joueur du serveur).</p>
        </section>
      </div>
    `;
  }

  function bindEvents() {
    const input = document.getElementById("player-search");
    const suggBox = document.getElementById("suggestions");

    input.addEventListener("input", () => {
      if (selected.length >= MAX_PLAYERS) {
        suggBox.innerHTML = `<div class="px-3 py-2 text-sm text-muted">Maximum ${MAX_PLAYERS} joueurs.</div>`;
        suggBox.classList.remove("hidden");
        return;
      }
      suggBox.innerHTML = suggestionsHTML(input.value);
      suggBox.classList.toggle("hidden", !input.value.trim());
    });

    input.addEventListener("blur", () => setTimeout(() => suggBox.classList.add("hidden"), 150));

    suggBox.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-pick]");
      if (!btn) return;
      if (selected.length >= MAX_PLAYERS) return;
      selected.push(btn.dataset.pick);
      input.value = "";
      suggBox.classList.add("hidden");
      document.getElementById("chips").innerHTML = chipsHTML();
      updateUrl();
      refreshTable();
    });

    const chipsEl = document.getElementById("chips");

    chipsEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-remove]");
      if (!btn) return;
      selected = selected.filter((u) => u !== btn.dataset.remove);
      chipsEl.innerHTML = chipsHTML();
      updateUrl();
      refreshTable();
    });

    // Drag-to-reorder des chips (ordre = ordre des colonnes / du radar)
    chipsEl.addEventListener("dragstart", (e) => {
      const chip = e.target.closest("[data-chip]");
      if (!chip) return;
      draggedUuid = chip.dataset.chip;
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", draggedUuid); } catch (_) {}
    });

    chipsEl.addEventListener("dragover", (e) => {
      if (!draggedUuid) return;
      e.preventDefault();
      const chip = e.target.closest("[data-chip]");
      if (!chip) return;
      const targetUuid = chip.dataset.chip;
      if (targetUuid === draggedUuid) return;
      const from = selected.indexOf(draggedUuid);
      const to = selected.indexOf(targetUuid);
      if (from === -1 || to === -1) return;
      selected.splice(from, 1);
      selected.splice(to, 0, draggedUuid);
      chipsEl.innerHTML = chipsHTML();
    });

    chipsEl.addEventListener("drop", (e) => {
      e.preventDefault();
    });

    chipsEl.addEventListener("dragend", () => {
      if (draggedUuid) {
        draggedUuid = null;
        updateUrl();
        refreshTable();
      }
    });

    document.getElementById("btn-copy-link").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        if (window.showToast) window.showToast("Lien copié !", "success");
      } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast("Impossible de copier le lien", "error");
      }
    });

    document.getElementById("btn-export-img").addEventListener("click", async () => {
      const zone = document.getElementById("compare-export-zone");
      const btn = document.getElementById("btn-export-img");
      const originalText = btn.textContent;
      if (typeof html2canvas !== "function") {
        if (window.showToast) window.showToast("Export indisponible (html2canvas manquant)", "error");
        return;
      }
      btn.textContent = "⏳ Export…";
      btn.disabled = true;
      try {
        const canvas = await html2canvas(zone, { backgroundColor: "#0B0F14", scale: 2 });
        const names = selected
          .map((uuid) => (allPlayers.find((p) => p.uuid === uuid) || {}).username || uuid)
          .join("-vs-");
        const link = document.createElement("a");
        link.download = `comparateur-${names}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (e) {
        console.error(e);
        if (window.showToast) window.showToast("Erreur lors de l'export", "error");
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });
  }

  async function render() {
    globalMax = null;
    selected = readSelectedFromUrl();
    renderAll();
    bindEvents();
    document.getElementById("compare-table-wrap").innerHTML = tableHTML([]);
    try {
      allPlayers = await fetchAllPlayersLight();
      // on ne garde que les uuids issus de l'URL qui existent vraiment
      selected = selected.filter((u) => allPlayers.some((p) => p.uuid === u));
      document.getElementById("chips").innerHTML = chipsHTML();
      updateUrl();
      if (selected.length) await refreshTable();
    } catch (e) {
      console.error(e);
      window.showToast("Impossible de charger la liste des joueurs", "error");
    }
    return () => { if (radarInstance) { radarInstance.destroy(); radarInstance = null; } };
  }

  return { render };
})();