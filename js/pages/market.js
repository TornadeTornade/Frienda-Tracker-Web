window.PageMarket = (() => {
  const CHART_COLORS = {
    enchant: "#8B6CF2",
    enchant2: "#6D4FE0",
    gold: "#F2B33D",
    green: "#48D982",
    red: "#F2545B",
    silver: "#B9C2CC",
    bronze: "#C97A4A",
    muted: "#8B98A8",
    grid: "#1A222D",
  };
  const MEDAL_COLORS = [CHART_COLORS.gold, CHART_COLORS.silver, CHART_COLORS.bronze];

  // Monnaies possibles côté mod (CurrencyType). `texture` = nom du fichier dans
  // minecraft-assets (textures/item/) pour afficher la vraie icône plutôt qu'un emoji
  // approximatif ; `icon` reste comme repli si jamais l'image ne charge pas.
  const CURRENCIES = [
    { key: "DIAMOND", label: "Diamant", icon: "💎", texture: "diamond" },
    { key: "EMERALD", label: "Émeraude", icon: "🟢", texture: "emerald" },
    { key: "GOLD_INGOT", label: "Lingot d'or", icon: "🟡", texture: "gold_ingot" },
    { key: "IRON_INGOT", label: "Lingot de fer", icon: "⚪", texture: "iron_ingot" },
    { key: "AMETHYST_SHARD", label: "Éclat d'améthyste", icon: "🔮", texture: "amethyst_shard" },
    { key: "NETHERITE_INGOT", label: "Lingot de netherite", icon: "⬛", texture: "netherite_ingot" },
    { key: "GOLDEN_APPLE", label: "Pomme dorée", icon: "🍎", texture: "golden_apple" },
    { key: "ENCHANTED_GOLDEN_APPLE", label: "Pomme dorée enchantée", icon: "✨", texture: "enchanted_golden_apple" },
  ];
  const currencyInfo = (key) => CURRENCIES.find((c) => c.key === key) || { key, label: key, icon: "🔸", texture: null };

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

  // Petite icône inline pour une monnaie (16px par défaut) — vraie texture Minecraft,
  // avec repli automatique sur l'emoji si jamais l'image ne charge pas.
  function currencyIconHTML(key, size = 16) {
    const c = currencyInfo(key);
    if (!c.texture) return c.icon;
    return `<img src="${textureUrl(c.texture)}" alt="${c.label}" title="${c.label}" width="${size}" height="${size}" class="inline-block align-[-3px] [image-rendering:pixelated]" onerror="this.onerror=null;this.replaceWith(document.createTextNode('${c.icon}'))" />`;
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

  // ---------------------------------------------------------------
  // Petits composants (mêmes conventions que serverStats.js)
  // ---------------------------------------------------------------
  function periodBadge(kind) {
    if (kind === "alltime") {
      return `<span class="ml-2 align-middle text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-surface2 text-muted border border-border">All-time</span>`;
    }
    return `<span class="ml-2 align-middle text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-green/15 text-green border border-green/30">Live</span>`;
  }

  function sectionTitle(icon, text, badgeKind, caption) {
    return `
      <div class="mb-3">
        <div class="flex items-center gap-2.5">
          <div class="stat-icon sm">${icon}</div>
          <p class="font-sans text-[15px] font-bold text-ink leading-tight">${text}${badgeKind ? periodBadge(badgeKind) : ""}</p>
        </div>
        ${caption ? `<p class="text-xs text-muted mt-1 ml-[38px]">${caption}</p>` : ""}
      </div>`;
  }

  function subHeading(text) {
    return `<p class="text-[10px] font-mono uppercase tracking-widest text-muted/70 mb-2 mt-6 first:mt-0">${text}</p>`;
  }

  function statCard(icon, label, value, sub) {
    return `
      <div class="card p-4">
        <div class="flex items-center gap-2.5 mb-2">
          <div class="stat-icon">${icon}</div>
          <p class="font-sans text-[13px] font-semibold text-muted leading-tight">${label}</p>
        </div>
        <p class="font-mono font-extrabold text-2xl">${value}</p>
        ${sub ? `<p class="text-xs mt-1 text-muted">${sub}</p>` : ""}
      </div>`;
  }

  function chartCard(id, title, caption, height = 240) {
    return `
      <div class="card p-4">
        <p class="text-[11px] font-mono uppercase tracking-wider text-muted">${title}</p>
        <p class="text-[11px] text-muted/70 mb-3 min-h-[14px]">${caption ?? ""}</p>
        <div style="height:${height}px"><canvas id="${id}"></canvas></div>
      </div>`;
  }

  function emptyStateHTML(msg) {
    return `<div class="h-full flex items-center justify-center min-h-[100px]"><p class="text-sm text-muted text-center px-6">${msg}</p></div>`;
  }

  function renderEmptyIfNeeded(canvas, condition, msg) {
    if (!condition) return false;
    canvas.parentElement.innerHTML = emptyStateHTML(msg);
    return true;
  }

  function destroyCharts() {
    Object.values(charts).forEach((c) => c && c.destroy());
    charts = {};
  }

  const axisOpts = {
    ticks: { color: CHART_COLORS.muted, font: { family: "JetBrains Mono", size: 10 } },
    grid: { color: CHART_COLORS.grid },
  };

  // Classement générique (vendeurs / acheteurs / items) — même habillage rang/médaille
  // que le top K/D de la page Serveur Stats.
  function rankListHTML(rows, { nameKey, valueKey, valueLabel, emptyMsg }) {
    if (!rows.length) return emptyStateHTML(emptyMsg);
    const max = Math.max(...rows.map((r) => r[valueKey] ?? 0), 1);
    return `<div class="space-y-2">` + rows.map((r, i) => `
      <div class="flex items-center gap-3 p-2 rounded-lg ${i < 3 ? "bg-surface2" : ""}">
        <div class="rank-badge ${i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : ""} shrink-0 w-7 h-7 flex items-center justify-center text-xs font-mono font-bold rounded-full border border-border">${i + 1}</div>
        <p class="font-sans text-sm font-semibold text-ink flex-1 truncate">${r[nameKey] ?? "?"}</p>
        <p class="font-mono text-sm font-bold text-ink whitespace-nowrap">${window.fmt.int(r[valueKey] ?? 0)} <span class="text-muted font-normal text-xs">${valueLabel}</span></p>
      </div>`).join("") + `</div>`;
  }

  // Carte boutique : image de l'item, nom, prix, vendeur, date de mise en vente.
  function shopCardHTML(l) {
    return `
      <div class="card p-3 flex flex-col gap-2">
        <div class="w-full aspect-square rounded-lg bg-surface2 flex items-center justify-center overflow-hidden">
          <img src="${itemImageUrl(l.item_id)}" alt="${l.item_name ?? l.item_id}"
               class="w-3/5 h-3/5 object-contain [image-rendering:pixelated]"
               onerror="this.onerror=null;this.replaceWith(Object.assign(document.createElement('span'),{textContent:'📦',className:'text-3xl'}))" />
        </div>
        <div class="min-w-0">
          <p class="font-sans text-sm font-semibold text-ink truncate" title="${l.item_name ?? l.item_id}">${l.item_name ?? l.item_id}${l.item_count > 1 ? ` ×${l.item_count}` : ""}</p>
          <p class="font-mono text-base font-extrabold text-ink mt-0.5">${window.fmt.int(l.price)} ${currencyIconHTML(l.currency)}</p>
        </div>
        <div class="flex items-center gap-2 pt-2 border-t border-border">
          <img src="${window.avatarHead(l.seller_uuid, 24)}" class="w-6 h-6 rounded shrink-0" alt="" />
          <div class="min-w-0 flex-1">
            <p class="text-[11px] text-ink truncate">${l.seller_name}</p>
            <p class="text-[10px] text-muted">${window.fmt.timeAgo(l.listed_at)}</p>
          </div>
        </div>
      </div>`;
  }

  function shopPaginationHTML(page, totalPages) {
    if (totalPages <= 1) return "";
    return `
      <div class="flex items-center justify-center gap-3 mt-4">
        <button data-shop-page="${page - 1}" class="chip-btn" ${page <= 1 ? "disabled" : ""}>← Précédent</button>
        <p class="text-xs font-mono text-muted">Page ${page} / ${totalPages}</p>
        <button data-shop-page="${page + 1}" class="chip-btn" ${page >= totalPages ? "disabled" : ""}>Suivant →</button>
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
    grid.innerHTML = pageItems.map(shopCardHTML).join("") || emptyStateHTML("Aucune annonce active pour le moment.");
    if (pag) pag.innerHTML = shopPaginationHTML(shopPage, totalPages);
  }

  function transactionRowHTML(t) {
    return `
      <div class="flex items-center gap-3 p-2.5 rounded-lg bg-surface2">
        <img src="${window.avatarHead(t.buyer_uuid, 32)}" class="w-8 h-8 rounded shrink-0" alt="" />
        <div class="min-w-0 flex-1">
          <p class="font-sans text-sm text-ink truncate">
            <span class="font-semibold">${t.buyer_name}</span> a acheté
            <span class="font-semibold">${t.item_name ?? t.item_id}${t.item_count > 1 ? ` ×${t.item_count}` : ""}</span>
            à <span class="font-semibold">${t.seller_name}</span>
          </p>
          <p class="text-[11px] text-muted">${window.fmt.timeAgo(t.sold_at)}</p>
        </div>
        <p class="font-mono text-sm font-bold text-gold whitespace-nowrap shrink-0">${window.fmt.int(t.price)} ${currencyIconHTML(t.currency)}</p>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Graphique de cours
  // ---------------------------------------------------------------
  function buildPriceChart(rows) {
    const canvas = document.getElementById("chart-price");
    if (!canvas) return;
    if (renderEmptyIfNeeded(canvas, rows.length === 0, "Aucune vente pour cet item et cette monnaie sur la période choisie.")) return;
    charts.price = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: rows.map((r) => new Date(r.day).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })),
        datasets: [{
          label: "Prix moyen à l'unité",
          data: rows.map((r) => r.avg_unit_price),
          borderColor: CHART_COLORS.gold,
          backgroundColor: "rgba(242,179,61,.18)",
          fill: true, tension: 0.3, pointRadius: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
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
        scales: { x: axisOpts, y: axisOpts },
      },
    });
  }

  function itemSelectorHTML() {
    const opts = itemOptions.map((it) =>
      `<option value="${it.item_id}" ${it.item_id === selectedItemId ? "selected" : ""}>${it.item_name ?? it.item_id}</option>`
    ).join("");
    return `<select id="market-item-select" class="bg-surface2 border border-border rounded-md text-sm text-ink px-3 py-1.5 font-mono">${opts}</select>`;
  }

  function currencySelectorHTML() {
    return CURRENCIES.map((c) =>
      `<button data-currency="${c.key}" class="chip-btn ${c.key === selectedCurrency ? "active" : ""}" title="${c.label}">${currencyIconHTML(c.key, 18)}</button>`
    ).join("");
  }

  function pricePeriodHTML() {
    return PRICE_PERIODS.map(
      (p) => `<button data-price-period="${p.key}" class="chip-btn ${p.key === pricePeriod ? "active" : ""}">${p.label}</button>`
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
        <section id="sec-pouls" class="mb-10 scroll-mt-20">
          ${sectionTitle("🛒", "Pouls du marché", "alltime")}
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            ${statCard("📦", "Annonces actives", window.fmt.int(activeListings.length))}
            ${statCard("💰", "Ventes totales", window.fmt.int(txCount))}
            ${statCard("🏆", "Vendeur le plus actif", topSeller ? topSeller.seller_name : "—", topSeller ? `${window.fmt.int(topSeller.sales_count)} vente(s)` : "")}
            ${statCard("⭐", "Item le plus échangé", topItem ? (topItem.item_name ?? topItem.item_id) : "—", topItem ? `${window.fmt.int(topItem.sales_count)} vente(s)` : "")}
          </div>
        </section>

        <section id="sec-cours" class="mb-10 scroll-mt-20">
          ${sectionTitle("📈", "Cours", null, "Prix moyen à l'unité, par jour, pour l'item et la monnaie sélectionnés.")}
          <div class="flex flex-wrap items-center gap-3 mb-4">
            ${itemOptions.length ? itemSelectorHTML() : `<p class="text-sm text-muted">Pas encore de ventes à afficher.</p>`}
            <div class="flex gap-1.5" id="market-currency-nav">${currencySelectorHTML()}</div>
            <div class="flex gap-1.5 ml-auto" id="market-price-period-nav">${pricePeriodHTML()}</div>
          </div>
          <div class="card p-4">
            <div style="height:280px" id="chart-price-wrap"><canvas id="chart-price"></canvas></div>
          </div>
        </section>

        <section id="sec-boutique" class="mb-10 scroll-mt-20">
          ${sectionTitle("🏪", "Boutique", "alltime", `${window.fmt.int(activeListings.length)} annonce(s) actuellement en vente, ${SHOP_PAGE_SIZE} par page.`)}
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3" id="market-shop-grid"></div>
          <div id="market-shop-pagination"></div>
        </section>

        <section id="sec-classements" class="mb-10 scroll-mt-20">
          ${sectionTitle("🏅", "Classements", "alltime")}
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="card p-4">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">Top vendeurs</p>
              ${rankListHTML(topSellers, { nameKey: "seller_name", valueKey: "sales_count", valueLabel: "ventes", emptyMsg: "Aucune vente enregistrée." })}
            </div>
            <div class="card p-4">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">Top acheteurs</p>
              ${rankListHTML(topBuyers, { nameKey: "buyer_name", valueKey: "purchases_count", valueLabel: "achats", emptyMsg: "Aucun achat enregistré." })}
            </div>
            <div class="card p-4">
              <p class="text-[11px] font-mono uppercase tracking-wider text-muted mb-3">Top items échangés</p>
              ${rankListHTML(topItems.map((i) => ({ ...i, item_name: i.item_name ?? i.item_id })), { nameKey: "item_name", valueKey: "sales_count", valueLabel: "ventes", emptyMsg: "Aucun item échangé." })}
            </div>
          </div>
        </section>

        <section id="sec-activite" class="scroll-mt-20">
          ${sectionTitle("🔴", "Activité récente", "live", "Se rafraîchit automatiquement.")}
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-2" id="market-recent-tx">
            ${recentTx.map(transactionRowHTML).join("") || emptyStateHTML("Aucune vente pour le moment.")}
          </div>
        </section>
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
          if (el) el.innerHTML = tx.map(transactionRowHTML).join("") || emptyStateHTML("Aucune vente pour le moment.");
        } catch (e) { /* silencieux, on retentera au prochain cycle */ }
      }, window.APP_CONFIG.REFRESH_INTERVAL_MS);
    } catch (e) {
      console.error(e);
      contentWrap.innerHTML = `<p class="text-red text-sm">Erreur lors du chargement du marché.</p>`;
    }
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-7">
        <h1 class="text-2xl font-extrabold tracking-tight">Marché</h1>
        <p class="text-muted text-sm mt-1">Cours, annonces et ventes du marché virtuel de ${window.APP_CONFIG.SERVER_NAME}.</p>
      </header>
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
