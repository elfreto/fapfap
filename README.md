# FapFap

Jeu de cartes multijoueur en ligne (31 cartes, 5 plis, 2 à 4 joueurs), avec des crédits virtuels sans valeur monétaire.

Règles de référence : document « FapFap — Règles du jeu V1.1 » (10/11/2026).

## Organisation du dépôt

| Dossier | Contenu |
| --- | --- |
| `engine/` | Moteur de règles en TypeScript pur : paquet, distribution, plis, victoires spéciales, abandon, paiements et commission. Sans dépendance, utilisable côté serveur (Supabase Edge Functions / Deno) et côté navigateur. |
| `supabase/` | Base de données (migrations) et serveur de jeu (Edge Function `game`). Voir `supabase/README.md`. |
| `web/` | Page de jeu pour téléphone (React + Vite), publiée sur Vercel. |

## Publier sur Vercel

Importer le dépôt sur vercel.com/new sans changer aucun réglage : `vercel.json` indique la commande de build et le dossier `web/dist`.
L'adresse du projet Supabase et sa clé publique sont dans `web/src/api.ts` (clé publique par conception, elle ne donne accès qu'à la vue publique des tables).

## Développer en local

```bash
npm install
npm run dev -w web   # page de jeu sur http://localhost:5173, branchée sur le serveur Supabase
```

## Lancer les tests

```bash
npm install
npm test
npm run typecheck
```
