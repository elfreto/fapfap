import { type Card, type RandomInt, type Suit, cardId, cryptoRandomInt, cut, fullDeck, sameCard, shuffle } from "./cards.ts";
import { type Settlement, settle, isValidStake, MAX_PLAYERS, MIN_PLAYERS } from "./settlement.ts";
import { type SpecialWin, resolveSpecial } from "./special.ts";
import type { Payout } from "./special.ts";

export const TRICKS_PER_ROUND = 5;
/** Délai pour jouer (décision LeCerf du 11/11/2026 : 60 s). */
export const TURN_SECONDS = 60;

export class RuleError extends Error {
  constructor(
    public readonly code:
      | "round_finished"
      | "not_in_round"
      | "already_abandoned"
      | "not_your_turn"
      | "card_not_in_hand"
      | "must_follow_suit"
      | "abandon_closed"
      | "invalid_setup",
    message: string,
  ) {
    super(message);
    this.name = "RuleError";
  }
}

export interface Play {
  player: string;
  card: Card;
}

export interface Trick {
  number: number;
  leader: string;
  plays: Play[];
  /** Enseigne demandée = enseigne de la première carte posée. */
  ledSuit: Suit | null;
  winner: string | null;
  winningCard: Card | null;
}

export type FinishReason = "fifth_trick" | "special" | "last_standing";

export interface RoundResult {
  winner: string;
  reason: FinishReason;
  payout: Payout;
  /** Carte gagnante du 5e pli (victoire normale). */
  winningCard: Card | null;
  special: SpecialWin | null;
  settlement: Settlement;
}

export interface RoundState {
  stake: number;
  /** Joueurs de la manche dans l'ordre de jeu (sens inverse des aiguilles d'une montre), en commençant par le premier joueur. */
  players: string[];
  firstPlayer: string;
  hands: Record<string, Card[]>;
  /** Cartes de départ, gardées pour l'écran de résultat des victoires spéciales. */
  dealtHands: Record<string, Card[]>;
  abandoned: string[];
  /** Abandons survenus après le début du 3e pli (forcément par dépassement du délai). */
  lateAbandoned: string[];
  tricks: Trick[];
  /** Joueur qui doit jouer, null quand la manche est finie. */
  turn: string | null;
  result: RoundResult | null;
}

export interface NewRoundInput {
  stake: number;
  /** Joueurs dans l'ordre de jeu des places (sens inverse des aiguilles d'une montre). */
  seats: readonly string[];
  firstPlayer: string;
  randomInt?: RandomInt;
  /** Position de la coupe choisie par le premier joueur (1 à 30) ; aléatoire sinon. */
  cutAt?: number;
}

/** Ordre de jeu en partant de `start`. */
export function rotate<T>(list: readonly T[], start: T): T[] {
  const i = list.indexOf(start);
  if (i < 0) throw new RuleError("invalid_setup", "Joueur de départ absent");
  return [...list.slice(i), ...list.slice(0, i)];
}

/**
 * Distribution : depuis le premier joueur, dans l'ordre de jeu, 3 cartes chacun puis 2 cartes chacun.
 * Renvoie les mains et les cartes restées hors jeu.
 */
export function deal(deck: readonly Card[], players: readonly string[]): { hands: Record<string, Card[]>; rest: Card[] } {
  const hands: Record<string, Card[]> = Object.fromEntries(players.map((p) => [p, [] as Card[]]));
  let pos = 0;
  for (const batch of [3, 2]) {
    for (const p of players) {
      hands[p]!.push(...deck.slice(pos, pos + batch));
      pos += batch;
    }
  }
  return { hands, rest: deck.slice(pos) };
}

/** Crée une manche : mélange, coupe, distribue et vérifie les victoires spéciales. */
export function newRound(input: NewRoundInput): RoundState {
  const { stake, seats, firstPlayer, randomInt = cryptoRandomInt } = input;
  if (!isValidStake(stake)) throw new RuleError("invalid_setup", `Mise invalide : ${stake}`);
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new RuleError("invalid_setup", "Une manche se joue à 2, 3 ou 4 joueurs");
  }
  if (new Set(seats).size !== seats.length) throw new RuleError("invalid_setup", "Joueur en double");
  const players = rotate(seats, firstPlayer);
  const shuffled = shuffle(fullDeck(), randomInt);
  const cutAt = input.cutAt ?? 1 + randomInt(shuffled.length - 1);
  const { hands } = deal(cut(shuffled, cutAt), players);
  return startRound({ stake, players, hands });
}

