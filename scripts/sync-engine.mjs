// Copie le moteur de règles dans la fonction Supabase (Deno ne lit pas les workspaces npm).
// Usage : node scripts/sync-engine.mjs        → copie
//         node scripts/sync-engine.mjs --check → échoue si la copie n'est pas à jour
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = "engine/src";
const dest = "supabase/functions/game/engine";
const check = process.argv.includes("--check");
mkdirSync(dest, { recursive: true });
let stale = [];
for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
  const content = readFileSync(join(src, f), "utf8");
  let current = null;
  try { current = readFileSync(join(dest, f), "utf8"); } catch {}
  if (current !== content) {
    if (check) stale.push(f);
    else writeFileSync(join(dest, f), content);
  }
}
if (stale.length) {
  console.error(`Copie du moteur pas à jour : ${stale.join(", ")}. Lancez node scripts/sync-engine.mjs`);
  process.exit(1);
}
