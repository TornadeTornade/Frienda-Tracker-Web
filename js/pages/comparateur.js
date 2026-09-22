window.PageComparateur = (() => {
  const MAX_PLAYERS = 4;
  const MIN_PLAYERS = 2;

  let allPlayers = []; // {uuid, username}
  let selected = []; // uuid[]
  let globalMax = null; // { [statKey]: maxValue } sur l'ensemble des joueurs
  let radarInstance = null;
  let draggedUuid = null; // uuid en cours de drag dans les chips

  
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
    window.visibleStats("comparateur").forEach((c) => {
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
    if (!selected.length) return `<p class="text-sm text-dim">Aucun joueur sélectionné pour le moment.</p>`;
    return selected
      .map((uuid) => {
        const p = allPlayers.find((x) => x.uuid === uuid);
        const s = window.SERIES[selected.indexOf(uuid)] || window.SERIES[0];
        return `
        <span draggable="true" data-chip="${uuid}" title="Glisser pour réordonner"
          class="inline-flex items-center gap-2 pl-1.5 pr-2 h-9 rounded-lg bg-surface2 border border-border cursor-grab active:cursor-grabbing select-none">
          <span class="text-dim pointer-events-none">${window.icon("grip-vertical", 14)}</span>
          <span class="w-2 h-2 rounded-full pointer-events-none" style="background:${s.color}"></span>
          ${window.ui.avatar(uuid, 20, "pointer-events-none")}
          <span class="text-sm font-medium pointer-events-none">${p ? window.esc(p.username) : uuid}</span>
          <button data-remove="${uuid}" aria-label="Retirer ${p ? window.esc(p.username) : ""}" class="text-dim hover:text-ink ml-0.5 p-0.5 rounded">${window.icon("x", 14)}</button>
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
    if (!matches.length) return `<div class="px-3 py-2.5 text-sm text-muted">Aucun joueur trouvé.</div>`;
    return matches
      .map(
        (p) => `
        <button data-pick="${p.uuid}" class="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface2 text-sm">
          ${window.ui.avatar(p.uuid, 20)}
          ${window.esc(p.username)}
        </button>`
      )
      .join("");
  }

  function cellHTML(cat, value, max) {
    const isMax = value === max && max > 0;
    if (isMax) {
      return `<td class="text-center font-mono text-sm font-semibold">
                <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-green/10 text-green">${window.fmt.statValue(cat.key, value)}</span>
              </td>`;
    }
    const diff = max - value;
    const pct = max > 0 ? Math.round((diff / max) * 100) : 0;
    return `<td class="text-center font-mono text-sm">
              <span class="text-ink">${window.fmt.statValue(cat.key, value)}</span>
              <span class="block text-[11.5px] text-dim mt-0.5">−${pct < 1 ? "<1" : pct} %</span>
            </td>`;
  }

  function tableHTML(stats) {
    if (stats.length < MIN_PLAYERS) {
      return window.ui.empty(`Sélectionne au moins ${MIN_PLAYERS} joueurs pour lancer la comparaison.`, "scale");
    }
    const rows = window.visibleStats("comparateur").map((cat) => {
      const values = stats.map((s) => s[cat.key] ?? 0);
      const max = Math.max(...values);
      return `
        <tr>
          <td class="text-muted text-[13.5px] whitespace-nowrap"><span class="inline-flex items-center gap-2">${window.catIcon(cat, 14, "text-dim")}${cat.label}</span></td>
          ${stats.map((s) => cellHTML(cat, s[cat.key] ?? 0, max)).join("")}
        </tr>`;
    }).join("");

    return `
      <div class="overflow-x-auto">
        <table class="tbl min-w-[520px]">
          <thead>
            <tr>
              <th>Statistique</th>
              ${stats
                .map(
                  (s) => `
                <th class="!text-center">
                  <div class="flex flex-col items-center gap-1.5 py-1">
                    ${window.ui.avatar(s.uuid, 28)}
                    <span class="text-[13px] font-semibold text-ink inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${(window.SERIES[stats.indexOf(s)] || window.SERIES[0]).color}"></span>${window.esc(s.username)}</span>
                  </div>
                </th>`
                )
                .join("")}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
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
        labels: window.visibleStats("comparateur").map((c) => c.short),
        datasets: stats.map((s, i) => {
          const ser = window.SERIES[i] || window.SERIES[0];
          return {
            label: s.username,
            data: window.visibleStats("comparateur").map((c) => Math.round(((s[c.key] ?? 0) / max[c.key]) * 100)),
            borderColor: ser.color,
            borderWidth: 2,
            backgroundColor: ser.color + "1F", // remplissage léger (12 %) pour voir l'aire de chacun
            pointStyle: ser.point,
            pointRadius: 3.5,
            pointHoverRadius: 6,
            pointBackgroundColor: ser.color,
            pointBorderColor: "#0F0F11",
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 250 },
        interaction: { mode: "nearest", intersect: true },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              title: (items) => window.visibleStats("comparateur")[items[0].dataIndex].label,
              label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.r} % du record`,
            },
          },
        },
        scales: {
          r: {
            angleLines: { color: window.THEME.grid },
            grid: { color: window.THEME.grid },
            pointLabels: { color: window.THEME.soft, font: { size: 10.5 } },
            ticks: { display: false, backdropColor: "transparent" },
            suggestedMin: 0, suggestedMax: 100,
          },
        },
      },
    });
  }

  // Met un joueur en avant (survol d'une pastille) : les autres s'estompent.
  function highlightSeries(index) {
    if (!radarInstance) return;
    radarInstance.data.datasets.forEach((ds, i) => {
      const ser = window.SERIES[i] || window.SERIES[0];
      const on = index === null || i === index;
      ds.borderColor = on ? ser.color : ser.color + "5C";
      ds.pointBackgroundColor = on ? ser.color : ser.color + "5C";
      ds.backgroundColor = index === i ? ser.color + "38" : on ? ser.color + "1F" : "transparent";
      ds.borderWidth = index === i ? 3 : 2;
    });
    radarInstance.update();
  }

  async function refreshTable() {
    const wrap = document.getElementById("compare-table-wrap");
    wrap.innerHTML = window.skeletonRows(4, "h-10");
    try {
      const stats = await fetchStatsFor(selected);
      wrap.innerHTML = tableHTML(stats);
      const showExtras = stats.length >= 2;
      document.getElementById("compare-radar-panel").style.display = showExtras ? "" : "none";
      document.getElementById("compare-toolbar").style.display = showExtras ? "" : "none";
      if (showExtras) await renderRadar(stats);
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class="p-5">${window.ui.errorMsg("Erreur lors du chargement des statistiques.")}</div>`;
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      ${window.ui.pageHeader(
        `Compare de ${MIN_PLAYERS} à ${MAX_PLAYERS} joueurs sur l'ensemble des statistiques.`,
        `<div id="compare-toolbar" class="flex gap-2" style="display:none">
           <button id="btn-copy-link" class="btn-outline">${window.icon("link", 15)}Copier le lien</button>
           <button id="btn-export-img" class="btn-outline">${window.icon("image", 15)}Exporter en image</button>
         </div>`
      )}

      <section class="card p-5 mb-4">
        <div class="relative max-w-md">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none">${window.icon("search", 15)}</span>
          <input id="player-search" type="text" placeholder="Ajouter un joueur : rechercher un pseudo…" autocomplete="off" aria-label="Ajouter un joueur"
            class="field !pl-9" />
          <div id="suggestions" class="hidden absolute z-10 left-0 right-0 mt-1 card max-h-64 overflow-y-auto shadow-xl shadow-black/50"></div>
        </div>
        <div class="flex flex-wrap gap-2 mt-4" id="chips">${chipsHTML()}</div>
        <p class="text-[12.5px] text-dim mt-3">Survole une pastille pour mettre un joueur en avant sur le graphique, glisse-la pour changer l'ordre des colonnes.</p>
      </section>

      <div id="compare-export-zone" class="bg-bg">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <section class="card lg:col-span-2 overflow-hidden">
            <div class="card-head pb-3">
              <div>
                <h3 class="card-title">Comparaison</h3>
                <p class="card-desc">En vert, la meilleure valeur du groupe. Les autres affichent l'écart avec elle.</p>
              </div>
            </div>
            <div id="compare-table-wrap" class="pt-1"></div>
          </section>

          <section id="compare-radar-panel" class="card" style="display:none">
            <div class="card-head">
              <div>
                <h3 class="card-title">Profils comparés</h3>
                <p class="card-desc">100 % = le record du serveur sur chaque statistique.</p>
              </div>
            </div>
            <div class="card-body"><div style="height:340px"><canvas id="compare-radar"></canvas></div></div>
          </section>
        </div>
      </div>
    `;
  }

  function bindEvents() {
    const input = document.getElementById("player-search");
    const suggBox = document.getElementById("suggestions");

    input.addEventListener("input", () => {
      if (selected.length >= MAX_PLAYERS) {
        suggBox.innerHTML = `<div class="px-3 py-2.5 text-sm text-muted">Maximum ${MAX_PLAYERS} joueurs.</div>`;
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

    chipsEl.addEventListener("mouseover", (e) => {
      const chip = e.target.closest("[data-chip]");
      if (chip) highlightSeries(selected.indexOf(chip.dataset.chip));
    });
    chipsEl.addEventListener("mouseleave", () => highlightSeries(null));

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
        window.showToast("Lien copié", "success");
      } catch (e) {
        console.error(e);
        window.showToast("Impossible de copier le lien", "error");
      }
    });

    document.getElementById("btn-export-img").addEventListener("click", async () => {
      const zone = document.getElementById("compare-export-zone");
      const btn = document.getElementById("btn-export-img");
      const originalHTML = btn.innerHTML;
      if (typeof html2canvas !== "function") {
        window.showToast("Export indisponible (html2canvas manquant)", "error");
        return;
      }
      btn.textContent = "Export en cours…";
      btn.disabled = true;
      try {
        const canvas = await html2canvas(zone, { backgroundColor: "#09090B", scale: 2 });
        const names = selected
          .map((uuid) => (allPlayers.find((p) => p.uuid === uuid) || {}).username || uuid)
          .join("-vs-");
        const link = document.createElement("a");
        link.download = `comparateur-${names}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } catch (e) {
        console.error(e);
        window.showToast("Erreur lors de l'export", "error");
      } finally {
        btn.innerHTML = originalHTML;
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
