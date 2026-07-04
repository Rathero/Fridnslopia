/**
 * Cosmetics (spec §8): direct-purchase skins only — NO loot boxes, no chance.
 * Purely visual: they never touch the deterministic sim. Persisted locally for
 * the MVP (a real build would sync entitlements from the server).
 *
 * A skin now describes a whole little character — a body colour, an emissive
 * accent trim, a body archetype and a head accessory — all built procedurally
 * in Three.js (no external assets, CSP-safe). See `game/character.ts`.
 */
import { modelSkins } from './game/modelLoader.js';

export type CharShape = 'bean' | 'bot' | 'blob';
export type CharAccessory =
  | 'none' | 'cap' | 'crown' | 'horns' | 'antenna' | 'halo' | 'visor' | 'headphones' | 'mohawk';

export interface Skin {
  id: string;
  name: string;
  price: number; // 0 = free / owned by default
  body: number; // hex color
  trail: number; // hex color
  accent: number; // emissive trim / glow
  shape: CharShape;
  accessory: CharAccessory;
  emoji: string; // shown in the store row
}

export const SKINS: Skin[] = [
  { id: 'default', name: 'Chispa', price: 0, body: 0x38e1ff, trail: 0x1b6c88, accent: 0x9df0ff, shape: 'bean', accessory: 'none', emoji: '🙂' },
  { id: 'lava', name: 'Magma', price: 199, body: 0xff6b35, trail: 0x7a2410, accent: 0xffd23c, shape: 'blob', accessory: 'mohawk', emoji: '🔥' },
  { id: 'toxic', name: 'Tóxico', price: 199, body: 0x9dff3c, trail: 0x3a6410, accent: 0xeaffb0, shape: 'blob', accessory: 'antenna', emoji: '☢️' },
  { id: 'grape', name: 'Uva', price: 299, body: 0xb06bff, trail: 0x4a2a7a, accent: 0xe6c8ff, shape: 'bean', accessory: 'horns', emoji: '👾' },
  { id: 'bolt', name: 'Voltio', price: 299, body: 0x2b3a67, trail: 0x1b2545, accent: 0x6bd0ff, shape: 'bot', accessory: 'headphones', emoji: '🤖' },
  { id: 'royal', name: 'Realeza', price: 499, body: 0xffd23c, trail: 0x8a6a10, accent: 0xfff0b0, shape: 'bean', accessory: 'crown', emoji: '👑' },
  { id: 'angel', name: 'Aura', price: 499, body: 0xf4f7ff, trail: 0x9fb0d0, accent: 0xbfe9ff, shape: 'bean', accessory: 'halo', emoji: '😇' },
  { id: 'visorx', name: 'Cyber', price: 399, body: 0x14203a, trail: 0x0b1428, accent: 0xff2e88, shape: 'bot', accessory: 'visor', emoji: '🕶️' },
];

const OWNED_KEY = 'trampa.owned';
const EQUIPPED_KEY = 'trampa.skin';

/**
 * Loaded GLB models (Meshy/CC0) surfaced as skins. Free + owned by default so
 * you can equip and see them straight away. Overrides a procedural skin sharing
 * the same id. Empty until a manifest is loaded, so the game is unchanged
 * without any models.
 */
function modelDerivedSkins(): Skin[] {
  return modelSkins().map((m) => ({
    id: m.id, name: m.name, price: 0,
    body: m.tint ?? 0xffffff, trail: 0x223, accent: m.tint ?? 0x38e1ff,
    shape: 'bean' as const, accessory: 'none' as const, emoji: m.emoji ?? '🧊',
  }));
}

/** Procedural skins + any loaded 3D models (models first, overriding by id). */
export function allSkins(): Skin[] {
  const models = modelDerivedSkins();
  const ids = new Set(models.map((m) => m.id));
  return [...models, ...SKINS.filter((s) => !ids.has(s.id))];
}

/** True for skins owned by default (free / model-backed). */
export function isFree(id: string): boolean {
  const s = allSkins().find((x) => x.id === id);
  return !!s && s.price === 0;
}

export function ownedSkins(): string[] {
  const raw = localStorage.getItem(OWNED_KEY);
  const owned = raw ? (JSON.parse(raw) as string[]) : [];
  if (!owned.includes('default')) owned.push('default');
  for (const s of allSkins()) if (s.price === 0 && !owned.includes(s.id)) owned.push(s.id);
  return owned;
}

export function ownSkin(id: string) {
  const owned = ownedSkins();
  if (!owned.includes(id)) {
    owned.push(id);
    localStorage.setItem(OWNED_KEY, JSON.stringify(owned));
  }
}

export function equippedSkin(): Skin {
  const id = localStorage.getItem(EQUIPPED_KEY) || 'default';
  return allSkins().find((s) => s.id === id) || SKINS[0];
}

export function equipSkin(id: string) {
  localStorage.setItem(EQUIPPED_KEY, id);
}
