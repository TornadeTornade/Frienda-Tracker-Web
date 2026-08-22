window.PageComparateur = (() => {
  const MAX_PLAYERS = 4;
  const MIN_PLAYERS = 2;

  let allPlayers = []; // {uuid, username}
  let selected = []; // uuid[]

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

  function chipsHTML() {
    if (!selected.length) return `<p class="text-sm text-muted">Aucun joueur sélectionné pour le moment.</p>`;
    return selected
      .map((uuid) => {
        const p = allPlayers.find((x) => x.uuid === uuid);
        return `
        <span class="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full bg-surface2 border border-border">
          <img src="${window.avatarHead(uuid, 22)}" class="w-5 h-5 rounded" alt="" />
          <span class="text-sm font-medium">${p ? p.username : uuid}</span>
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
          ${stats
            .map((s) => {
              const v = s[cat.key] ?? 0;
              const isMax = v === max && max > 0;
              return `<td class="py-2.5 px-3 text-center font-mono text-sm ${isMax ? "text-green font-bold" : "text-ink"}">
                        ${window.fmt.statValue(cat.key, v)}
                      </td>`;
            })
            .join("")}
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
      <p class="text-xs text-muted mt-3">🟢 = meilleure valeur du groupe sur cette statistique.</p>`;
  }

  async function refreshTable() {
    const wrap = document.getElementById("compare-table-wrap");
    wrap.innerHTML = window.skeletonRows(4, "h-10");
    try {
      const stats = await fetchStatsFor(selected);
      wrap.innerHTML = tableHTML(stats);
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

      <div id="compare-table-wrap"></div>
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
      refreshTable();
    });

    document.getElementById("chips").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-remove]");
      if (!btn) return;
      selected = selected.filter((u) => u !== btn.dataset.remove);
      document.getElementById("chips").innerHTML = chipsHTML();
      refreshTable();
    });
  }

  async function render() {
    renderAll();
    bindEvents();
    document.getElementById("compare-table-wrap").innerHTML = tableHTML([]);
    try {
      allPlayers = await fetchAllPlayersLight();
    } catch (e) {
      console.error(e);
      window.showToast("Impossible de charger la liste des joueurs", "error");
    }
  }

  return { render };
})();
