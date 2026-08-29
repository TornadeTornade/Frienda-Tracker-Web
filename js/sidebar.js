window.SIDEBAR_PAGES = [
  { hash: "#classement", label: "Classements", icon: "🏆" },
  { hash: "#comparateur", label: "Comparateur", icon: "⚖️" },
  { hash: "#podium", label: "Podium", icon: "🥇" },
  { hash: "#profil", label: "Profils", icon: "🙂" },
  { hash: "#stats", label: "Serveur Stats", icon: "📊" },
  { hash: "#live", label: "Live Feed", icon: "🔴" },
  { href: "https://frienda.vercel.app/", label: "Wiki", icon: "📖", external: true },
];

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  nav.innerHTML = "";
  window.SIDEBAR_PAGES.forEach((p) => {
    const props = {
      href: p.href || p.hash,
      class: "nav-slot",
    };

    if (p.external) {
      props.target = "_blank";
      props.rel = "noopener noreferrer";
    }

    const a = window.el("a", props, [
      window.el("span", { class: "nav-ic" }, p.icon),
      window.el("span", {}, p.label),
    ]);
    nav.appendChild(a);
  });
  updateSidebarActive();
}

function updateSidebarActive() {
  const current = location.hash || "#classement";
  window.$$("#sidebar-nav .nav-slot").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === current);
  });
}

async function refreshOnlineCount() {
  try {
    const { count, error } = await window.sb
      .from("player_sessions")
      .select("*", { count: "exact", head: true })
      .is("left_at", null);
    if (error) throw error;
    document.getElementById("online-count").textContent = count ?? 0;
    document.getElementById("online-dot").classList.toggle("bg-green", true);
  } catch (e) {
    document.getElementById("online-count").textContent = "–";
    console.warn("[sidebar] impossible de récupérer le nombre de joueurs en ligne", e);
  }
}

function setupCopyIp() {
  const btn = document.getElementById("copy-ip-btn");
  const label = document.getElementById("copy-ip-label");
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.APP_CONFIG.SERVER_IP);
      label.textContent = "Copié !";
      window.showToast("IP copiée : " + window.APP_CONFIG.SERVER_IP, "success");
      setTimeout(() => (label.textContent = "Copier"), 1800);
    } catch {
      window.showToast("Impossible de copier l'IP", "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderSidebar();
  setupCopyIp();
  refreshOnlineCount();
  setInterval(refreshOnlineCount, window.APP_CONFIG.REFRESH_INTERVAL_MS);
  window.addEventListener("hashchange", updateSidebarActive);
});
