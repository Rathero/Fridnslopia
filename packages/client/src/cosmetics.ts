/**
 * Cosmetics (spec §8): direct-purchase skins only — NO loot boxes, no chance.
 * Purely visual: they never touch the deterministic sim. Persisted locally for
 * the MVP (a real build would sync entitlements from the server).
 */
export interface Skin {
  id: string;
  name: string;
  price: number; // 0 = free / owned by default
  body: number; // hex color
  trail: number; // hex color
}

export const SKINS: Skin[] = [
  { id: 'default', name: 'Pelota', price: 0, body: 0x38e1ff, trail: 0x1b6c88 },
  { id: 'lava', name: 'Magma', price: 199, body: 0xff6b35, trail: 0x7a2410 },
  { id: 'toxic', name: 'Tóxico', price: 199, body: 0x9dff3c, trail: 0x3a6410 },
  { id: 'grape', name: 'Uva', price: 299, body: 0xb06bff, trail: 0x4a2a7a },
  { id: 'gold', name: 'Oro', price: 499, body: 0xffd23c, trail: 0x8a6a10 },
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
