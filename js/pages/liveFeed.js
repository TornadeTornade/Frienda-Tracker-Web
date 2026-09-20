window.PageLiveFeed = (() => {
  let channel = null;
  const MAX_ITEMS = 60;

  const ICONS = {
    milestone: "trophy",
    overtake: "trending-up",
    join: "log-in",
    leave: "log-out",
    default: "sparkles",
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
      <div class="flex items-start gap-3 px-5 py-3.5">
        <span class="stat-icon">${window.icon(icon, 16)}</span>
        <p class="text-sm flex-1 min-w-0 pt-1.5">${window.esc(evt.message)}</p>
        <p class="text-[12.5px] text-dim shrink-0 pt-1.5">${window.fmt.timeAgo(evt.created_at)}</p>
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
      ${window.ui.pageHeader(
        "Les derniers exploits et mouvements du classement, en direct.",
        `<span class="badge badge-green"><span class="w-1.5 h-1.5 rounded-full bg-green live-dot"></span>En direct</span>`
      )}
      <section class="card overflow-hidden">
        <div class="card-head pb-4 border-b border-border">
          <div>
            <h3 class="card-title">Fil d'activité</h3>
            <p class="card-desc">Les ${MAX_ITEMS} derniers événements, les plus récents en premier.</p>
          </div>
        </div>
        <div id="live-list" class="divide-rows">${window.skeletonRows(6, "h-14")}</div>
      </section>
    `;
  }

  async function render() {
    renderAll();
    try {
      const events = await fetchEvents();
      const list = document.getElementById("live-list");
      list.innerHTML = events.length
        ? events.map(eventItemHTML).join("")
        : `<div data-empty>${window.ui.empty("Aucun événement pour le moment. Les prochains exploits apparaîtront ici dès qu'ils se produisent.", "radio")}</div>`;
    } catch (e) {
      console.error(e);
      document.getElementById("live-list").innerHTML = `<div class="p-5">${window.ui.errorMsg("Erreur lors du chargement du fil.")}</div>`;
    }
    subscribeRealtime();
    return () => { if (channel) window.sb.removeChannel(channel); };
  }

  return { render };
})();
