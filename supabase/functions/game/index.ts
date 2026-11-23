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

const PLAYER_COLS = "id, pseudo, balance, table_id, avatar, is_admin, has_login, auth_provider";
const TX_COLS = "id, kind, method, amount, reference, account, status, created_at";

/** Limites par personne. Une partie normale fait moins de 30 appels par minute. */
const CALLS_PER_MINUTE = 120;
const REGISTRATIONS_PER_HOUR = 5;
const REGISTRATIONS_PER_DAY = 15;
/** Essais de connexion par mot de passe : par connexion et par pseudo, sur 15 minutes. */
const LOGIN_TRIES_PER_CALLER = 20;
const LOGIN_TRIES_PER_PSEUDO = 10;
const PBKDF2_ITERATIONS = 100_000;
/** Les tables fermées sont supprimées après ce délai. */
const CLOSED_TABLE_TTL_MS = 24 * 3600 * 1000;

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
  avatar: string | null;
  is_admin?: boolean;
  has_login?: boolean;
  auth_provider?: string | null;
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

/** Appels récents par personne (jeton de session, sinon adresse), gardés en mémoire du serveur. */
const recentCalls = new Map<string, number[]>();

function allowCall(who: string): boolean {
  const now = Date.now();
  const calls = (recentCalls.get(who) ?? []).filter((t) => now - t < 60_000);
  calls.push(now);
  recentCalls.set(who, calls);
  if (recentCalls.size > 5000) {
    for (const [k, v] of recentCalls) if (now - v[v.length - 1]! > 60_000) recentCalls.delete(k);
  }
  return calls.length <= CALLS_PER_MINUTE;
}

/** Adresse du joueur, hachée : elle ne sert qu'à compter. */
async function callerKey(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "inconnue";
  return (await sha256(`fapfap:${ip}`)).slice(0, 24);
}

