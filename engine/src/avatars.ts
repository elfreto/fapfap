// Avatars des joueurs : initiales (par défaut), avatar proposé par le jeu ou photo envoyée par le joueur.
// Valeur enregistrée : null (initiales), "preset:<id>" ou l'adresse https de la photo.

export const PRESET_AVATARS = [
  { id: "lion", emoji: "🦁", color: "#f2994a" },
  { id: "elephant", emoji: "🐘", color: "#6c7a89" },
  { id: "leopard", emoji: "🐆", color: "#d4a017" },
  { id: "girafe", emoji: "🦒", color: "#e0b354" },
  { id: "zebre", emoji: "🦓", color: "#4f4f4f" },
  { id: "gorille", emoji: "🦍", color: "#5d4037" },
  { id: "aigle", emoji: "🦅", color: "#2f80ed" },
  { id: "crocodile", emoji: "🐊", color: "#27ae60" },
  { id: "tortue", emoji: "🐢", color: "#16a5a5" },
  { id: "hibou", emoji: "🦉", color: "#9b51e0" },
  { id: "renard", emoji: "🦊", color: "#e2553f" },
  { id: "panthere", emoji: "🐈‍⬛", color: "#273c75" },
] as const;

export type PresetAvatarId = (typeof PRESET_AVATARS)[number]["id"];

/** Côté minimal d'une photo d'avatar, en pixels (la photo est ensuite recadrée en carré et réduite). */
export const AVATAR_MIN_PX = 200;
/** Côté de la photo enregistrée, en pixels. */
export const AVATAR_STORED_PX = 256;
/** Poids maximal de la photo enregistrée. */
export const AVATAR_MAX_BYTES = 300_000;

export function presetAvatar(value: string | null | undefined) {
  if (!value?.startsWith("preset:")) return null;
  const id = value.slice(7);
  return PRESET_AVATARS.find((a) => a.id === id) ?? null;
}

export function isPhotoAvatar(value: string | null | undefined): value is string {
  return !!value && value.startsWith("https://");
}

/** Lit la largeur et la hauteur d'un JPEG (marqueur SOF), ou null si ce n'est pas un JPEG lisible. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    i += 2 + len;
  }
  return null;
}
