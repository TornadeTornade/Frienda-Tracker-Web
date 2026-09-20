window.ROUTES = {
  "#classement": () => window.PageClassement.render(),
  "#comparateur": () => window.PageComparateur.render(),
  "#podium": () => window.PagePodium.render(),
  "#profil": () => window.PageProfil.render(),
  "#stats": () => window.PageServerStats.render(),
  "#live": () => window.PageLiveFeed.render(),
  "#market": () => window.PageMarket.render(),
};

function currentCleanup() {
  if (window.__pageCleanup) {
    try { window.__pageCleanup(); } catch (e) { /* noop */ }
    window.__pageCleanup = null;
  }
}

let routeToken = 0;

function route() {
  currentCleanup();
  const token = ++routeToken;
  const fullHash = location.hash || "#classement";
  const routeKey = fullHash.split("?")[0]; // ← ignore la query string pour le matching
  const known = !!window.ROUTES[routeKey];
  const handler = window.ROUTES[routeKey] || window.ROUTES["#classement"];
  const title = window.PAGE_TITLES[known ? routeKey : "#classement"];
  document.getElementById("page-title").textContent = title;
  document.title = `${title} – Frienda Tracker`;
  window.scrollTo(0, 0);

  // Les pages async renvoient une Promise qui résout vers leur fonction de nettoyage
  // (canaux realtime, timers, graphiques). Si l'utilisateur a déjà changé de page
  // entre-temps, on nettoie tout de suite au lieu de laisser fuir.
  Promise.resolve(handler()).then((cleanup) => {
    if (typeof cleanup !== "function") return;
    if (token !== routeToken) { try { cleanup(); } catch (e) { /* noop */ } return; }
    window.__pageCleanup = cleanup;
  });
}

window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", route);
