window.ROUTES = {
  "#classement": () => window.PageClassement.render(),
  "#comparateur": () => window.PageComparateur.render(),
  "#podium": () => window.PagePodium.render(),
  "#profil": () => window.PageProfil.render(),
  "#stats": () => window.PageServerStats.render(),
  "#live": () => window.PageLiveFeed.render(),
  "#marche": () => window.PageMarket.render(),
};

function currentCleanup() {
  if (window.__pageCleanup) {
    try { window.__pageCleanup(); } catch (e) { /* noop */ }
    window.__pageCleanup = null;
  }
}

function route() {
  currentCleanup();
  const fullHash = location.hash || "#classement";
  const routeKey = fullHash.split("?")[0]; // ← ignore la query string pour le matching
  const handler = window.ROUTES[routeKey] || window.ROUTES["#classement"];
  const root = document.getElementById("page-root");
  root.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
  const cleanup = handler();
  if (typeof cleanup === "function") window.__pageCleanup = cleanup;
}

window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", route);
