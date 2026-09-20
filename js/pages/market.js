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
    if (!grid) return;
    const totalPages = Math.max(1, Math.ceil(allActiveListings.length / SHOP_PAGE_SIZE));
    shopPage = Math.min(Math.max(1, shopPage), totalPages);
    const start = (shopPage - 1) * SHOP_PAGE_SIZE;
    const pageItems = allActiveListings.slice(start, start + SHOP_PAGE_SIZE);
    grid.innerHTML = pageItems.map(shopCardHTML).join("") || `<div class="col-span-full">${window.ui.empty("Aucune annonce active pour le moment.", "store")}</div>`;
    if (pag) pag.innerHTML = shopPaginationHTML(shopPage, totalPages);
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

  function itemSelectorHTML() {
    const opts = itemOptions.map((it) =>
      `<option value="${window.esc(it.item_id)}" ${it.item_id === selectedItemId ? "selected" : ""}>${window.esc(it.item_name ?? it.item_id)}</option>`
    ).join("");
    return `<select id="market-item-select" class="field" aria-label="Item">${opts}</select>`;
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
      const [activeListings, recentTx, txCount, topSellers, topBuyers, topItems] = await Promise.all([
        fetchActiveListings(),
        fetchRecentTransactions(20),
        fetchTransactionCount(),
        fetchTopSellers(),
        fetchTopBuyers(),
        fetchTopItems(),
      ]);

      itemOptions = topItems.map((i) => ({ item_id: i.item_id, item_name: i.item_name }));
      if (!selectedItemId && itemOptions.length) selectedItemId = itemOptions[0].item_id;

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
                ${itemOptions.length ? itemSelectorHTML() : `<p class="text-sm text-muted">Pas encore de ventes à afficher.</p>`}
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
          desc: `${window.fmt.int(activeListings.length)} annonce(s) actuellement en vente, ${SHOP_PAGE_SIZE} par page.`,
          body: `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3" id="market-shop-grid"></div><div id="market-shop-pagination"></div>`,
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

      document.getElementById("market-item-select")?.addEventListener("change", (e) => {
        selectedItemId = e.target.value;
        reloadPriceChart();
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
