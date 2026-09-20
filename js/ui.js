// ============================================================
// Composants d'interface partagés par toutes les pages.
// Chaque fonction renvoie une chaîne HTML ; les pages les assemblent.
// ============================================================

// Icône Lucide inline (le tracé vient de window.ICONS, voir js/icons.js)
window.icon = (name, size = 16, cls = "") =>
  `<svg class="ic ${cls}" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICONS[name] ?? ""}</svg>`;

// Icône d'une catégorie de statistique
window.catIcon = (cat, size = 14, cls = "") => window.icon(cat.icon, size, cls);

window.ui = {
  // Ligne d'introduction de page : description à gauche, actions à droite.
  // (Le titre de la page vit dans la barre du haut.)
  pageHeader(desc, actions = "") {
    return `
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 mb-6">
        <p class="text-sm text-muted max-w-2xl">${desc}</p>
        ${actions ? `<div class="flex items-center gap-2 flex-wrap">${actions}</div>` : ""}
      </div>`;
  },

  // Carte avec en-tête optionnel (titre + description + action à droite)
  panel({ title = "", desc = "", action = "", body = "", cls = "", bodyCls = "", id = "", flush = false } = {}) {
    const head =
      title || action
        ? `<div class="card-head">
             <div class="min-w-0">
               ${title ? `<h3 class="card-title">${title}</h3>` : ""}
               ${desc ? `<p class="card-desc">${desc}</p>` : ""}
             </div>
             ${action ? `<div class="shrink-0">${action}</div>` : ""}
           </div>`
        : "";
    return `<section ${id ? `id="${id}"` : ""} class="card ${cls}">${head}<div class="card-body ${flush ? "flush" : ""} ${bodyCls}">${body}</div></section>`;
  },

  // Indicateur clé : libellé, valeur, précision (souvent un delta)
  kpi({ label, value, sub = "", icon = "", id = "" } = {}) {
    return `
      <div class="card p-4 sm:p-5">
        <div class="flex items-center justify-between gap-2">
          <p class="lbl truncate">${label}</p>
          ${icon ? `<span class="text-dim">${window.icon(icon, 16)}</span>` : ""}
        </div>
        <p ${id ? `id="${id}"` : ""} class="kpi-value mt-3 truncate">${value}</p>
        ${sub ? `<p class="text-[12.5px] text-muted mt-1.5">${sub}</p>` : ""}
      </div>`;
  },

  // Variation en % (pct === undefined → rien ; null → nouveau ce cycle)
  delta(pct, suffix = "") {
    if (pct === undefined) return "";
    if (pct === null) return `<span class="delta up">Nouveau</span>${suffix ? ` <span class="text-dim">${suffix}</span>` : ""}`;
    const flat = Math.abs(pct) < 1;
    const cls = flat ? "flat" : pct > 0 ? "up" : "down";
    const sign = flat ? "" : pct > 0 ? "+" : "−";
    return `<span class="delta ${cls}">${sign}${Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %</span>${suffix ? ` <span class="text-dim">${suffix}</span>` : ""}`;
  },

  badge(text, kind = "", iconName = "") {
    return `<span class="badge ${kind ? "badge-" + kind : ""}">${iconName ? window.icon(iconName, 12) : ""}${text}</span>`;
  },

  // Contrôle segmenté : items = [{ key, label, html? }], attr = nom de l'attribut data-*
  segmented(items, activeKey, attr, id = "") {
    return `<div ${id ? `id="${id}"` : ""} class="seg" role="group">${items
      .map((i) => `<button type="button" data-${attr}="${i.key}" class="chip-btn ${i.key === activeKey ? "active" : ""}">${i.html ?? i.label}</button>`)
      .join("")}</div>`;
  },

  empty(msg, iconName = "inbox") {
    return `<div class="h-full min-h-[110px] flex flex-col items-center justify-center gap-2 text-center px-6 py-6">
      <span class="text-dim">${window.icon(iconName, 20)}</span>
      <p class="text-sm text-muted max-w-sm">${msg}</p>
    </div>`;
  },

  avatar(uuid, size = 32, cls = "") {
    return `<img src="${window.avatarHead(uuid, size * 2)}" width="${size}" height="${size}" class="rounded-md bg-surface2 shrink-0 ${cls}" alt="" loading="lazy" />`;
  },

  rankBadge(i) {
    return `<span class="rank-badge ${i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : ""}">${i + 1}</span>`;
  },

  errorMsg(msg) {
    return `<div class="flex items-center gap-2 text-sm text-red">${window.icon("info", 16)}<span>${msg}</span></div>`;
  },
};
