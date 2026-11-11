// Serveur de jeu FapFap (Supabase Edge Function, Deno).
// Le serveur fait autorité : il mélange, distribue, garde les mains secrètes, valide chaque action
// et applique les mouvements de crédits une seule fois par manche.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as E from "./engine/index.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Marge accordée au-delà du délai de jeu pour la latence réseau. */
const GRACE_MS = 2000;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Player {
  id: string;
  pseudo: string;
  balance: number;
  table_id: string | null;
}

interface TableRow {
  id: string;
  stake: number;
  capacity: number;
  seats: string[];
  status: "waiting" | "playing" | "closed";
  round_no: number;
  first_player: string | null;
  state: { round: E.RoundState | null; deadline: string | null };
  version: number;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function randomCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => letters[E.cryptoRandomInt(letters.length)]).join("");
}

async function auth(token: unknown): Promise<Player> {
  if (typeof token !== "string" || token.length < 32) throw new HttpError(401, "Session invalide, reconnectez-vous");
  const { data, error } = await db
    .from("players")
    .select("id, pseudo, balance, table_id")
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(401, "Session invalide, reconnectez-vous");
  return data as Player;
}

async function loadTable(code: unknown): Promise<TableRow> {
  if (typeof code !== "string") throw new HttpError(400, "Code de table manquant");
  const { data, error } = await db.from("game_tables").select("*").eq("id", code.toUpperCase()).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Table introuvable");
  return data as TableRow;
}

async function loadPlayers(ids: string[]): Promise<Record<string, Player>> {
  if (ids.length === 0) return {};
  const { data, error } = await db.from("players").select("id, pseudo, balance, table_id").in("id", ids);
  if (error) throw error;
  return Object.fromEntries((data as Player[]).map((p) => [p.id, p]));
}

function roundActive(t: TableRow): boolean {
  return !!t.state.round && !t.state.round.result;
}

/** Ce que tout le monde peut voir (aucune main secrète, sauf victoire spéciale terminée). */
function publicRound(r: E.RoundState | null) {
  if (!r) return null;
  const showAll = r.result?.reason === "special";
  return {
    players: r.players.map((p) => ({
      id: p,
      cardsLeft: r.hands[p]!.length,
      abandoned: r.abandoned.includes(p),
      lateAbandoned: (r.lateAbandoned ?? []).includes(p),
      dealtHand: showAll ? r.dealtHands[p] : undefined,
    })),
    tricks: r.tricks,
    turn: r.turn,
    result: r.result,
    abandonOpen: !r.result && !E.thirdTrickStarted(r),
  };
}

function publicData(t: TableRow, players: Record<string, Player>) {
  const ids = new Set([...t.seats, ...(t.state.round?.players ?? [])]);
  return {
    id: t.id,
    stake: t.stake,
    capacity: t.capacity,
    status: t.status,
    seats: t.seats,
    roundNo: t.round_no,
    nextFirstPlayer: t.first_player,
    deadline: t.state.deadline,
    names: Object.fromEntries([...ids].map((id) => [id, players[id]?.pseudo ?? "?"])),
    balances: Object.fromEntries([...ids].map((id) => [id, players[id]?.balance ?? 0])),
    round: publicRound(t.state.round),
  };
}

type Change = Partial<Pick<TableRow, "seats" | "status" | "round_no" | "first_player" | "state">>;

/** Enregistre la table (contrôle de version + crédits), relit les joueurs pour la vue publique. */
async function commit(t: TableRow, change: Change, ledger: Array<{ player_id: string | null; amount: number; reason: string }> = []) {
  const next: TableRow = { ...t, ...change };
  // Les soldes publiés doivent refléter le règlement qui va être appliqué.
  const players = await loadPlayers([...new Set([...next.seats, ...(next.state.round?.players ?? [])])]);
  for (const l of ledger) if (l.player_id && players[l.player_id]) players[l.player_id]!.balance += l.amount;
  const { error } = await db.rpc("commit_table", {
    p_id: t.id,
    p_version: t.version,
    p_seats: next.seats,
    p_status: next.status,
    p_round_no: next.round_no,
    p_first_player: next.first_player,
    p_state: next.state,
    p_public: publicData(next, players),
    p_ledger: ledger,
  });
  if (error) {
    if (error.message.includes("version_conflict")) throw new HttpError(409, "conflict");
    throw error;
  }
}

function deadlineIn(ms = E.TURN_SECONDS * 1000): string {
  return new Date(Date.now() + ms).toISOString();
}

