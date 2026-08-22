window.ROUTES = {
  "#classement": () => window.PageClassement.render(),
  "#comparateur": () => window.PageComparateur.render(),
  "#podium": () => window.PagePodium.render(),
  "#profil": () => window.PageProfil.render(),
  "#stats": () => window.PageServerStats.render(),
  "#live": () => window.PageLiveFeed.render(),
};

function currentCleanup() {
  if (window.__pageCleanup) {
    try { window.__pageCleanup(); } catch (e) { /* noop */ }
    window.__pageCleanup = null;
  }
}

function route() {
  currentCleanup();
  const hash = location.hash || "#classement";
  const handler = window.ROUTES[hash] || window.ROUTES["#classement"];
  const root = document.getElementById("page-root");
  root.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  const cleanup = handler();
  if (typeof cleanup === "function") window.__pageCleanup = cleanup;
}

window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", route);
