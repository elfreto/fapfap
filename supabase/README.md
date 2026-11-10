# Serveur Supabase

- Projet : `fapfap` (organisation N&Co, région eu-west-3), réf. `ywrfjeplubwnvjmtyguh`.
- `migrations/` : schéma de la base (joueurs, tables, vue publique temps réel, journal des crédits, caisses).
- `functions/game/` : serveur de jeu (Edge Function Deno, `verify_jwt = false`, authentification par jeton joueur).

Le serveur fait autorité : il mélange, distribue, garde les mains secrètes et valide chaque action.
Les clients ne lisent que `table_public` (aucune main cachée) et appellent la fonction `game`.

`functions/game/engine/` est une copie de `engine/src` (Deno ne lit pas les workspaces npm).
Après toute modification du moteur : `node scripts/sync-engine.mjs`, puis redéployer la fonction.
La CI vérifie que la copie est à jour.
