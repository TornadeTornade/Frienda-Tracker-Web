window.PageLiveFeed = (() => {
  let channel = null;
  const MAX_ITEMS = 60;

  const ICONS = {
    milestone: "🏆",
    overtake: "🔴",
    join: "🟢",
    leave: "⚪",
    default: "✨",
  };

  async function fetchEvents() {
    const { data, error } = await window.sb
      .from("live_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS);
    if (error) throw error;
    return data ?? [];
  }

  function eventItemHTML(evt) {
    const icon = ICONS[evt.event_type] || ICONS.default;
    return `
      <div class="flex items-start gap-3 px-4 py-3 border-b border-border last:border-0">
        <span class="text-lg leading-none mt-0.5">${icon}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm">${evt.message}</p>
          <p class="text-[11px] font-mono text-muted mt-0.5">${window.fmt.timeAgo(evt.created_at)}</p>
        </div>
      </div>`;
  }

  function prependEvent(evt) {
    const list = document.getElementById("live-list");
    if (!list) return;
    const empty = list.querySelector("[data-empty]");
    if (empty) empty.remove();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = eventItemHTML(evt);
    const node = wrapper.firstElementChild;
    node.style.opacity = "0";
    list.prepend(node);
    requestAnimationFrame(() => {
      node.style.transition = "opacity .4s ease";
      node.style.opacity = "1";
    });
  }

  function subscribeRealtime() {
    channel = window.sb
      .channel("live_events_stream")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_events" }, (payload) => {
        prependEvent(payload.new);
      })
      .subscribe();
  }

  function renderAll() {
    const root = document.getElementById("page-root");
    root.innerHTML = `
      <header class="mb-7 flex items-center gap-3">
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight">Live Feed</h1>
          <p class="text-muted text-sm mt-1">Les derniers exploits et mouvements du classement, en direct.</p>
        </div>
        <span class="ml-auto inline-flex items-center gap-1.5 text-[11px] font-mono text-red">
          <span class="w-1.5 h-1.5 rounded-full bg-red live-dot"></span> LIVE
        </span>
      </header>
      <div class="card" id="live-list">${window.skeletonRows(6, "h-14")}</div>
    `;
  }

  async function render() {
    renderAll();
    try {
      const events = await fetchEvents();
      const list = document.getElementById("live-list");
      list.innerHTML = events.length
        ? events.map(eventItemHTML).join("")
        : `<p data-empty class="p-4 text-sm text-muted">Aucun événement pour le moment. Reviens un peu plus tard !</p>`;
    } catch (e) {
      console.error(e);
      document.getElementById("live-list").innerHTML = `<p class="p-4 text-sm text-red">Erreur lors du chargement du fil.</p>`;
    }
    subscribeRealtime();
    return () => { if (channel) window.sb.removeChannel(channel); };
  }

  return { render };
})();