/** Démarre une manche à partir de mains connues (utile pour les tests et la reprise). */
export function startRound(input: { stake: number; players: readonly string[]; hands: Record<string, Card[]> }): RoundState {
  const players = [...input.players];
  const hands = Object.fromEntries(players.map((p) => [p, [...(input.hands[p] ?? [])]]));
  const state: RoundState = {
    stake: input.stake,
    players,
    firstPlayer: players[0]!,
    hands,
    dealtHands: structuredClone(hands),
    abandoned: [],
    lateAbandoned: [],
    tricks: [{ number: 1, leader: players[0]!, plays: [], ledSuit: null, winner: null, winningCard: null }],
    turn: players[0]!,
    result: null,
  };
  const special = resolveSpecial(hands, players);
  if (special) finish(state, special.winner, "special", special.special.payout, null, special);
  return state;
}

function active(state: RoundState): string[] {
  return state.players.filter((p) => !state.abandoned.includes(p));
}

function currentTrick(state: RoundState): Trick {
  return state.tricks[state.tricks.length - 1]!;
}

/** Cartes que le joueur a le droit de poser maintenant. */
export function legalCards(state: RoundState, player: string): Card[] {
  if (state.result || state.turn !== player) return [];
  const hand = state.hands[player] ?? [];
  const led = currentTrick(state).ledSuit;
  if (!led) return [...hand];
  const follow = hand.filter((c) => c.suit === led);
  return follow.length > 0 ? follow : [...hand];
}

/** Prochain joueur actif, dans l'ordre de jeu après `from`, qui n'a pas encore joué dans le pli. */
function nextToPlay(state: RoundState, from: string): string | null {
  const trick = currentTrick(state);
  const order = rotate(state.players, from).slice(1).concat(from);
  for (const p of order) {
    if (state.abandoned.includes(p)) continue;
    if (trick.plays.some((pl) => pl.player === p)) continue;
    return p;
  }
  return null;
}

/**
 * Gagnant d'un pli : la plus forte carte de l'enseigne demandée parmi les joueurs encore en jeu.
 * Cas rare : si plus aucun joueur en jeu n'a posé l'enseigne demandée (le meneur a abandonné et
 * personne n'a suivi), on prend l'enseigne de la première carte encore valable.
 */
function trickWinner(state: RoundState, trick: Trick): Play {
  const valid = trick.plays.filter((pl) => !state.abandoned.includes(pl.player));
  const suit = valid.some((pl) => pl.card.suit === trick.ledSuit) ? trick.ledSuit : valid[0]!.card.suit;
  return valid
    .filter((pl) => pl.card.suit === suit)
    .reduce((best, pl) => (pl.card.rank > best.card.rank ? pl : best));
}

function finish(
  state: RoundState,
  winner: string,
  reason: FinishReason,
  payout: Payout,
  winningCard: Card | null,
  special: SpecialWin | null,
): void {
  state.turn = null;
  state.result = {
    winner,
    reason,
    payout,
    winningCard,
    special,
    settlement: settle({
      stake: state.stake,
      players: state.players,
      winner,
      payout,
      abandoned: state.abandoned,
      lateAbandoned: state.lateAbandoned,
      // Un abandon tardif paie 2 × la mise si le vainqueur gagne par Korat ou reste seul en jeu.
      lateDouble: payout === "korat" || reason === "last_standing",
    }),
  };
}

/** Clôt le pli s'il est complet, ou passe la main au joueur suivant. */
function advance(state: RoundState, lastActor: string): void {
  const remaining = active(state);
  if (remaining.length === 1) {
    finish(state, remaining[0]!, "last_standing", "simple", null, null);
    return;
  }
  const trick = currentTrick(state);
  const next = nextToPlay(state, lastActor);
  if (next) {
    state.turn = next;
    return;
  }
  const win = trickWinner(state, trick);
  trick.winner = win.player;
  trick.winningCard = win.card;
  if (trick.number === TRICKS_PER_ROUND) {
    finish(state, win.player, "fifth_trick", win.card.rank === 3 ? "korat" : "simple", win.card, null);
    return;
  }
  state.tricks.push({ number: trick.number + 1, leader: win.player, plays: [], ledSuit: null, winner: null, winningCard: null });
  state.turn = win.player;
}

function assertInRound(state: RoundState, player: string): void {
  if (state.result) throw new RuleError("round_finished", "La manche est terminée");
  if (!state.players.includes(player)) throw new RuleError("not_in_round", "Ce joueur ne participe pas à la manche");
  if (state.abandoned.includes(player)) throw new RuleError("already_abandoned", "Ce joueur a déjà abandonné");
}

/** Pose une carte. Renvoie un nouvel état ; lève RuleError si l'action est illégale. */
export function playCard(prev: RoundState, player: string, card: Card): RoundState {
  assertInRound(prev, player);
  if (prev.turn !== player) throw new RuleError("not_your_turn", "Ce n'est pas votre tour");
  const hand = prev.hands[player]!;
  if (!hand.some((c) => sameCard(c, card))) throw new RuleError("card_not_in_hand", `Carte absente de la main : ${cardId(card)}`);
  if (!legalCards(prev, player).some((c) => sameCard(c, card))) {
    throw new RuleError("must_follow_suit", "Vous devez jouer l'enseigne demandée");
  }
  const state = structuredClone(prev);
  state.hands[player] = state.hands[player]!.filter((c) => !sameCard(c, card));
  const trick = currentTrick(state);
  trick.plays.push({ player, card });
  if (!trick.ledSuit) trick.ledSuit = card.suit;
  advance(state, player);
  return state;
}

