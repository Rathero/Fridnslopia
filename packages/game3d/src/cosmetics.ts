/**
 * Cosmetics (spec §8): direct-purchase skins only — NO loot boxes, no chance.
 * Purely visual: they never touch the deterministic sim. Persisted locally for
 * the MVP (a real build would sync entitlements from the server).
 *
 * A skin now describes a whole little character — a body colour, an emissive
 * accent trim, a body archetype and a head accessory — all built procedurally
 * in Three.js (no external assets, CSP-safe). See `game/character.ts`.
 */
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

export function ownedSkins(): string[] {
  const raw = localStorage.getItem(OWNED_KEY);
  const owned = raw ? (JSON.parse(raw) as string[]) : [];
  if (!owned.includes('default')) owned.push('default');
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
  return SKINS.find((s) => s.id === id) || SKINS[0];
}

export function equipSkin(id: string) {
  localStorage.setItem(EQUIPPED_KEY, id);
}
