import { memo } from "react";
import type { Card, Suit } from "@fapfap/engine";

export const SUIT_SYMBOL: Record<Suit, string> = { tchaka: "♣", zing: "♦", koubi: "♥", black: "♠" };
export const SUIT_NAME: Record<Suit, string> = { tchaka: "Tchaka", zing: "Zing", koubi: "Koubi", black: "Black" };
/** Ordre des enseignes dans la main d'un joueur (décision LeCerf). */
const HAND_SUIT_ORDER: Suit[] = ["black", "zing", "tchaka", "koubi"];

/** Main triée : cartes de même enseigne côte à côte (black, zing, tchaka, koubi), valeurs croissantes. */
export function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => HAND_SUIT_ORDER.indexOf(a.suit) - HAND_SUIT_ORDER.indexOf(b.suit) || a.rank - b.rank);
}

const RED: Suit[] = ["zing", "koubi"];

export function cardLabel(c: Card): string {
  return `${c.rank} ${SUIT_NAME[c.suit]}`;
}

export function CardFace({
  card,
  size = "md",
  state,
  onClick,
}: {
  card: Card;
  size?: "sm" | "md" | "lg";
  state?: "legal" | "illegal" | "selected" | "winner" | "current" | "won" | "old";
  onClick?: () => void;
}) {
  const red = RED.includes(card.suit);
  const cls = ["card", `card-${size}`, red ? "red" : "black", state ? `is-${state}` : ""].join(" ");
  const content = <CardSvg card={card} />;
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-label={cardLabel(card)} disabled={state === "illegal"}>
        {content}
      </button>
    );
  }
  return (
    <div className={cls} aria-label={cardLabel(card)}>
      {content}
    </div>
  );
}

/** Carte au modèle simple : grande valeur et petite enseigne en haut à gauche, grand symbole en bas à droite. */
const CardSvg = memo(function CardSvg({ card }: { card: Card }) {
  const sym = SUIT_SYMBOL[card.suit];
  return (
    <svg className="card-svg" viewBox="0 0 100 140" aria-hidden="true">
      <text x="9" y="36" className="cs-rank" letterSpacing={card.rank === 10 ? -3 : undefined}>
        {card.rank}
      </text>
      <text x="21" y="60" className="cs-suit" textAnchor="middle">
        {sym}
      </text>
      <text x="64" y="126" className="cs-big" textAnchor="middle">
        {sym}
      </text>
    </svg>
  );
}, (a, b) => a.card.suit === b.card.suit && a.card.rank === b.card.rank);
