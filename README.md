# FapFap

Jeu de cartes multijoueur en ligne (31 cartes, 5 plis, 2 à 4 joueurs), avec des crédits virtuels sans valeur monétaire.

Règles de référence : document « FapFap — Règles du jeu V1.1 » (10/11/2026).

## Organisation du dépôt

| Dossier | Contenu |
| --- | --- |
| `engine/` | Moteur de règles en TypeScript pur : paquet, distribution, plis, victoires spéciales, abandon, paiements et commission. Sans dépendance, utilisable côté serveur (Supabase Edge Functions / Deno) et côté navigateur. |

À venir : `web/` (page de jeu pour téléphone, publiée sur Vercel) et `supabase/` (base de données, temps réel, fonctions serveur).

## Lancer les tests

```bash
npm install
npm test
npm run typecheck
```
