// ============================================================
// Visibilité des statistiques -- UN SEUL endroit pour masquer une stat.
//
// Pour cacher une stat : ajoute sa `key` (celle de STAT_CATEGORIES dans
// js/utils.js) dans la liste voulue ci-dessous. C'est tout.
//
// ⚠️ La stat reste dans STAT_CATEGORIES et dans la base : elle est juste
// masquée à l'affichage (les formats/labels via statByKey() fonctionnent
// toujours). Pour la réafficher, retire simplement la clé de la liste.
// ============================================================
window.STATS_VISIBILITY = {
  // Masquées PARTOUT (toutes les pages).
  hidden: ["diamond_ores_mined", "ancient_debris_mined"],

  // Masquées seulement sur UNE page (en plus de `hidden`).
  // Noms de pages : "classement" | "podium" | "comparateur" | "profil" | "serverStats"
  pages: {
    classement: [],
    podium: [],
    comparateur: [],
    profil: [],
    serverStats: [],
  },

  // Masquées uniquement du graphique « Évolution » du profil.
  evolution: ["xp_level"],
};

// La stat `key` est-elle affichable sur cette page ?
window.isStatVisible = (key, page) => {
  const cfg = window.STATS_VISIBILITY;
  if (cfg.hidden.includes(key)) return false;
  if (page && (cfg.pages[page] ?? []).includes(key)) return false;
  return true;
};

// Équivalent de STAT_CATEGORIES, sans les stats masquées pour cette page.
window.visibleStats = (page) => window.STAT_CATEGORIES.filter((c) => window.isStatVisible(c.key, page));

// Pareil, mais sans les stats exclues du graphique « Évolution ».
window.evolutionStats = (page) =>
  window.visibleStats(page).filter((c) => !window.STATS_VISIBILITY.evolution.includes(c.key));

// Pour les listes de clés écrites en dur (ex. ["playtime_seconds", "jumps"]).
window.filterVisibleKeys = (keys, page) => keys.filter((k) => window.isStatVisible(k, page));
