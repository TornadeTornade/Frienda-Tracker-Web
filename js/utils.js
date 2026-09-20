// ============================================================
// Catégories de statistiques -- source de vérité unique.
// `key` doit correspondre exactement à une colonne de la table
// Supabase `player_stats`.
// ============================================================
window.STAT_CATEGORIES = [
  { key: "playtime_seconds", label: "Temps de jeu", short: "Temps", icon: "⏱️", format: "duration" },
  { key: "player_kills", label: "Kills PvP", short: "PvP", icon: "⚔️", format: "int" },
  { key: "mob_kills", label: "Kills Mobs", short: "Mobs", icon: "🗡️", format: "int" },
  { key: "deaths", label: "Morts", short: "Morts", icon: "💀", format: "int" },
  { key: "blocks_broken", label: "Blocs cassés", short: "Minage", icon: "⛏️", format: "int" },
  { key: "blocks_placed", label: "Blocs posés", short: "Construction", icon: "🧱", format: "int" },
  { key: "distance_meters", label: "Distance parcourue", short: "Distance", icon: "🥾", format: "distance" },
  { key: "damage_dealt", label: "Dégâts infligés", short: "Dégâts inf.", icon: "🔥", format: "int" },
  { key: "damage_taken", label: "Dégâts subis", short: "Dégâts sub.", icon: "🛡️", format: "int" },
  { key: "jumps", label: "Sauts", short: "Sauts", icon: "🦘", format: "int" },
  { key: "items_enchanted", label: "Objets enchantés", short: "Enchant.", icon: "✨", format: "int" },
  { key: "items_dropped", label: "Objets jetés", short: "Jetés", icon: "📦", format: "int" },
  { key: "villager_trades", label: "Échanges villageois", short: "Échanges", icon: "🧑‍🌾", format: "int" },
  { key: "diamonds_mined", label: "Diamants minés", short: "Diamants", icon: "💎", format: "int" },
  { key: "ancient_debris_mined", label: "Débris antiques minés", short: "Débris", icon: "🟫", format: "int" },
  { key: "xp_level", label: "Niveau XP", short: "Niveau", icon: "⭐", format: "int" },
];

window.statByKey = (key) => window.STAT_CATEGORIES.find((s) => s.key === key);

// ============================================================
// Formatage
// ============================================================
window.fmt = {
  int(n) {
    return Math.round(n ?? 0).toLocaleString("fr-FR");
  },
  duration(seconds) {
    seconds = Math.round(seconds ?? 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      const rh = h % 24;
      return `${d}j ${rh}h`;
    }
    return `${h}h ${m}min`;
  },
  distance(meters) {
    meters = meters ?? 0;
    if (meters >= 1000) return `${(meters / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
    return `${Math.round(meters)} m`;
  },
  statValue(key, value) {
    const cat = window.statByKey(key);
    if (!cat) return value;
    return window.fmt[cat.format] ? window.fmt[cat.format](value) : value;
  },
  dateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  },
  timeAgo(iso) {
    if (!iso) return "—";
    const diffMs = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 60) return "à l'instant";
    const m = Math.floor(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24);
    return `il y a ${d} j`;
  },
};

// ============================================================
// Avatars — têtes / rendus 3D du skin via l'API publique mc-heads.net
// ============================================================
window.avatarHead = (uuid, size = 48) => `https://mc-heads.net/avatar/${uuid}/${size}`;
window.avatarBody3D = (uuid, size = 300) => `https://mc-heads.net/body/${uuid}/${size}`;

// ============================================================
// Petits helpers DOM
// ============================================================
window.$ = (sel, root = document) => root.querySelector(sel);
window.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

window.el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
};

window.showToast = (message, type = "default") => {
  const wrap = document.getElementById("toast");
  const box = wrap.firstElementChild;
  box.textContent = message;
  box.className =
    "shadow-card rounded-md px-4 py-3 text-sm border " +
    (type === "success"
      ? "bg-green/10 border-green/40 text-green"
      : type === "error"
      ? "bg-red/10 border-red/40 text-red"
      : "bg-surface2 border-border text-ink");
  wrap.classList.remove("hidden");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => wrap.classList.add("hidden"), 2500);
};

window.skeletonRows = (n, height = "h-16") =>
  Array.from({ length: n })
    .map(() => `<div class="skeleton ${height} rounded-xl mb-2"></div>`)
    .join("");
