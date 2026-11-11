import type { Card, Suit } from "@fapfap/engine";

export const SUIT_SYMBOL: Record<Suit, string> = { tchaka: "♣", zing: "♦", koubi: "♥", black: "♠" };
export const SUIT_NAME: Record<Suit, string> = { tchaka: "Tchaka", zing: "Zing", koubi: "Koubi", black: "Black" };
const RED: Suit[] = ["zing", "koubi"];

export function cardLabel(c: Card): string {
  return `${c.rank} ${SUIT_NAME[c.suit]}`;
}

export function CardFace({
  card,
  size = "md",
  state,
  onClick,
  tag,
}: {
  card: Card;
  size?: "sm" | "md" | "lg";
  state?: "legal" | "illegal" | "selected" | "winner" | "current" | "won" | "old";
  onClick?: () => void;
  tag?: string;
}) {
  const red = RED.includes(card.suit);
  const cls = ["card", `card-${size}`, red ? "red" : "black", state ? `is-${state}` : ""].join(" ");
  const content = (
    <>
      <CardSvg card={card} />
      {tag && <span className="card-tag">{tag}</span>}
    </>
  );
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

export function CardBack({ count }: { count: number }) {
  return (
    <span className="backs" aria-label={`${count} cartes`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="card-back" />
      ))}
    </span>
  );
}

/** Carte au modèle simple : grande valeur et petite enseigne en haut à gauche, grand symbole en bas à droite. */
function CardSvg({ card }: { card: Card }) {
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
}