/**
 * Le 3e pli a-t-il commencé (première carte du 3e pli posée) ?
 * Avant ce moment, le bouton « Abandonner » est disponible ; ensuite seul le délai de 60 s fait abandonner.
 */
export function thirdTrickStarted(state: RoundState): boolean {
  const trick = currentTrick(state);
  return trick.number > 3 || (trick.number === 3 && trick.plays.length > 0);
}

/** Le joueur peut-il appuyer sur « Abandonner » maintenant ? */
export function canAbandon(state: RoundState, player: string): boolean {
  return !state.result && state.players.includes(player) && !state.abandoned.includes(player) && !thirdTrickStarted(state);
}

/**
 * Qui mène quand le joueur qui devait mener abandonne :
 * au 1er pli, le suivant dans l'ordre de jeu ; ensuite, le joueur encore en jeu qui avait la plus
 * haute carte de l'enseigne demandée au pli précédent (à défaut, le suivant dans l'ordre de jeu).
 */
function replacementLeader(state: RoundState, quitter: string): string | null {
  const trick = currentTrick(state);
  const prev = state.tricks[trick.number - 2];
  if (prev) {
    const best = prev.plays
      .filter((pl) => !state.abandoned.includes(pl.player) && pl.card.suit === prev.ledSuit)
      .sort((a, b) => b.card.rank - a.card.rank)[0];
    if (best) return best.player;
  }
  return nextToPlay(state, quitter);
}

function doAbandon(prev: RoundState, player: string): RoundState {
  const state = structuredClone(prev);
  state.lateAbandoned ??= []; // états enregistrés avant cette règle
  if (thirdTrickStarted(state)) state.lateAbandoned.push(player);
  state.abandoned.push(player);
  state.hands[player] = [];
  const trick = currentTrick(state);
  if (state.turn === player) {
    if (trick.plays.length === 0) {
      // Il devait mener : la main passe selon la règle de remplacement.
      const remaining = active(state);
      if (remaining.length === 1) {
        finish(state, remaining[0]!, "last_standing", "simple", null, null);
        return state;
      }
      const leader = replacementLeader(state, player)!;
      trick.leader = leader;
      state.turn = leader;
      return state;
    }
    advance(state, player);
  } else {
    // Le joueur attendu n'a pas encore joué, donc le pli n'est pas complet et le tour ne change pas.
    // Seul cas à traiter : il ne reste qu'un joueur en jeu.
    const remaining = active(state);
    if (remaining.length === 1) finish(state, remaining[0]!, "last_standing", "simple", null, null);
  }
  return state;
}

/** Bouton « Abandonner » : possible pour tout joueur en jeu, de la distribution jusqu'à la première carte du 3e pli. */
export function abandon(prev: RoundState, player: string): RoundState {
  assertInRound(prev, player);
  if (thirdTrickStarted(prev)) {
    throw new RuleError("abandon_closed", "L'abandon n'est plus possible à partir du 3e pli");
  }
  return doAbandon(prev, player);
}

/** 60 secondes écoulées sans jouer : le joueur attendu est considéré comme ayant abandonné, à tout moment. */
export function timeout(prev: RoundState, player: string): RoundState {
  assertInRound(prev, player);
  if (prev.turn !== player) throw new RuleError("not_your_turn", "Le délai ne concerne que le joueur attendu");
  return doAbandon(prev, player);
}

/** Joueur qui commence la manche suivante : celui à droite du vainqueur (suivant dans l'ordre de jeu), parmi les présents. */
export function nextFirstPlayer(seats: readonly string[], winner: string, present: readonly string[] = seats): string {
  const order = rotate(seats, winner).slice(1).concat(winner);
  const next = order.find((p) => present.includes(p));
  if (!next) throw new RuleError("invalid_setup", "Aucun joueur présent");
  return next;
}

/** Ce qu'un joueur a le droit de voir : sa main, les cartes posées, jamais les mains adverses (sauf victoire spéciale). */
export function playerView(state: RoundState, viewer: string) {
  const showAll = state.result?.reason === "special";
  return {
    stake: state.stake,
    players: state.players.map((p) => ({
      id: p,
      cardsLeft: state.hands[p]!.length,
      abandoned: state.abandoned.includes(p),
      hand: p === viewer ? state.hands[p] : showAll ? state.dealtHands[p] : undefined,
    })),
    tricks: state.tricks,
    turn: state.turn,
    legal: legalCards(state, viewer),
    result: state.result,
  };
}
