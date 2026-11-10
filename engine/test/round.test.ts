import { describe, expect, it } from "vitest";
import { type Card, cardId } from "../src/cards.ts";
import {
  type RoundState,
  RuleError,
  abandon,
  legalCards,
  newRound,
  nextFirstPlayer,
  playCard,
  playerView,
  startRound,
  timeout,
} from "../src/round.ts";
import { c, seeded } from "./helpers.ts";

// Mains sans victoire spéciale (totaux > 21, pas de brelan ni de couleur).
const HANDS3 = {
  A: [c("zing", 10), c("zing", 9), c("koubi", 10), c("tchaka", 4), c("black", 5)],
  B: [c("zing", 8), c("koubi", 9), c("tchaka", 10), c("black", 9), c("black", 3)],
  C: [c("koubi", 8), c("tchaka", 9), c("tchaka", 8), c("black", 8), c("zing", 3)],
};

function round3(): RoundState {
  return startRound({ stake: 100, players: ["A", "B", "C"], hands: structuredClone(HANDS3) });
}

function expectRule(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    expect((e as RuleError).code).toBe(code);
    return;
  }
  throw new Error(`RuleError ${code} attendue`);
}

describe("déroulement d'une manche à 3 joueurs", () => {
  it("joue les 5 plis et le vainqueur du 5e pli gagne (victoire simple)", () => {
    let s = round3();
    expect(s.turn).toBe("A");
    // Pli 1 : B doit suivre zing.
    s = playCard(s, "A", c("zing", 10));
    expectRule(() => playCard(s, "B", c("koubi", 9)), "must_follow_suit");
    expect(legalCards(s, "B").map(cardId)).toEqual(["zing-8"]);
    s = playCard(s, "B", c("zing", 8));
    s = playCard(s, "C", c("zing", 3));
    expect(s.tricks[0]!.winner).toBe("A");
    // Pli 2
    s = playCard(s, "A", c("koubi", 10));
    s = playCard(s, "B", c("koubi", 9));
    s = playCard(s, "C", c("koubi", 8));
    // Pli 3 : B et C n'ont plus de zing et défaussent librement (T05).
    s = playCard(s, "A", c("zing", 9));
    s = playCard(s, "B", c("black", 3));
    s = playCard(s, "C", c("tchaka", 8));
    expect(s.tricks[2]!.winner).toBe("A");
    // Pli 4 : B gagne avec le 10 tchaka.
    s = playCard(s, "A", c("tchaka", 4));
    s = playCard(s, "B", c("tchaka", 10));
    s = playCard(s, "C", c("tchaka", 9));
    expect(s.tricks[3]!.winner).toBe("B");
    expect(s.turn).toBe("B");
    // Pli 5 : B mène, puis C et A dans le sens horaire.
    s = playCard(s, "B", c("black", 9));
    expectRule(() => playCard(s, "A", c("black", 5)), "not_your_turn");
    s = playCard(s, "C", c("black", 8));
    s = playCard(s, "A", c("black", 5));
    expect(s.result).toMatchObject({ winner: "B", reason: "fifth_trick", payout: "simple" });
    expect(s.result!.settlement.net).toEqual({ A: -100, B: 180, C: -100 });
    expect(s.turn).toBeNull();
    expectRule(() => playCard(s, "A", c("zing", 9)), "round_finished");
  });

  it("le 9 cœur gagne contre 4, 7 cœur et un carreau (T06)", () => {
    const s0 = startRound({
      stake: 100,
      players: ["A", "B", "C", "D"],
      hands: {
        A: [c("koubi", 4), c("tchaka", 10), c("tchaka", 9), c("black", 9), c("black", 8)],
        B: [c("koubi", 7), c("tchaka", 8), c("tchaka", 6), c("black", 6), c("zing", 10)],
        C: [c("koubi", 9), c("zing", 9), c("zing", 8), c("black", 5), c("tchaka", 5)],
        D: [c("zing", 6), c("zing", 5), c("tchaka", 3), c("black", 4), c("black", 7)],
      },
    });
    let s = playCard(s0, "A", c("koubi", 4));
    s = playCard(s, "B", c("koubi", 7));
    s = playCard(s, "C", c("koubi", 9));
    s = playCard(s, "D", c("zing", 6));
    expect(s.tricks[0]!.winner).toBe("C");
    expect(s.turn).toBe("C");
  });

  it("le meneur gagne si tous les autres défaussent (T07)", () => {
    let s = startRound({
      stake: 100,
      players: ["A", "B"],
      hands: {
        A: [c("black", 3), c("zing", 10), c("zing", 9), c("koubi", 10), c("koubi", 9)],
        B: [c("tchaka", 10), c("tchaka", 9), c("tchaka", 8), c("zing", 8), c("koubi", 8)],
      },
    });
    s = playCard(s, "A", c("black", 3));
    s = playCard(s, "B", c("tchaka", 10));
    expect(s.tricks[0]!.winner).toBe("A");
  });

  it("refuse le joueur qui n'a pas la main (T08) et une carte absente de la main (T12)", () => {
    const s = round3();
    expectRule(() => playCard(s, "B", c("zing", 8)), "not_your_turn");
    expectRule(() => playCard(s, "A", c("zing", 8)), "card_not_in_hand");
    expectRule(() => playCard(s, "Z", c("zing", 8)), "not_in_round");
  });

  it("ne modifie jamais l'état précédent", () => {
    const s = round3();
    const before = JSON.stringify(s);
    playCard(s, "A", c("zing", 10));
    abandon(s, "B");
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("victoire avec un 3 au 5e pli (Korat)", () => {
  const A2 = [c("koubi", 10), c("koubi", 9), c("tchaka", 10), c("tchaka", 9), c("zing", 3)];
  const B2 = [c("koubi", 8), c("koubi", 6), c("tchaka", 8), c("tchaka", 6), c("black", 9)];

  function playKorat(s: RoundState): RoundState {
    const pairs: Array<[Card, Card]> = [
      [c("koubi", 10), c("koubi", 8)],
      [c("koubi", 9), c("koubi", 6)],
      [c("tchaka", 10), c("tchaka", 8)],
      [c("tchaka", 9), c("tchaka", 6)],
      [c("zing", 3), c("black", 9)],
    ];
    for (const [a, b] of pairs) {
      s = playCard(s, "A", a);
      s = playCard(s, "B", b);
    }
    return s;
  }

  it("chaque adversaire paie 2 × la mise", () => {
    const s = playKorat(startRound({ stake: 100, players: ["A", "B"], hands: { A: A2, B: B2 } }));
    expect(s.result).toMatchObject({ winner: "A", payout: "korat", winningCard: { suit: "zing", rank: 3 } });
    expect(s.result!.settlement.net).toEqual({ A: 180, B: -200 });
  });

  it("l'abandonnant ne paie que 1 × la mise même en cas de Korat", () => {
    let s = startRound({
      stake: 100,
      players: ["A", "B", "C"],
      hands: { A: A2, B: B2, C: [c("zing", 10), c("zing", 9), c("black", 8), c("black", 7), c("koubi", 7)] },
    });
    s = abandon(s, "C");
    s = playKorat(s);
    expect(s.result!.settlement.paidBy).toEqual({ B: 200, C: 100 });
    expect(s.result!.settlement.net).toEqual({ A: 270, B: -200, C: -100 });
  });
});

describe("abandon et minuteur", () => {
  it("à 2 joueurs, un abandon fait gagner l'autre immédiatement (T13 n'existe plus)", () => {
    const s = abandon(
      startRound({
        stake: 500,
        players: ["A", "B"],
        hands: { A: HANDS3.A, B: HANDS3.B },
      }),
      "A",
    );
    expect(s.result).toMatchObject({ winner: "B", reason: "last_standing", payout: "simple" });
    expect(s.result!.settlement.net).toEqual({ A: -500, B: 450 });
  });

  it("un joueur qui n'a pas la main peut abandonner : le pli continue sans lui", () => {
    let s = abandon(round3(), "C");
    expect(s.turn).toBe("A");
    s = playCard(s, "A", c("zing", 10));
    s = playCard(s, "B", c("zing", 8));
    expect(s.tricks[0]!.winner).toBe("A");
    expect(s.tricks).toHaveLength(2);
    expectRule(() => playCard(s, "C", c("zing", 3)), "already_abandoned");
  });

  it("30 s écoulées = abandon, et le tour passe au suivant", () => {
    let s = playCard(round3(), "A", c("zing", 10));
    expectRule(() => timeout(s, "C"), "not_your_turn");
    s = timeout(s, "B");
    expect(s.abandoned).toEqual(["B"]);
    expect(s.hands.B).toEqual([]);
    expect(s.turn).toBe("C");
    s = playCard(s, "C", c("zing", 3));
    expect(s.tricks[0]!.winner).toBe("A");
  });

  it("si le meneur abandonne avant de jouer, le suivant mène", () => {
    const s = abandon(round3(), "A");
    expect(s.turn).toBe("B");
    expect(s.tricks[0]!.leader).toBe("B");
  });

  it("la carte déjà posée par un abandonnant ne peut plus gagner le pli", () => {
    let s = playCard(round3(), "A", c("zing", 10));
    s = playCard(s, "B", c("zing", 8));
    s = abandon(s, "A");
    s = playCard(s, "C", c("zing", 3));
    expect(s.tricks[0]!.winner).toBe("B");
    expect(s.tricks[0]!.plays).toHaveLength(3);
    expect(s.turn).toBe("B");
  });

  it("le dernier joueur en jeu gagne la manche", () => {
    let s = abandon(round3(), "B");
    s = abandon(s, "A");
    expect(s.result).toMatchObject({ winner: "C", reason: "last_standing" });
    expect(s.result!.settlement.net).toEqual({ A: -100, B: -100, C: 180 });
  });
});

describe("victoire spéciale à la distribution", () => {
  it("arrête la manche sans pli et montre toutes les mains", () => {
    const s = startRound({
      stake: 100,
      players: ["A", "B"],
      hands: { A: HANDS3.A, B: [c("zing", 7), c("tchaka", 7), c("koubi", 7), c("black", 9), c("zing", 10)] },
    });
    expect(s.result).toMatchObject({ winner: "B", reason: "special", payout: "simple" });
    expect(s.turn).toBeNull();
    expect(playerView(s, "A").players.find((p) => p.id === "B")!.hand).toHaveLength(5);
  });
});

describe("manche suivante et vue joueur", () => {
  it("le joueur à gauche du vainqueur commence la manche suivante", () => {
    expect(nextFirstPlayer(["A", "B", "C", "D"], "B")).toBe("C");
    expect(nextFirstPlayer(["A", "B", "C", "D"], "D")).toBe("A");
    expect(nextFirstPlayer(["A", "B", "C", "D"], "D", ["B", "C", "D"])).toBe("B");
  });

  it("un joueur ne voit jamais la main des autres en cours de manche", () => {
    const view = playerView(round3(), "B");
    expect(view.players.find((p) => p.id === "B")!.hand).toHaveLength(5);
    expect(view.players.find((p) => p.id === "A")!.hand).toBeUndefined();
    expect(view.players.find((p) => p.id === "A")!.cardsLeft).toBe(5);
    expect(view.legal).toEqual([]);
  });

  it("newRound part du premier joueur et distribue 5 cartes distinctes à chacun", () => {
    const s = newRound({ stake: 100, seats: ["A", "B", "C", "D"], firstPlayer: "C", randomInt: seeded(7) });
    expect(s.players).toEqual(["C", "D", "A", "B"]);
    const all = Object.values(s.dealtHands).flat().map(cardId);
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
  });

  it("refuse une manche à 1 ou 5 joueurs, ou avec une mise non prévue", () => {
    expectRule(() => newRound({ stake: 100, seats: ["A"], firstPlayer: "A" }), "invalid_setup");
    expectRule(() => newRound({ stake: 100, seats: ["A", "B", "C", "D", "E"], firstPlayer: "A" }), "invalid_setup");
    expectRule(() => newRound({ stake: 150, seats: ["A", "B"], firstPlayer: "A" }), "invalid_setup");
  });
});

describe("parties aléatoires (propriétés)", () => {
  it("10 000 manches au hasard restent cohérentes", () => {
    const rnd = seeded(2026);
    const stats = { fifth_trick: 0, special: 0, last_standing: 0, korat: 0 };
    for (let i = 0; i < 10_000; i++) {
      const seats = ["A", "B", "C", "D"].slice(0, 2 + rnd(3));
      let s = newRound({ stake: 100, seats, firstPlayer: seats[rnd(seats.length)]!, randomInt: rnd });
      let guard = 0;
      while (!s.result) {
        if (++guard > 100) throw new Error("manche sans fin");
        const p = s.turn!;
        if (rnd(40) === 0) {
          s = rnd(2) ? timeout(s, p) : abandon(s, p);
          continue;
        }
        const legal = legalCards(s, p);
        expect(legal.length).toBeGreaterThan(0);
        s = playCard(s, p, legal[rnd(legal.length)]!);
      }
      const { settlement } = s.result;
      const total = Object.values(settlement.net).reduce((a, b) => a + b, 0);
      expect(total + settlement.commission).toBe(0);
      for (const p of seats) expect(settlement.net[p]!).toBeGreaterThanOrEqual(-200);
      expect(s.abandoned).not.toContain(s.result.winner);
      if (s.result.reason === "fifth_trick") {
        expect(s.tricks).toHaveLength(5);
        for (const p of seats) if (!s.abandoned.includes(p)) expect(s.hands[p]).toHaveLength(0);
      }
      stats[s.result.reason]++;
      if (s.result.payout === "korat") stats.korat++;
    }
    expect(stats.fifth_trick).toBeGreaterThan(0);
    expect(stats.special).toBeGreaterThan(0);
    expect(stats.last_standing).toBeGreaterThan(0);
    expect(stats.korat).toBeGreaterThan(0);
  });
});