/** Après chaque changement de manche : règlement si terminée, sinon nouveau délai. */
function afterRound(t: TableRow, round: E.RoundState): { change: Change; ledger: Array<{ player_id: string | null; amount: number; reason: string }> } {
  if (!round.result) {
    const prevTurn = t.state.round?.turn;
    const keep = prevTurn === round.turn && t.state.round?.tricks.length === round.tricks.length && t.state.deadline;
    // Nouveau délai de jeu dès que le joueur attendu change.
    return { change: { state: { round, deadline: keep ? t.state.deadline : deadlineIn() } }, ledger: [] };
  }
  const s = round.result.settlement;
  const ledger = Object.entries(s.net).map(([player_id, amount]) => ({ player_id, amount, reason: "manche" }));
  if (s.commission > 0) ledger.push({ player_id: null, amount: s.commission, reason: "commission" });
  return {
    change: {
      status: "waiting",
      first_player: E.nextFirstPlayer(t.seats.length ? t.seats : round.players, round.result.winner, t.seats.length ? t.seats : round.players),
      state: { round, deadline: null },
    },
    ledger,
  };
}

/** Le joueur est-il engagé dans une manche non terminée (même après abandon) ? */
async function engagedTable(playerId: string): Promise<string | null> {
  const { data, error } = await db
    .from("game_tables")
    .select("id, state")
    .eq("status", "playing")
    .contains("state", { round: { players: [playerId] } });
  if (error) throw error;
  const row = (data ?? []).find((r: { state: TableRow["state"] }) => r.state.round && !r.state.round.result);
  return row ? (row as { id: string }).id : null;
}

/** Retire le joueur de la table où il est assis (abandon si la manche est en cours). */
async function leaveCurrent(player: Player) {
  if (!player.table_id) return;
  const t = await loadTable(player.table_id);
  let round = t.state.round;
  let extra: ReturnType<typeof afterRound> | null = null;
  if (round && !round.result && round.players.includes(player.id) && !round.abandoned.includes(player.id)) {
    if (!E.canAbandon(round, player.id)) {
      throw new HttpError(400, "À partir du 3e pli, on ne peut plus quitter la manche : seul le délai de 60 s fait abandonner");
    }
    round = E.abandon(round, player.id);
  }
  const seats = t.seats.filter((s) => s !== player.id);
  const tt = { ...t, seats };
  if (round && round !== t.state.round) extra = afterRound(tt, round);
  const status = seats.length === 0 && !(round && !round.result) ? "closed" : extra?.change.status ?? t.status;
  await commit(t, { ...extra?.change, seats, status }, extra?.ledger ?? []);
}

async function view(player: Player, code: string) {
  const t = await loadTable(code);
  const players = await loadPlayers([...new Set([...t.seats, ...(t.state.round?.players ?? [])])]);
  const r = t.state.round;
  return {
    me: { id: player.id, pseudo: player.pseudo, balance: players[player.id]?.balance ?? player.balance },
    table: publicData(t, players),
    hand: r ? r.hands[player.id] ?? [] : [],
    legal: r ? E.legalCards(r, player.id) : [],
    serverTime: new Date().toISOString(),
  };
}

