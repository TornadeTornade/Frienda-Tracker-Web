# 🌐 Frienda Tracker — Web Dashboard

[![Frontend](https://img.shields.io/badge/Frontend-HTML5-orange.svg)](#)
![Stack](https://img.shields.io/badge/Frontend-Vanilla_JS-yellow)
![Style](https://img.shields.io/badge/Styling-Tailwind_CSS-blue)
![Database](https://img.shields.io/badge/Database-Supabase-emerald)
[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red.svg)](LICENSE)

Dashboard web interactif lié au mod Minecraft **Frienda Tracker**. Il permet de consulter les statistiques du serveur et des joueurs en temps réel.

---

## ✨ Fonctionnalités

* 🏆 **Classements & Podium :** Tri par catégorie (temps de jeu, kills, minage, etc.), recordmen et export du podium en image.
* ⚔️ **Comparateur :** Comparaison directe des statistiques entre 2 et 4 joueurs.
* 👤 **Profils :** Graphiques d'aptitudes et cartes de joueur à exporter.
* 📊 **Statistiques globales :** Métriques de la communauté et activité du serveur.
* 🛒 **Marché & Live :** Cours, annonces, ventes et fil d'événements en direct.
* 🎮 **Statut en direct :** Nombre de joueurs en ligne et IP du serveur (`frienda.exaroton.me`).

---

## 🛠️ Technologies utilisées

* **HTML5 & Vanilla JavaScript (ES6+)** — Aucun framework lourd, chargement instantané.
* **Tailwind CSS** — Mise en page ; palette quasi monochrome définie dans `index.html`, `css/style.css` et `js/theme.js` (à garder synchronisés).
* **Lucide** — Iconographie en trait fin, embarquée dans `js/icons.js` (aucun appel CDN). Pour ajouter une icône, ajouter son tracé dans `window.ICONS`.
* **Geist** — Police (Google Fonts).
* **Chart.js** — Graphiques.
* **Supabase REST API** — Récupération des données joueurs.
* **MC-Heads API** — Rendu automatique des têtes d'avatars Minecraft.

---

## 📄 Licence

Ce projet est sous licence **All Rights Reserved (Tous droits réservés)**.  
Toute reproduction, modification ou redistribution sans autorisation préalable est strictement interdite.
