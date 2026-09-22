// ============================================================
// Thème des graphiques — miroir JS des variables de css/style.css.
// Toutes les pages lisent leurs couleurs ici (plus de hex en dur dans les pages).
// ============================================================
window.THEME = {
  ink: "#FAFAFA",
  soft: "#A1A1AA",
  dim: "#71717A",
  faint: "#52525B",
  grid: "#1F1F23",
  border: "#27272A",
  surface2: "#18181B",
  green: "#4ADE80",
  red: "#F87171",
  fillSoft: "rgba(250,250,250,.06)",
  fillMid: "rgba(250,250,250,.12)",
};

// Séries multiples (comparateur 2–4 joueurs). C'est la seule entorse à la palette
// monochrome : à 4 joueurs sur 16 axes, des nuances de gris ne se distinguent plus.
// Teintes désaturées + forme de point différente (lisible aussi en daltonisme).
window.SERIES = [
  { color: "#FAFAFA", point: "circle" },
  { color: "#60A5FA", point: "rectRot" },
  { color: "#FBBF24", point: "triangle" },
  { color: "#F472B6", point: "rect" },
];

// Options d'axe communes
window.axisOpts = () => ({
  ticks: { color: window.THEME.dim, font: { size: 11 } },
  grid: { color: window.THEME.grid },
  border: { display: false },
});

if (window.Chart) {
  const T = window.THEME;
  Chart.defaults.font.family = "Geist, ui-sans-serif, system-ui, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.color = T.soft;
  Chart.defaults.borderColor = T.grid;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = "circle";
  Chart.defaults.plugins.legend.labels.boxWidth = 6;
  Chart.defaults.plugins.legend.labels.boxHeight = 6;
  Chart.defaults.plugins.legend.labels.padding = 16;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: T.surface2,
    borderColor: "#3F3F46",
    borderWidth: 1,
    titleColor: T.ink,
    bodyColor: T.soft,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
  });
}
