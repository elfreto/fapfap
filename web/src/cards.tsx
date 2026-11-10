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
  state?: "legal" | "illegal" | "selected" | "winner";
  onClick?: () => void;
  tag?: string;
}) {
  const red = RED.includes(card.suit);
  const cls = ["card", `card-${size}`, red ? "red" : "black", state ? `is-${state}` : ""].join(" ");
  const content = (
    <>
      <span className="card-corner">
        <b>{card.rank}</b>
        <span>{SUIT_SYMBOL[card.suit]}</span>
      </span>
      <span className="card-center">{SUIT_SYMBOL[card.suit]}</span>
      <span className="card-name">{SUIT_NAME[card.suit]}</span>
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
