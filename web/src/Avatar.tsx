import { useRef, useState } from "react";
import { AVATAR_MIN_PX, AVATAR_STORED_PX, PRESET_AVATARS, isPhotoAvatar, presetAvatar } from "@fapfap/engine";

const COLORS = ["#e2553f", "#2f80ed", "#27ae60", "#9b51e0", "#f2994a", "#16a5a5", "#d6336c"];
export function avatarColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}

/** Contenu d'un avatar rond : photo, avatar proposé ou initiales sur une couleur propre au joueur. */
export function Avatar({ id, name, avatar, className = "avatar" }: { id: string; name: string; avatar?: string | null; className?: string }) {
  const preset = presetAvatar(avatar);
  if (isPhotoAvatar(avatar)) {
    return (
      <div className={`${className} photo`}>
        <img src={avatar} alt={name} />
      </div>
    );
  }
  if (preset) {
    return (
      <div className={`${className} preset`} style={{ background: preset.color }} aria-label={name}>
        <span>{preset.emoji}</span>
      </div>
    );
  }
  return (
    <div className={className} style={{ background: avatarColor(id) }} aria-label={name}>
      {initials(name)}
    </div>
  );
}

export type AvatarChoice = { kind: "initials" } | { kind: "preset"; preset: string } | { kind: "photo"; image: string };

/** Recadre la photo en carré au centre et la réduit, après avoir vérifié la taille minimale. */
async function preparePhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choisissez une image (JPEG, PNG…)");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Image illisible"));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w < AVATAR_MIN_PX || h < AVATAR_MIN_PX) {
      throw new Error(`Photo trop petite (${w} × ${h}) : il faut au moins ${AVATAR_MIN_PX} × ${AVATAR_MIN_PX} pixels.`);
    }
    const side = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = AVATAR_STORED_PX;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, AVATAR_STORED_PX, AVATAR_STORED_PX);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fenêtre de choix de l'avatar : initiales, avatar proposé par le jeu ou photo du joueur. */
export function AvatarPicker({
  me,
  onSave,
  onClose,
}: {
  me: { id: string; pseudo: string; avatar?: string | null };
  onSave: (choice: AvatarChoice) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const current = me.avatar ?? null;

  async function save(choice: AvatarChoice) {
    setBusy(true);
    setError(null);
    try {
      await onSave(choice);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" onClick={onClose}>
      <div className="modal-box avatar-picker" onClick={(e) => e.stopPropagation()}>
        <h2>Votre avatar</h2>
        <div className="avatar-grid">
          <button type="button" className={`avatar-opt ${!current ? "on" : ""}`} disabled={busy} onClick={() => save({ kind: "initials" })}>
            <Avatar id={me.id} name={me.pseudo} className="avatar-mini" />
            <span>Initiales</span>
          </button>
          {PRESET_AVATARS.map((a) => (
            <button
              type="button"
              key={a.id}
              className={`avatar-opt ${current === `preset:${a.id}` ? "on" : ""}`}
              disabled={busy}
              onClick={() => save({ kind: "preset", preset: a.id })}
            >
              <Avatar id={me.id} name={a.id} avatar={`preset:${a.id}`} className="avatar-mini" />
            </button>
          ))}
        </div>
        <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
          {busy ? "Envoi…" : isPhotoAvatar(current) ? "Changer de photo" : "Utiliser une photo"}
        </button>
        <p className="muted small">Photo de {AVATAR_MIN_PX} × {AVATAR_MIN_PX} pixels minimum, recadrée en carré.</p>
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const image = await preparePhoto(f);
              await save({ kind: "photo", image });
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
