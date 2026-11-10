// Test de bout en bout du serveur de jeu : 2 joueurs jouent une manche complète.
const URL = process.env.FN_URL ?? "https://ywrfjeplubwnvjmtyguh.supabase.co/functions/v1/game";
const KEY = process.env.SB_KEY ?? "sb_publishable_tQMqkolhUtrgqr6rUvpI8w_UqsANYOT";
async function call(body) {
  const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(`${body.action}: ${r.status} ${j.error}`), { status: r.status });
  return j;
}
const a = await call({ action: "register", pseudo: "Test A" });
const b = await call({ action: "register", pseudo: "Test B" });
let v = await call({ action: "create", token: a.token, stake: 100, capacity: 2 });
const code = v.table.id;
console.log("table", code);
await call({ action: "join", token: b.token, code });
v = await call({ action: "start", token: a.token, code });
const tokens = { [a.me.id]: a.token, [b.me.id]: b.token };
let guard = 0;
while (v.table.round && !v.table.round.result && guard++ < 20) {
  const turn = v.table.round.turn;
  const pv = await call({ action: "view", token: tokens[turn], code });
  const card = pv.legal[0];
  v = await call({ action: "play", token: tokens[turn], code, card: `${card.suit}-${card.rank}` });
}
const res = v.table.round.result;
console.log("résultat", res.reason, res.payout, "gagnant", v.table.names[res.winner], res.settlement.net);
console.log("soldes", v.table.balances);
// Une action illégale doit être refusée
try { await call({ action: "play", token: a.token, code, card: "zing-10" }); } catch (e) { console.log("refus attendu :", e.message); }
await call({ action: "leave", token: a.token });
await call({ action: "leave", token: b.token });
