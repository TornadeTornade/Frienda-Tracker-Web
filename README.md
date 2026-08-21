# 🏆 Frienda Leaderboard

Interface web minimaliste et responsive permettant de consulter le classement officiel du serveur Minecraft **Frienda**. Les données sont récupérées en direct depuis la base de données Supabase du serveur.

![Stack](https://img.shields.io/badge/Frontend-Vanilla_JS-yellow)
![Style](https://img.shields.io/badge/Styling-Tailwind_CSS-blue)
![Database](https://img.shields.io/badge/Database-Supabase-emerald)

---

## 🌟 Fonctionnalités

* **Classement Général :** Algorithme de calcul basé sur le rang moyen du joueur à travers l'ensemble des métriques.
* **Filtres par catégorie :** Vues dédiées pour le Temps de jeu, PvP, PvE, Minage, Construction, Exploration, Dégâts, etc.
* **Recherche instantanée :** Filtrage dynamique par pseudo sans rechargement de la page.
* **Détails des joueurs :** Panneau dépliant sous chaque joueur récapitulant l'ensemble de ses statistiques en jeu.
* **Mise à jour en temps réel :** Synchronisation automatique avec l'API REST de Supabase.
* **Design Responsive :** Interface fluide optimisée pour écrans d'ordinateurs, tablettes et smartphones.

---

## 🛠️ Technologies utilisées

* **HTML5 & Vanilla JavaScript (ES6+)** — Aucun framework lourd, chargement instantané.
* **Tailwind CSS** — Framework CSS pour une mise en page moderne et sobre.
* **FontAwesome 6** — Iconographie.
* **Supabase REST API** — Récupération des données joueurs.
* **MC-Heads API** — Rendu automatique des têtes d'avatars Minecraft.

---

## 🚀 Installation & Développement local

Puisque le projet est conçu en Web Vanilla, aucune étape de compilation (npm/node) n'est requise.

1. **Cloner le dépôt :**
   ```bash
   git clone [https://github.com/votre-pseudo/frienda-web.git](https://github.com/votre-pseudo/frienda-web.git)
   cd frienda-web
