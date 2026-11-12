import { describe, expect, it } from "vitest";
import { jpegSize, presetAvatar, isPhotoAvatar } from "../src/avatars.ts";
import { tableAmounts } from "../src/settlement.ts";

/** JPEG minimal : SOI, un segment APP0, puis SOF0 avec hauteur et largeur. */
function fakeJpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

describe("avatars", () => {
  it("lit la taille d'un JPEG", () => {
    expect(jpegSize(fakeJpeg(256, 300))).toEqual({ width: 256, height: 300 });
  });
  it("refuse ce qui n'est pas un JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
  it("reconnaît les avatars proposés et les photos", () => {
    expect(presetAvatar("preset:lion")?.emoji).toBe("🦁");
    expect(presetAvatar("preset:inconnu")).toBeNull();
    expect(presetAvatar(null)).toBeNull();
    expect(isPhotoAvatar("https://x.supabase.co/a.jpg")).toBe(true);
    expect(isPhotoAvatar("preset:lion")).toBe(false);
  });
});

describe("sommes de la table", () => {
  it("pot = mise × joueurs, caisse Korat = 1 × la mise, 2 × la mise bloquée par joueur", () => {
    expect(tableAmounts(100, 4)).toEqual({ pot: 400, koratFund: 100, lockedPerPlayer: 200 });
  });
});