async function handle(body: Record<string, unknown>) {
  const action = body.action;
  switch (action) {
    case "register": {
      const pseudo = String(body.pseudo ?? "").trim().slice(0, 20);
      if (!pseudo) throw new HttpError(400, "Choisissez un pseudo");
      const token = randomToken();
      const { data, error } = await db
        .from("players")
        .insert({ pseudo, token_hash: await sha256(token), balance: E.STARTING_CREDITS })
        .select("id, pseudo, balance, table_id")
        .single();
      if (error) throw error;
      return { token, me: data };
    }
    case "me": {
      const p = await auth(body.token);
      return { me: p };
    }
    case "reload": {
      const p = await auth(body.token);
      if (p.balance >= E.STARTING_CREDITS) throw new HttpError(400, "Recharge possible seulement sous 10 000 crédits");
      const amount = E.STARTING_CREDITS - p.balance;
      const { error } = await db.from("players").update({ balance: E.STARTING_CREDITS }).eq("id", p.id).eq("balance", p.balance);
      if (error) throw error;
      await db.from("ledger").insert({ player_id: p.id, amount, reason: "recharge" });
      return { me: { ...p, balance: E.STARTING_CREDITS } };
    }
    case "create": {
      const p = await auth(body.token);
      const stake = Number(body.stake);
      const capacity = Number(body.capacity);
      if (!E.isValidStake(stake)) throw new HttpError(400, "Mise invalide");
      if (!E.isValidCapacity(capacity)) throw new HttpError(400, "Une table accepte 2, 3 ou 4 joueurs");
      if (!E.canPlay(p.balance, stake)) throw new HttpError(400, "Solde insuffisant, recharger");
      if (await engagedTable(p.id)) throw new HttpError(400, "Terminez d'abord votre manche en cours");
      await leaveCurrent(p);
      let code = "";
      for (let i = 0; i < 5; i++) {
        code = randomCode();
        const { error } = await db.from("game_tables").insert({ id: code, stake, capacity, seats: [], status: "waiting" });
        if (!error) break;
        if (i === 4) throw error;
      }
      const t = await loadTable(code);
      await commit(t, { seats: [p.id], first_player: p.id });
      return view(p, code);
    }
    case "join": {
      const p = await auth(body.token);
      const t = await loadTable(body.code);
      if (t.seats.includes(p.id)) return view(p, t.id);
      if (t.status === "closed") throw new HttpError(400, "Cette table est fermée");
      if (t.seats.length >= t.capacity) throw new HttpError(400, "La table est complète");
      if (!E.canPlay(p.balance, t.stake)) throw new HttpError(400, "Solde insuffisant, recharger");
      const engaged = await engagedTable(p.id);
      if (engaged && engaged !== t.id) throw new HttpError(400, "Terminez d'abord votre manche en cours");
      await leaveCurrent(p);
      const fresh = await loadTable(t.id);
      await commit(fresh, { seats: [...fresh.seats, p.id], first_player: fresh.first_player ?? p.id });
      return view(p, t.id);
    }
    case "leave": {
      const p = await auth(body.token);
      await leaveCurrent(p);
      return { ok: true };
    }
    case "start": {
      const p = await auth(body.token);
      const t = await loadTable(body.code);
      if (!t.seats.includes(p.id)) throw new HttpError(403, "Vous n'êtes pas assis à cette table");
      if (roundActive(t)) throw new HttpError(400, "Une manche est déjà en cours");
      const players = await loadPlayers(t.seats);
      const eligible = t.seats.filter((id) => E.canPlay(players[id]?.balance ?? 0, t.stake));
      if (eligible.length < E.MIN_PLAYERS) {
        throw new HttpError(400, "Il faut au moins 2 joueurs avec un solde d'au moins 2 × la mise");
      }
      const first =
        t.first_player && eligible.includes(t.first_player) ? t.first_player : E.nextFirstPlayer(t.seats, t.first_player ?? t.seats[0]!, eligible);
      const round = E.newRound({ stake: t.stake, seats: eligible, firstPlayer: first });
      const roundNo = t.round_no + 1;
      const tt = { ...t, round_no: roundNo, state: { round: null, deadline: null } };
      const { change, ledger } = afterRound(tt, round);
      await commit(t, { round_no: roundNo, status: round.result ? "waiting" : "playing", ...change }, ledger);
      return view(p, t.id);
    }
    case "play":
    case "abandon":
    case "tick": {
      const p = await auth(body.token);
      const t = await loadTable(body.code);
      const r = t.state.round;
      if (!r || r.result) throw new HttpError(400, "Aucune manche en cours");
      const expired = t.state.deadline && Date.now() > Date.parse(t.state.deadline) + GRACE_MS;
      let round: E.RoundState;
      if (expired && r.turn) {
        // Le délai du joueur attendu est dépassé : il est considéré comme ayant abandonné.
        round = E.timeout(r, r.turn);
      } else if (action === "tick") {
        return view(p, t.id);
      } else if (action === "abandon") {
        round = E.abandon(r, p.id);
      } else {
        const card = E.parseCardId(String(body.card));
        round = E.playCard(r, p.id, card);
      }
      const { change, ledger } = afterRound(t, round);
      await commit(t, change, ledger);
      if (expired && action === "play" && r.turn === p.id) throw new HttpError(400, "Temps écoulé : vous avez abandonné la manche");
      return view(p, t.id);
    }
    case "view": {
      const p = await auth(body.token);
      return view(p, String(body.code));
    }
    default:
      throw new HttpError(400, "Action inconnue");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Requête invalide" }, 400);
  }
  // En cas d'actions simultanées, on rejoue l'action sur l'état le plus récent.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return json(await handle(body));
    } catch (e) {
      if (e instanceof HttpError && e.status === 409 && attempt < 3) continue;
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof E.RuleError) return json({ error: e.message, code: e.code }, 400);
      console.error(e);
      return json({ error: "Erreur serveur" }, 500);
    }
  }
  return json({ error: "Table occupée, réessayez" }, 409);
});
