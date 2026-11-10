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

/** Positions des symboles (carte de 100 × 140), comme sur un jeu classique. */
const L = 35, R = 65, C = 50;
const PIPS: Record<number, Array<[number, number]>> = {
  3: [[C, 24], [C, 70], [C, 116]],
  4: [[L, 24], [R, 24], [L, 116], [R, 116]],
  5: [[L, 24], [R, 24], [C, 70], [L, 116], [R, 116]],
  6: [[L, 24], [R, 24], [L, 70], [R, 70], [L, 116], [R, 116]],
  7: [[L, 24], [R, 24], [C, 47], [L, 70], [R, 70], [L, 116], [R, 116]],
  8: [[L, 24], [R, 24], [C, 47], [L, 70], [R, 70], [C, 93], [L, 116], [R, 116]],
  9: [[L, 24], [R, 24], [L, 55], [R, 55], [C, 70], [L, 85], [R, 85], [L, 116], [R, 116]],
  10: [[L, 24], [R, 24], [C, 39], [L, 55], [R, 55], [L, 85], [R, 85], [C, 101], [L, 116], [R, 116]],
};

function CardSvg({ card }: { card: Card }) {
  const sym = SUIT_SYMBOL[card.suit];
  const corner = (
    <g>
      <text x="12" y="21" className="cs-rank" textAnchor="middle" letterSpacing={card.rank === 10 ? -2 : undefined}>
        {card.rank}
      </text>
      <text x="12" y="37" className="cs-suit" textAnchor="middle">
        {sym}
      </text>
    </g>
  );
  return (
    <svg className="card-svg" viewBox="0 0 100 140" aria-hidden="true">
      {corner}
      <g transform="rotate(180 50 70)">{corner}</g>
      {PIPS[card.rank]!.map(([x, y], i) => (
        <text key={i} x={x} y={y} className="cs-pip" textAnchor="middle" dominantBaseline="central" transform={y > 70 ? `rotate(180 ${x} ${y})` : undefined}>
          {sym}
        </text>
      ))}
    </svg>
  );
}
