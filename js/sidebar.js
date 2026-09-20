// Navigation : groupes → entrées. `title` alimente la barre du haut (voir router.js).
window.SIDEBAR_GROUPS = [
  {
    label: "Joueurs",
    items: [
      { hash: "#classement", label: "Classements", icon: "trophy" },
      { hash: "#podium", label: "Podium", icon: "medal" },
      { hash: "#comparateur", label: "Comparateur", icon: "scale" },
      { hash: "#profil", label: "Profils", icon: "user" },
    ],
  },
  {
    label: "Serveur",
    items: [
      { hash: "#stats", label: "Statistiques", icon: "chart-column" },
      { hash: "#market", label: "Marché", icon: "store" },
      { hash: "#live", label: "Live", icon: "radio" },
    ],
  },
];
window.SIDEBAR_EXTERNAL = [{ href: "https://frienda.vercel.app/", label: "Wiki", icon: "book-open" }];

window.PAGE_TITLES = {};
window.SIDEBAR_GROUPS.forEach((g) => g.items.forEach((i) => (window.PAGE_TITLES[i.hash] = i.label)));

const SB_KEY = "frienda_tracker_sidebar_collapsed";

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = "";

  window.SIDEBAR_GROUPS.forEach((group) => {
    nav.appendChild(window.el("p", { class: "nav-group" }, group.label));
    const list = window.el("div", { class: "space-y-0.5" });
    group.items.forEach((p) => {
      list.appendChild(
        window.el("a", { href: p.hash, class: "nav-item", title: p.label, html: `<span class="nav-ic">${window.icon(p.icon, 17)}</span><span class="sb-label">${p.label}</span>` })
      );
    });
    nav.appendChild(list);
  });

  nav.appendChild(window.el("div", { class: "nav-sep" }));
  const ext = window.el("div", { class: "space-y-0.5" });
  window.SIDEBAR_EXTERNAL.forEach((p) => {
    ext.appendChild(
      window.el("a", {
        href: p.href, target: "_blank", rel: "noopener noreferrer", class: "nav-item", title: p.label,
        html: `<span class="nav-ic">${window.icon(p.icon, 17)}</span><span class="sb-label">${p.label}</span><span class="nav-ext sb-label">${window.icon("external-link", 13)}</span>`,
      })
    );
  });
  nav.appendChild(ext);
  updateSidebarActive();
}

function updateSidebarActive() {
  const current = (location.hash || "#classement").split("?")[0];
  window.$$("#sidebar-nav a.nav-item[href^='#']").forEach((a) => {
    const on = a.getAttribute("href") === current;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

// ---------- Réduction du menu (desktop) + tiroir (mobile) ----------
function setCollapsed(collapsed, persist = true) {
  document.body.classList.toggle("sb-collapsed", collapsed);
  const btn = document.getElementById("collapse-btn");
  document.getElementById("collapse-ic").innerHTML = window.icon(collapsed ? "chevrons-right" : "chevrons-left", 17);
  const label = collapsed ? "Agrandir le menu" : "Réduire le menu";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  if (persist) {
    try { localStorage.setItem(SB_KEY, collapsed ? "1" : "0"); } catch { /* stockage indisponible */ }
  }
}

function setupMenu() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  document.getElementById("mobile-menu-btn").innerHTML = window.icon("menu", 20);
  document.getElementById("close-menu-btn").innerHTML = window.icon("x", 18);

  const open = () => {
    sidebar.classList.remove("-translate-x-full");
    overlay.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
  };
  const close = () => {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
  };
  document.getElementById("mobile-menu-btn").addEventListener("click", open);
  document.getElementById("close-menu-btn").addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.getElementById("sidebar-nav").addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  let collapsed = false;
  try { collapsed = localStorage.getItem(SB_KEY) === "1"; } catch { /* noop */ }
  setCollapsed(collapsed, false);
  document.getElementById("collapse-btn").addEventListener("click", () => setCollapsed(!document.body.classList.contains("sb-collapsed")));
}

// ---------- Statut serveur (barre du haut) ----------
async function refreshOnlineCount() {
  const dot = document.getElementById("online-dot");
  try {
    const { count, error } = await window.sb
      .from("player_sessions")
      .select("*", { count: "exact", head: true })
      .is("left_at", null);
    if (error) throw error;
    document.getElementById("online-count").textContent = count ?? 0;
    dot.classList.remove("bg-dim");
    dot.classList.add("bg-green", "live-dot");
  } catch (e) {
    document.getElementById("online-count").textContent = "–";
    dot.classList.remove("bg-green", "live-dot");
    dot.classList.add("bg-dim");
    console.warn("[topbar] impossible de récupérer le nombre de joueurs en ligne", e);
  }
}

function setupCopyIp() {
  const btn = document.getElementById("copy-ip-btn");
  const ic = document.getElementById("copy-ip-ic");
  const text = document.getElementById("copy-ip-text");
  const short = document.getElementById("copy-ip-label");
  const ip = window.APP_CONFIG.SERVER_IP;
  text.textContent = ip;
  ic.innerHTML = window.icon("copy", 14);
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ip);
      ic.innerHTML = window.icon("check", 14);
      short.textContent = "Copié";
      window.showToast("Adresse copiée : " + ip, "success");
      setTimeout(() => { ic.innerHTML = window.icon("copy", 14); short.textContent = "IP"; }, 1800);
    } catch {
      window.showToast("Impossible de copier l'adresse", "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupMenu();
  renderSidebar();
  setupCopyIp();
  refreshOnlineCount();
  setInterval(refreshOnlineCount, window.APP_CONFIG.REFRESH_INTERVAL_MS);
  window.addEventListener("hashchange", updateSidebarActive);
});
