window.PageMarket = (() => {
  // Monnaies possibles côté mod (CurrencyType). `texture` = nom du fichier dans
  // minecraft-assets (textures/item/) pour afficher la vraie icône de l'item ;
  // si l'image ne charge pas, on retombe sur le nom de la monnaie.
  const CURRENCIES = [
    { key: "DIAMOND", label: "Diamant", texture: "diamond" },
    { key: "EMERALD", label: "Émeraude", texture: "emerald" },
    { key: "GOLD_INGOT", label: "Lingot d'or", texture: "gold_ingot" },
    { key: "IRON_INGOT", label: "Lingot de fer", texture: "iron_ingot" },
    { key: "AMETHYST_SHARD", label: "Éclat d'améthyste", texture: "amethyst_shard" },
    { key: "NETHERITE_INGOT", label: "Lingot de netherite", texture: "netherite_ingot" },
    { key: "GOLDEN_APPLE", label: "Pomme dorée", texture: "golden_apple" },
    { key: "ENCHANTED_GOLDEN_APPLE", label: "Pomme dorée enchantée", texture: "enchanted_golden_apple" },
  ];
  const currencyInfo = (key) => CURRENCIES.find((c) => c.key === key) || { key, label: key, texture: null };

  const PRICE_PERIODS = [
    { key: "month", label: "30 jours", days: 30 },
    { key: "quarter", label: "3 mois", days: 90 },
    { key: "all", label: "Tout", days: null },
  ];

  const SHOP_PAGE_SIZE = 12;

  let charts = {};
  let refreshTimer = null;

  let selectedItemId = null;
  let selectedCurrency = "DIAMOND";
  let pricePeriod = "month";
  let itemOptions = []; // [{item_id, item_name}]

  let allActiveListings = []; // toute la boutique, gardée en mémoire pour la pagination côté client
  let shopPage = 1;
  let shopQuery = ""; // recherche texte (nom d'item ou vendeur)
  let shopCurrency = "ALL"; // filtre monnaie de la boutique
  let shopSort = "recent"; // recent | price_asc | price_desc | name_asc

  const SHOP_SORTS = [
    { key: "recent", label: "Plus récentes" },
    { key: "price_asc", label: "Prix croissant" },
    { key: "price_desc", label: "Prix décroissant" },
    { key: "name_asc", label: "Nom (A→Z)" },
  ];

  // Repli quand une texture ne charge pas : icône neutre à la place de l'image cassée.
  window.__imgFallback = (img, size) => {
    const span = document.createElement("span");
    span.className = "text-dim inline-flex";
    span.innerHTML = window.icon("package", size || 28);
    img.replaceWith(span);
  };

  // Texture d'un item, tirée du dépôt public InventivetalentDev/minecraft-assets (miroir des
  // assets vanilla par version). Ne couvre que les items "à icône" — les blocs affichés comme
  // item (ex: minecraft:diamond_block) n'ont pas toujours ce chemin et retombent sur le fallback.
  function textureUrl(name) {
    return `https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures/item/${name}.png`;
  }

  function itemImageUrl(itemId) {
    if (!itemId) return "";
    const name = itemId.includes(":") ? itemId.split(":")[1] : itemId;
    return textureUrl(name);
  }

  // Petite icône inline pour une monnaie — vraie texture Minecraft.
  function currencyIconHTML(key, size = 16) {
    const c = currencyInfo(key);
    if (!c.texture) return `<span class="text-dim text-xs">${window.esc(c.label)}</span>`;
    return `<img src="${textureUrl(c.texture)}" alt="${c.label}" title="${c.label}" width="${size}" height="${size}" class="inline-block align-[-3px] [image-rendering:pixelated]" onerror="window.__imgFallback(this, ${size})" />`;
  }

  // ---------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------
  async function fetchActiveListings() {
    const { data, error } = await window.sb
      .from("market_listings")
      .select("*")
      .eq("status", "active")
      .order("listed_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async function fetchRecentTransactions(limit = 20) {
    const { data, error } = await window.sb
      .from("market_transactions")
      .select("*")
      .order("sold_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  async function fetchTransactionCount() {
    const { count, error } = await window.sb
      .from("market_transactions")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }

  async function fetchTopSellers() {
    const { data, error } = await window.sb
      .from("market_top_sellers")
      .select("*")
      .order("sales_count", { ascending: false })
      .limit(8);
    if (error) throw error;
    return data ?? [];
  }

  async function fetchTopBuyers() {
    const { data, error } = await window.sb
      .from("market_top_buyers")
      .select("*")
      .order("purchases_count", { ascending: false })
      .limit(8);
    if (error) throw error;
    return data ?? [];
  }

  async function fetchTopItems() {
    const { data, error } = await window.sb
      .from("market_top_items")
      .select("*")
      .order("sales_count", { ascending: false })
      .limit(8);
    if (error) throw error;
    return data ?? [];
  }

  // Liste (plus large que le top 8) des items déjà échangés, pour le sélecteur de cours.
  // Pas de vraie SELECT DISTINCT côté client Supabase : on lit un lot large de transactions
  // récentes et on déduplique nous-mêmes. Si l'historique du marché devient énorme, une vue
  // dédiée côté SQL (ex. market_known_items) serait plus propre et plus rapide.
  async function fetchTradedItemNames(limit = 3000) {
    const { data, error } = await window.sb
      .from("market_transactions")
      .select("item_id, item_name")
      .order("sold_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }

  function buildItemOptions(tradedRows, activeListings) {
    const seen = new Map();
    for (const row of tradedRows) {
      if (row.item_id && !seen.has(row.item_id)) seen.set(row.item_id, row.item_name ?? row.item_id);
    }
    // Les items tout juste mis en vente mais jamais encore vendus doivent aussi apparaître.
    for (const l of activeListings) {
      if (l.item_id && !seen.has(l.item_id)) seen.set(l.item_id, l.item_name ?? l.item_id);
    }
    return [...seen.entries()]
      .map(([item_id, item_name]) => ({ item_id, item_name }))
      .sort((a, b) => (a.item_name ?? a.item_id).localeCompare(b.item_name ?? b.item_id, "fr"));
  }

  async function fetchDailyPrices(itemId, currency, sinceIso) {
    if (!itemId) return [];
    let q = window.sb
      .from("market_daily_prices")
      .select("*")
      .eq("item_id", itemId)
      .eq("currency", currency)
      .order("day");
    if (sinceIso) q = q.gte("day", sinceIso);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  function priceSinceIso() {
    const p = PRICE_PERIODS.find((x) => x.key === pricePeriod);
    if (!p.days) return null;
    const d = new Date();
    d.setDate(d.getDate() - p.days);
    return d.toISOString();
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
  }

  // ---------------------------------------------------------------
  // Composants
  // ---------------------------------------------------------------
  // Classement générique (vendeurs / acheteurs / items)
  function rankListHTML(rows, { nameKey, valueKey, valueLabel, emptyMsg }) {
    if (!rows.length) return window.ui.empty(emptyMsg);
    const max = Math.max(...rows.map((r) => r[valueKey] ?? 0), 1);
    return `<div class="divide-rows -my-1">` + rows.map((r, i) => `
      <div class="flex items-center gap-3 py-2.5">
        ${window.ui.rankBadge(i)}
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium truncate">${window.esc(r[nameKey] ?? "?")}</p>
          <div class="bar-track mt-1.5"><div class="bar-fill ${i === 0 ? "" : "soft"}" style="width:${Math.max(3, ((r[valueKey] ?? 0) / max) * 100).toFixed(0)}%"></div></div>
        </div>
        <p class="font-mono text-sm font-semibold whitespace-nowrap">${window.fmt.int(r[valueKey] ?? 0)} <span class="text-dim font-normal text-xs">${valueLabel}</span></p>
      </div>`).join("") + `</div>`;
  }

  // Carte boutique : image de l'item, nom, prix, vendeur, date de mise en vente.
  function shopCardHTML(l) {
    const name = window.esc(l.item_name ?? l.item_id);
    return `
      <div class="card p-3 flex flex-col gap-2.5">
        <div class="w-full aspect-square rounded-lg bg-surface2 flex items-center justify-center overflow-hidden">
          <img src="${itemImageUrl(l.item_id)}" alt="${name}"
               class="w-3/5 h-3/5 object-contain [image-rendering:pixelated]"
               onerror="window.__imgFallback(this, 32)" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-medium truncate" title="${name}">${name}${l.item_count > 1 ? ` ×${l.item_count}` : ""}</p>
          <p class="font-mono text-base font-semibold mt-0.5">${window.fmt.int(l.price)} ${currencyIconHTML(l.currency)}</p>
        </div>
        <div class="flex items-center gap-2 pt-2.5 border-t border-border">
          ${window.ui.avatar(l.seller_uuid, 22)}
          <div class="min-w-0 flex-1">
            <p class="text-xs truncate">${window.esc(l.seller_name)}</p>
            <p class="text-[11.5px] text-dim">${window.fmt.timeAgo(l.listed_at)}</p>
          </div>
        </div>
      </div>`;
  }

  // Filtre + tri de la boutique, appliqués côté client sur allActiveListings.
  function filteredShopListings() {
    let rows = allActiveListings;
    if (shopCurrency !== "ALL") rows = rows.filter((l) => l.currency === shopCurrency);
    const q = shopQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((l) =>
        (l.item_name ?? l.item_id ?? "").toLowerCase().includes(q) || (l.seller_name ?? "").toLowerCase().includes(q)
      );
    }
    rows = [...rows];
    if (shopSort === "price_asc") rows.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    else if (shopSort === "price_desc") rows.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
    else if (shopSort === "name_asc") rows.sort((a, b) => (a.item_name ?? a.item_id ?? "").localeCompare(b.item_name ?? b.item_id ?? "", "fr"));
    else rows.sort((a, b) => new Date(b.listed_at) - new Date(a.listed_at));
    return rows;
  }

  function shopToolbarHTML() {
    const currencyChips = [{ key: "ALL", label: "Toutes" }, ...CURRENCIES].map((c) => `
      <button data-shop-currency="${c.key}" class="chip-btn !px-2 ${c.key === shopCurrency ? "active" : ""}" title="${window.esc(c.label)}" aria-label="${window.esc(c.label)}">
        ${c.key === "ALL" ? "Toutes" : currencyIconHTML(c.key, 18)}
      </button>`).join("");
    const sortOpts = SHOP_SORTS.map((s) => `<option value="${s.key}" ${s.key === shopSort ? "selected" : ""}>${s.label}</option>`).join("");
    return `
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="relative flex-1 min-w-[180px] max-w-xs">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none">${window.icon("search", 15)}</span>
          <input id="market-shop-search" type="text" placeholder="Chercher un item ou un vendeur…" autocomplete="off" aria-label="Chercher dans la boutique"
            value="${window.esc(shopQuery)}" class="field !pl-9" />
        </div>
        <div class="flex flex-wrap gap-1.5" id="market-shop-currency-nav">${currencyChips}</div>
        <select id="market-shop-sort" class="field" aria-label="Trier la boutique">${sortOpts}</select>
      </div>`;
  }

  function shopPaginationHTML(page, totalPages) {
    if (totalPages <= 1) return "";
    return `
      <div class="flex items-center justify-center gap-3 mt-5">
        <button data-shop-page="${page - 1}" class="chip-btn" ${page <= 1 ? "disabled" : ""}>${window.icon("arrow-left", 14)}Précédent</button>
        <p class="text-[12.5px] text-muted">Page ${page} sur ${totalPages}</p>
        <button data-shop-page="${page + 1}" class="chip-btn" ${page >= totalPages ? "disabled" : ""}>Suivant${window.icon("arrow-right", 14)}</button>
      </div>`;
  }

  function renderShopPage() {
    const grid = document.getElementById("market-shop-grid");
    const pag = document.getElementById("market-shop-pagination");
    const countEl = document.getElementById("market-shop-count");
    if (!grid) return;
    const filtered = filteredShopListings();
    const totalPages = Math.max(1, Math.ceil(filtered.length / SHOP_PAGE_SIZE));
    shopPage = Math.min(Math.max(1, shopPage), totalPages);
    const start = (shopPage - 1) * SHOP_PAGE_SIZE;
    const pageItems = filtered.slice(start, start + SHOP_PAGE_SIZE);
    const isFiltered = shopQuery.trim() !== "" || shopCurrency !== "ALL";
    grid.innerHTML = pageItems.map(shopCardHTML).join("") ||
      `<div class="col-span-full">${window.ui.empty(isFiltered ? "Aucune annonce ne correspond à ce filtre." : "Aucune annonce active pour le moment.", "store")}</div>`;
    if (pag) pag.innerHTML = shopPaginationHTML(shopPage, totalPages);
    if (countEl) {
      countEl.textContent = isFiltered
        ? `${window.fmt.int(filtered.length)} annonce(s) sur ${window.fmt.int(allActiveListings.length)} au total, ${SHOP_PAGE_SIZE} par page.`
        : `${window.fmt.int(allActiveListings.length)} annonce(s) actuellement en vente, ${SHOP_PAGE_SIZE} par page.`;
    }
  }

  function transactionRowHTML(t) {
    const item = window.esc(t.item_name ?? t.item_id);
    return `
      <div class="flex items-center gap-3 py-3">
        ${window.ui.avatar(t.buyer_uuid, 30)}
        <div class="min-w-0 flex-1">
          <p class="text-sm truncate">
            <span class="font-medium">${window.esc(t.buyer_name)}</span>
            <span class="text-muted">a acheté</span>
            <span class="font-medium">${item}${t.item_count > 1 ? ` ×${t.item_count}` : ""}</span>
          </p>
          <p class="text-[12px] text-dim">à ${window.esc(t.seller_name)}, ${window.fmt.timeAgo(t.sold_at)}</p>
        </div>
        <p class="font-mono text-sm font-semibold whitespace-nowrap shrink-0">${window.fmt.int(t.price)} ${currencyIconHTML(t.currency)}</p>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Graphique de cours
  // ---------------------------------------------------------------
  function buildPriceChart(rows) {
    const canvas = document.getElementById("chart-price");
    if (!canvas) return;
    if (rows.length === 0) {
      canvas.parentElement.innerHTML = window.ui.empty("Aucune vente pour cet item et cette monnaie sur la période choisie.", "chart-line");
      return;
    }
    const T = window.THEME;
    charts.price = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: rows.map((r) => new Date(r.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [{
          label: "Prix moyen à l'unité",
          data: rows.map((r) => r.avg_unit_price),
          borderColor: T.ink,
          borderWidth: 1.5,
          backgroundColor: T.fillSoft,
          fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
          pointHoverBackgroundColor: T.ink,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = rows[ctx.dataIndex];
                return [`Prix moyen : ${r.avg_unit_price}`, `Min–max : ${r.min_price}–${r.max_price}`, `${r.sales} vente(s), ${r.units} unité(s)`];
              },
            },
          },
        },
        scales: { x: window.axisOpts(), y: window.axisOpts() },
      },
    });
  }

  function selectedItemLabel() {
    const it = itemOptions.find((x) => x.item_id === selectedItemId);
    return it ? (it.item_name ?? it.item_id) : "";
  }

  function itemSearchHTML() {
    return `
      <div class="relative w-full sm:w-64">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none">${window.icon("search", 15)}</span>
        <input id="market-item-search" type="text" placeholder="Chercher un item…" autocomplete="off" aria-label="Choisir un item pour le graphique de cours"
          class="field !pl-9" value="${window.esc(selectedItemLabel())}" />
        <div id="market-item-suggestions" class="hidden absolute z-10 left-0 right-0 mt-1 card max-h-64 overflow-y-auto shadow-xl shadow-black/50"></div>
      </div>`;
  }

  function itemSuggestionsHTML(query) {
    const q = query.trim().toLowerCase();
    const matches = (q
      ? itemOptions.filter((it) => (it.item_name ?? it.item_id).toLowerCase().includes(q) || it.item_id.toLowerCase().includes(q))
      : itemOptions
    ).slice(0, 40);
    if (!matches.length) return `<div class="px-3 py-2.5 text-sm text-muted">Aucun item trouvé.</div>`;
    return matches
      .map((it) => `<button type="button" data-pick-item="${window.esc(it.item_id)}" class="w-full text-left px-3 py-2 text-sm hover:bg-surface2 truncate">${window.esc(it.item_name ?? it.item_id)}</button>`)
      .join("");
  }

  function currencySelectorHTML() {
    return CURRENCIES.map((c) =>
      `<button data-currency="${c.key}" class="chip-btn !px-2 ${c.key === selectedCurrency ? "active" : ""}" title="${c.label}" aria-label="${c.label}">${currencyIconHTML(c.key, 18)}</button>`
    ).join("");
  }

  async function reloadPriceChart() {
    const rows = await fetchDailyPrices(selectedItemId, selectedCurrency, priceSinceIso());
    if (charts.price) { charts.price.destroy(); delete charts.price; }
    const wrap = document.getElementById("chart-price-wrap");
    if (wrap) wrap.innerHTML = `<canvas id="chart-price"></canvas>`;
    buildPriceChart(rows);
  }

  // ---------------------------------------------------------------
  // Chargement + rendu
  // ---------------------------------------------------------------
  async function loadContent() {
    const contentWrap = document.getElementById("market-content");
    contentWrap.innerHTML = window.skeletonRows(4, "h-24");
    destroyCharts();

    try {
      const [activeListings, recentTx, txCount, topSellers, topBuyers, topItems, tradedItemNames] = await Promise.all([
        fetchActiveListings(),
        fetchRecentTransactions(20),
        fetchTransactionCount(),
        fetchTopSellers(),
        fetchTopBuyers(),
        fetchTopItems(),
        fetchTradedItemNames(),
      ]);

      itemOptions = buildItemOptions(tradedItemNames, activeListings);
      // Par défaut, on pointe sur l'item le plus échangé (plus parlant qu'un choix alphabétique) ;
      // si l'item déjà sélectionné n'existe plus dans la liste, on retombe dessus aussi.
      if (!selectedItemId || !itemOptions.some((it) => it.item_id === selectedItemId)) {
        selectedItemId = topItems[0]?.item_id ?? itemOptions[0]?.item_id ?? null;
      }

      allActiveListings = activeListings;
      shopPage = 1;

      const topSeller = topSellers[0];
      const topItem = topItems[0];

      contentWrap.innerHTML = `
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
          ${window.ui.kpi({ label: "Annonces actives", value: window.fmt.int(activeListings.length), icon: "tag" })}
          ${window.ui.kpi({ label: "Ventes totales", value: window.fmt.int(txCount), icon: "coins" })}
          ${window.ui.kpi({ label: "Vendeur le plus actif", value: topSeller ? window.esc(topSeller.seller_name) : "–", sub: topSeller ? `${window.fmt.int(topSeller.sales_count)} vente(s)` : "", icon: "trophy" })}
          ${window.ui.kpi({ label: "Item le plus échangé", value: topItem ? window.esc(topItem.item_name ?? topItem.item_id) : "–", sub: topItem ? `${window.fmt.int(topItem.sales_count)} vente(s)` : "", icon: "star" })}
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4 items-start">
          ${window.ui.panel({
            id: "sec-cours",
            cls: "lg:col-span-2",
            title: "Cours",
            desc: "Prix moyen à l'unité, par jour, pour l'item et la monnaie sélectionnés.",
            action: window.ui.segmented(PRICE_PERIODS, pricePeriod, "price-period", "market-price-period-nav"),
            body: `
              <div class="flex flex-wrap items-center gap-3 mb-4">
                ${itemOptions.length ? itemSearchHTML() : `<p class="text-sm text-muted">Pas encore de ventes à afficher.</p>`}
                <div class="flex flex-wrap gap-1.5" id="market-currency-nav">${currencySelectorHTML()}</div>
              </div>
              <div style="height:290px" id="chart-price-wrap"><canvas id="chart-price"></canvas></div>`,
          })}

          <section id="sec-activite" class="card overflow-hidden">
            <div class="card-head pb-3">
              <div>
                <h3 class="card-title">Activité récente</h3>
                <p class="card-desc">Se rafraîchit automatiquement.</p>
              </div>
            </div>
            <div id="market-recent-tx" class="divide-rows px-5 max-h-[440px] overflow-y-auto">
              ${recentTx.map(transactionRowHTML).join("") || window.ui.empty("Aucune vente pour le moment.", "coins")}
            </div>
          </section>
        </div>

        <div id="sec-classements" class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          ${window.ui.panel({ title: "Top vendeurs", desc: "Depuis le lancement du marché.", body: rankListHTML(topSellers, { nameKey: "seller_name", valueKey: "sales_count", valueLabel: "ventes", emptyMsg: "Aucune vente enregistrée." }) })}
          ${window.ui.panel({ title: "Top acheteurs", desc: "Depuis le lancement du marché.", body: rankListHTML(topBuyers, { nameKey: "buyer_name", valueKey: "purchases_count", valueLabel: "achats", emptyMsg: "Aucun achat enregistré." }) })}
          ${window.ui.panel({ title: "Items les plus échangés", desc: "Depuis le lancement du marché.", body: rankListHTML(topItems.map((i) => ({ ...i, item_name: i.item_name ?? i.item_id })), { nameKey: "item_name", valueKey: "sales_count", valueLabel: "ventes", emptyMsg: "Aucun item échangé." }) })}
        </div>

        ${window.ui.panel({
          id: "sec-boutique",
          title: "Boutique",
          desc: `<span id="market-shop-count">${window.fmt.int(activeListings.length)} annonce(s) actuellement en vente, ${SHOP_PAGE_SIZE} par page.</span>`,
          body: `
            ${shopToolbarHTML()}
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3" id="market-shop-grid"></div><div id="market-shop-pagination"></div>`,
        })}
      `;

      renderShopPage();
      document.getElementById("market-shop-pagination")?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-shop-page]");
        if (!btn || btn.disabled) return;
        shopPage = parseInt(btn.dataset.shopPage, 10);
        renderShopPage();
        document.getElementById("sec-boutique")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      buildPriceChart(await fetchDailyPrices(selectedItemId, selectedCurrency, priceSinceIso()));

      // Recherche d'item pour le graphique de cours (autocomplétion, comme la recherche joueur).
      const itemSearchInput = document.getElementById("market-item-search");
      const itemSuggBox = document.getElementById("market-item-suggestions");
      itemSearchInput?.addEventListener("input", () => {
        itemSuggBox.innerHTML = itemSuggestionsHTML(itemSearchInput.value);
        itemSuggBox.classList.remove("hidden");
      });
      itemSearchInput?.addEventListener("focus", () => {
        itemSuggBox.innerHTML = itemSuggestionsHTML(itemSearchInput.value);
        itemSuggBox.classList.remove("hidden");
      });
      itemSearchInput?.addEventListener("blur", () => {
        // Laisse le temps au clic sur une suggestion de se déclencher avant de fermer/réinitialiser.
        setTimeout(() => {
          itemSuggBox.classList.add("hidden");
          itemSearchInput.value = selectedItemLabel();
        }, 150);
      });
      itemSuggBox?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-pick-item]");
        if (!btn) return;
        selectedItemId = btn.dataset.pickItem;
        itemSearchInput.value = selectedItemLabel();
        itemSuggBox.classList.add("hidden");
        reloadPriceChart();
      });

      // Recherche + tri de la boutique.
      document.getElementById("market-shop-search")?.addEventListener("input", (e) => {
        shopQuery = e.target.value;
        shopPage = 1;
        renderShopPage();
      });
      document.getElementById("market-shop-currency-nav")?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-shop-currency]");
        if (!btn) return;
        shopCurrency = btn.dataset.shopCurrency;
        shopPage = 1;
        document.querySelectorAll("#market-shop-currency-nav .chip-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderShopPage();
      });
      document.getElementById("market-shop-sort")?.addEventListener("change", (e) => {
        shopSort = e.target.value;
        shopPage = 1;
        renderShopPage();
      });

      document.getElementById("market-currency-nav")?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-currency]");
        if (!btn) return;
        selectedCurrency = btn.dataset.currency;
        document.querySelectorAll("#market-currency-nav .chip-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        reloadPriceChart();
      });
      document.getElementById("market-price-period-nav")?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-price-period]");
        if (!btn) return;
        pricePeriod = btn.dataset.pricePeriod;
        document.querySelectorAll("#market-price-period-nav .chip-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        reloadPriceChart();
      });

      // Rafraîchissement léger : seulement le flux d'activité récente, sans reconstruire toute la page.
      clearInterval(refreshTimer);
      refreshTimer = setInterval(async () => {
        try {
          const tx = await fetchRecentTransactions(20);
          const el = document.getElementById("market-recent-tx");
          if (el) el.innerHTML = tx.map(transactionRowHTML).join("") || window.ui.empty("Aucune vente pour le moment.", "coins");
        } catch (e) { /* silencieux, on retentera au prochain cycle */ }
      }, window.APP_CONFIG.REFRESH_INTERVAL_MS);
    } catch (e) {
      console.error(e);
      contentWrap.innerHTML = window.ui.errorMsg("Erreur lors du chargement du marché.");
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      ${window.ui.pageHeader(`Cours, annonces et ventes du marché virtuel de ${window.esc(window.APP_CONFIG.SERVER_NAME)}.`)}
      <div id="market-content">${window.skeletonRows(4, "h-24")}</div>
    `;
  }

  async function render() {
    renderAll();
    await loadContent();
    return () => {
      destroyCharts();
      clearInterval(refreshTimer);
    };
  }

  return { render };
})();