/** Inscriptions : limite stricte par adresse, comptée en base. */
async function allowRegistration(caller: string): Promise<boolean> {
  const [hour, day] = await Promise.all([
    db.rpc("rate_hit", { p_key: `reg:${caller}`, p_seconds: 3600, p_max: REGISTRATIONS_PER_HOUR }),
    db.rpc("rate_hit", { p_key: `reg:${caller}`, p_seconds: 86400, p_max: REGISTRATIONS_PER_DAY }),
  ]);
  if (hour.error) throw hour.error;
  if (day.error) throw day.error;
  return hour.data === true && day.data === true;
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Mot de passe haché : « pbkdf2$itérations$sel$empreinte ». */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

/** Motif de recherche d'un pseudo, sans tenir compte des majuscules (%, _ et \ neutralisés). */
function pseudoPattern(pseudo: string): string {
  return pseudo.replace(/[\\%_]/g, (c) => "\\" + c);
}

async function pseudoTaken(pseudo: string, exceptId?: string): Promise<boolean> {
  let q = db.from("players").select("id").ilike("pseudo", pseudoPattern(pseudo));
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Nouvelle session : un nouveau jeton remplace le précédent (une session à la fois par compte). */
async function openSession(playerId: string): Promise<{ token: string; me: Player }> {
  const token = randomToken();
  const { data, error } = await db.from("players").update({ token_hash: await sha256(token) }).eq("id", playerId).select(PLAYER_COLS).single();
  if (error) throw error;
  return { token, me: data as Player };
}

async function allowLogin(caller: string, pseudo: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    db.rpc("rate_hit", { p_key: `login:${caller}`, p_seconds: 900, p_max: LOGIN_TRIES_PER_CALLER }),
    db.rpc("rate_hit", { p_key: `login-pseudo:${pseudo.toLowerCase()}`, p_seconds: 900, p_max: LOGIN_TRIES_PER_PSEUDO }),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return a.data === true && b.data === true;
}

async function auth(token: unknown): Promise<Player> {
  if (typeof token !== "string" || token.length < 32) throw new HttpError(401, "Session invalide, reconnectez-vous");
  const { data, error } = await db
    .from("players")
    .select(PLAYER_COLS)
    .eq("token_hash", await sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(401, "Session invalide, reconnectez-vous");
  return data as Player;
}

async function requireAdmin(token: unknown): Promise<Player> {
  const p = await auth(token);
  if (!p.is_admin) throw new HttpError(403, "Page réservée à l'administrateur");
  return p;
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
  const { data, error } = await db.from("players").select(PLAYER_COLS).in("id", ids);
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
    avatars: Object.fromEntries([...ids].map((id) => [id, players[id]?.avatar ?? null])),
    round: publicRound(t.state.round),
  };
}

/** Une table et ses joueurs, tels qu'ils viennent d'être lus ou enregistrés. */
interface Loaded {
  table: TableRow;
  players: Record<string, Player>;
}

type Change = Partial<Pick<TableRow, "seats" | "status" | "round_no" | "first_player" | "state">>;

/** Enregistre la table (contrôle de version + crédits), relit les joueurs pour la vue publique. */
async function commit(
  t: TableRow,
  change: Change,
  ledger: Array<{ player_id: string | null; amount: number; reason: string }> = [],
): Promise<Loaded> {
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
  return { table: { ...next, version: t.version + 1 }, players };
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

const PHOTO_PREFIX = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/avatars/`;

/** Valide le choix d'avatar et renvoie la valeur à enregistrer (photo envoyée dans le stockage). */
async function saveAvatar(p: Player, body: Record<string, unknown>): Promise<string | null> {
  if (body.kind === "initials") return null;
  if (body.kind === "preset") {
    const value = `preset:${String(body.preset ?? "")}`;
    if (!E.presetAvatar(value)) throw new HttpError(400, "Avatar inconnu");
    return value;
  }
  if (body.kind !== "photo" || typeof body.image !== "string") throw new HttpError(400, "Choix d'avatar invalide");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(body.image.replace(/^data:image\/jpeg;base64,/, "")), (c) => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, "Image illisible");
  }
  if (bytes.length > E.AVATAR_MAX_BYTES) throw new HttpError(400, "Image trop lourde");
  const size = E.jpegSize(bytes);
  if (!size) throw new HttpError(400, "L'image doit être une photo JPEG");
  if (size.width < E.AVATAR_MIN_PX || size.height < E.AVATAR_MIN_PX) {
    throw new HttpError(400, `Photo trop petite : ${E.AVATAR_MIN_PX} × ${E.AVATAR_MIN_PX} pixels minimum`);
  }
  const path = `${p.id}/${randomToken().slice(0, 12)}.jpg`;
  const { error } = await db.storage.from("avatars").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return PHOTO_PREFIX + path;
}

async function removeOldPhoto(old: string | null, current: string | null) {
  if (!old || old === current || !old.startsWith(PHOTO_PREFIX)) return;
  await db.storage.from("avatars").remove([old.slice(PHOTO_PREFIX.length)]).catch(() => undefined);
}

/** Vue d'un joueur à partir d'un état déjà en mémoire (aucune lecture en base). */
function viewOf(player: Player, { table: t, players }: Loaded) {
  const r = t.state.round;
  return {
    me: { id: player.id, pseudo: player.pseudo, balance: players[player.id]?.balance ?? player.balance, avatar: players[player.id]?.avatar ?? player.avatar, is_admin: player.is_admin, has_login: player.has_login, auth_provider: player.auth_provider },
    table: publicData(t, players),
    hand: r ? r.hands[player.id] ?? [] : [],
    legal: r ? E.legalCards(r, player.id) : [],
    serverTime: new Date().toISOString(),
  };
}

async function handle(body: Record<string, unknown>, caller: string) {
  const action = body.action;
  switch (action) {
    case "register": {
      const pseudo = E.cleanPseudo(String(body.pseudo ?? ""));
      const password = typeof body.password === "string" ? body.password : "";
      const problem = E.checkPseudo(pseudo) ?? E.checkPassword(password);
      if (problem) throw new HttpError(400, problem);
      if (!(await allowRegistration(caller))) {
        throw new HttpError(429, "Trop d'inscriptions depuis cette connexion. Réessayez plus tard.");
      }
      if (await pseudoTaken(pseudo)) throw new HttpError(400, "Ce pseudo est déjà pris");
      const token = randomToken();
      const { data, error } = await db
        .from("players")
        .insert({ pseudo, token_hash: await sha256(token), balance: E.STARTING_CREDITS, password_hash: await hashPassword(password) })
        .select(PLAYER_COLS)
        .single();
      if (error) {
        if (error.code === "23505") throw new HttpError(400, "Ce pseudo est déjà pris");
        throw error;
      }
      return { token, me: data };
    }
    case "login": {
      const pseudo = E.cleanPseudo(String(body.pseudo ?? ""));
      const password = typeof body.password === "string" ? body.password : "";
      if (!pseudo || !password) throw new HttpError(400, "Saisis ton pseudo et ton mot de passe");
      if (!(await allowLogin(caller, pseudo))) throw new HttpError(429, "Trop d'essais. Réessaie dans 15 minutes.");
      const { data, error } = await db.from("players").select("id, password_hash").ilike("pseudo", pseudoPattern(pseudo)).not("password_hash", "is", null).limit(2);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ id: string; password_hash: string }>;
      // Même message dans tous les cas, pour ne pas révéler quels pseudos existent.
      if (rows.length !== 1 || !(await verifyPassword(password, rows[0]!.password_hash))) {
        throw new HttpError(401, "Pseudo ou mot de passe incorrect");
      }
      return await openSession(rows[0]!.id);
    }
    case "set_password": {
      // Comptes créés avant les mots de passe (ou via Google/Facebook) : choisir un mot de passe.
      const p = await auth(body.token);
      const password = typeof body.password === "string" ? body.password : "";
      const problem = E.checkPassword(password);
      if (problem) throw new HttpError(400, problem);
      const { data: row, error: readError } = await db.from("players").select("password_hash").eq("id", p.id).single();
      if (readError) throw readError;
      if (row.password_hash) throw new HttpError(400, "Ce compte a déjà un mot de passe");
      if (await pseudoTaken(p.pseudo, p.id)) {
        throw new HttpError(400, "Un autre compte porte déjà ce pseudo : demande à l'organisateur de renommer l'un des deux");
      }
      const { data, error } = await db.from("players").update({ password_hash: await hashPassword(password) }).eq("id", p.id).select(PLAYER_COLS).single();
      if (error) throw error;
      return { me: data };
    }
    case "change_password": {
      const p = await auth(body.token);
      const current = typeof body.current === "string" ? body.current : "";
      const password = typeof body.password === "string" ? body.password : "";
      const problem = E.checkPassword(password);
      if (problem) throw new HttpError(400, problem);
      if (!(await allowLogin(caller, p.pseudo))) throw new HttpError(429, "Trop d'essais. Réessaie dans 15 minutes.");
      const { data: row, error: readError } = await db.from("players").select("password_hash").eq("id", p.id).single();
      if (readError) throw readError;
      if (!row.password_hash) throw new HttpError(400, "Ce compte n'a pas encore de mot de passe");
      if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, "Mot de passe actuel incorrect");
      const { data, error } = await db.from("players").update({ password_hash: await hashPassword(password) }).eq("id", p.id).select(PLAYER_COLS).single();
      if (error) throw error;
      return { me: data };
    }
    case "oauth_login": {
      // Retour de Google ou Facebook : le jeton Supabase Auth est vérifié, puis le compte du jeu est retrouvé ou créé.
      const accessToken = typeof body.access_token === "string" ? body.access_token : "";
      if (!accessToken) throw new HttpError(400, "Connexion incomplète");
      const { data: u, error: authError } = await db.auth.getUser(accessToken);
      if (authError || !u.user) throw new HttpError(401, "Connexion Google ou Facebook refusée, réessaie");
      const provider = u.user.app_metadata?.provider;
      if (provider !== "google" && provider !== "facebook") throw new HttpError(400, "Mode de connexion non pris en charge");
      const { data: existing, error: findError } = await db.from("players").select("id").eq("auth_user_id", u.user.id).maybeSingle();
      if (findError) throw findError;
      if (existing) return await openSession(existing.id);
      if (!(await allowRegistration(caller))) {
        throw new HttpError(429, "Trop d'inscriptions depuis cette connexion. Réessayez plus tard.");
      }
      const meta = u.user.user_metadata ?? {};
      const base = E.pseudoFromName(String(meta.full_name ?? meta.name ?? u.user.email ?? "Joueur"));
      for (let n = 1; n <= 50; n++) {
        const pseudo = E.pseudoVariant(base, n);
        if (await pseudoTaken(pseudo)) continue;
        const token = randomToken();
        const { data, error } = await db
          .from("players")
          .insert({ pseudo, token_hash: await sha256(token), balance: E.STARTING_CREDITS, auth_user_id: u.user.id, auth_provider: provider })
          .select(PLAYER_COLS)
          .single();
        if (error?.code === "23505") continue;
        if (error) throw error;
        return { token, me: data };
      }
      throw new HttpError(500, "Impossible de choisir un pseudo, réessaie");
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
    case "transactions": {
      const p = await auth(body.token);
      const [txs, accounts] = await Promise.all([
        db.from("transactions").select(TX_COLS).eq("player_id", p.id).order("created_at", { ascending: false }).limit(30),
        db.from("payment_accounts").select("method, account, ussd, note"),
      ]);
      if (txs.error) throw txs.error;
      if (accounts.error) throw accounts.error;
      return { me: p, transactions: txs.data, accounts: accounts.data };
    }
    case "deposit":
    case "withdraw": {
      const p = await auth(body.token);
      const kind: E.TransactionKind = action === "deposit" ? "depot" : "retrait";
      const req = {
        method: String(body.method ?? ""),
        amount: Number(body.amount),
        reference: typeof body.reference === "string" ? body.reference : "",
        account: typeof body.account === "string" ? body.account : "",
      };
      const problem = E.checkRequest(kind, req, p.balance);
      if (problem) throw new HttpError(400, problem);
      if (kind === "retrait" && p.table_id) throw new HttpError(400, "Quitte ta table avant de demander un retrait");
      const { data, error } = await db.rpc("request_transaction", {
        p_player: p.id,
        p_kind: kind,
        p_method: req.method,
        p_amount: req.amount,
        p_reference: kind === "depot" ? E.cleanReference(req.reference) : null,
        p_account: kind === "retrait" ? E.cleanAccount(req.method, req.account) : null,
        p_max_pending: E.MAX_PENDING,
      });
      if (error) {
        const m = String(error.message);
        if (m.includes("trop_de_demandes")) throw new HttpError(400, `${E.MAX_PENDING} demandes sont déjà en attente. Attends leur traitement.`);
        if (m.includes("solde_insuffisant")) throw new HttpError(400, "Solde retirable insuffisant");
        if (m.includes("reference_deja_utilisee")) throw new HttpError(400, "Cette référence de transfert a déjà été utilisée");
        throw error;
      }
      return { me: { ...p, balance: data.balance }, transaction: data.transaction };
    }
    case "cancel_transaction": {
      const p = await auth(body.token);
      const { data, error } = await db.rpc("close_transaction", { p_id: Number(body.id), p_status: "annulee", p_player: p.id });
      if (error) {
        if (String(error.message).includes("demande_introuvable")) throw new HttpError(400, "Cette demande ne peut plus être annulée");
        throw error;
      }
      return { me: { ...p, balance: data } };
    }
    case "admin_list": {
      await requireAdmin(body.token);
      const cols = `${TX_COLS}, processed_at, player:players!transactions_player_id_fkey(pseudo, balance)`;
      const [pending, done, accounts] = await Promise.all([
        db.from("transactions").select(cols).eq("status", "en_attente").order("created_at", { ascending: true }).limit(200),
        db.from("transactions").select(cols).neq("status", "en_attente").order("processed_at", { ascending: false }).limit(50),
        db.from("payment_accounts").select("method, account, ussd, note"),
      ]);
      for (const r of [pending, done, accounts]) if (r.error) throw r.error;
      return { pending: pending.data, done: done.data, accounts: accounts.data };
    }
    case "admin_close": {
      const admin = await requireAdmin(body.token);
      const status = body.status === "validee" ? "validee" : body.status === "refusee" ? "refusee" : null;
      if (!status) throw new HttpError(400, "Décision invalide");
      const { data, error } = await db.rpc("admin_close_transaction", { p_id: Number(body.id), p_status: status, p_admin: admin.id });
      if (error) {
        if (String(error.message).includes("demande_introuvable")) throw new HttpError(400, "Cette demande a déjà été traitée");
        throw error;
      }
      return { ok: true, balance: data };
    }
    case "admin_accounts": {
      await requireAdmin(body.token);
      const list = Array.isArray(body.accounts) ? body.accounts : [];
      const rows = list.map((a: Record<string, unknown>) => ({
        method: String(a.method ?? ""),
        account: String(a.account ?? "").trim(),
        ussd: String(a.ussd ?? "").replace(/\s+/g, ""),
        note: String(a.note ?? "").trim(),
      }));
      for (const r of rows) {
        if (!E.methodInfo(r.method)) throw new HttpError(400, "Moyen de paiement inconnu");
        const problem = E.checkPaymentAccount(r);
        if (problem) throw new HttpError(400, `${E.methodInfo(r.method)!.label} : ${problem}`);
      }
      const { error } = await db.from("payment_accounts").upsert(rows, { onConflict: "method" });
      if (error) throw error;
      return { ok: true };
    }
    case "avatar": {
      const p = await auth(body.token);
      const avatar = await saveAvatar(p, body);
      const { error } = await db.from("players").update({ avatar }).eq("id", p.id);
      if (error) throw error;
      await removeOldPhoto(p.avatar, avatar);
      return { me: { ...p, avatar } };
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
      // Ménage : les tables fermées depuis plus d'un jour sont supprimées.
      await db.from("game_tables").delete().eq("status", "closed").lt("updated_at", new Date(Date.now() - CLOSED_TABLE_TTL_MS).toISOString());
      let code = "";
      for (let i = 0; i < 5; i++) {
        code = randomCode();
        const { error } = await db.from("game_tables").insert({ id: code, stake, capacity, seats: [], status: "waiting" });
        if (!error) break;
        if (i === 4) throw error;
      }
      const t = await loadTable(code);
      return viewOf(p, await commit(t, { seats: [p.id], first_player: p.id }));
    }
    case "join": {
      const p = await auth(body.token);
      const t = await loadTable(body.code);
      if (t.seats.includes(p.id)) {
        return viewOf(p, { table: t, players: await loadPlayers([...new Set([...t.seats, ...(t.state.round?.players ?? [])])]) });
      }
      if (t.status === "closed") throw new HttpError(400, "Cette table est fermée");
      if (t.seats.length >= t.capacity) throw new HttpError(400, "La table est complète");
      if (!E.canPlay(p.balance, t.stake)) throw new HttpError(400, "Solde insuffisant, recharger");
      const engaged = await engagedTable(p.id);
      if (engaged && engaged !== t.id) throw new HttpError(400, "Terminez d'abord votre manche en cours");
      await leaveCurrent(p);
      const fresh = await loadTable(t.id);
      return viewOf(p, await commit(fresh, { seats: [...fresh.seats, p.id], first_player: fresh.first_player ?? p.id }));
    }
    case "leave": {
      const p = await auth(body.token);
      await leaveCurrent(p);
      return { ok: true };
    }
    case "start": {
      const [p, t] = await Promise.all([auth(body.token), loadTable(body.code)]);
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
      return viewOf(p, await commit(t, { round_no: roundNo, status: round.result ? "waiting" : "playing", ...change }, ledger));
    }
    case "play":
    case "abandon":
    case "tick": {
      const [p, t] = await Promise.all([auth(body.token), loadTable(body.code)]);
      const r = t.state.round;
      if (!r || r.result) throw new HttpError(400, "Aucune manche en cours");
      const expired = t.state.deadline && Date.now() > Date.parse(t.state.deadline) + GRACE_MS;
      let round: E.RoundState;
      if (expired && r.turn) {
        // Le délai du joueur attendu est dépassé : il est considéré comme ayant abandonné.
        round = E.timeout(r, r.turn);
      } else if (action === "tick") {
        return viewOf(p, { table: t, players: await loadPlayers([...new Set([...t.seats, ...r.players])]) });
      } else if (action === "abandon") {
        round = E.abandon(r, p.id);
      } else {
        const card = E.parseCardId(String(body.card));
        round = E.playCard(r, p.id, card);
      }
      const { change, ledger } = afterRound(t, round);
      const saved = await commit(t, change, ledger);
      if (expired && action === "play" && r.turn === p.id) throw new HttpError(400, "Temps écoulé : vous avez abandonné la manche");
      return viewOf(p, saved);
    }
    case "view": {
      // Lecture seule, appelée souvent : session et table sont lues en parallèle.
      const [p, t] = await Promise.all([auth(body.token), loadTable(body.code)]);
      const players = await loadPlayers([...new Set([...t.seats, ...(t.state.round?.players ?? [])])]);
      return viewOf(p, { table: t, players });
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
  const caller = await callerKey(req);
  const who = typeof body.token === "string" && body.token.length >= 32 ? body.token : caller;
  if (!allowCall(who)) return json({ error: "Trop d'appels à la suite. Patientez une minute." }, 429);
  // En cas d'actions simultanées, on rejoue l'action sur l'état le plus récent.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return json(await handle(body, caller));
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
