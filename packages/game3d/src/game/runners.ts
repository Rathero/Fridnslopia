import type { Skin } from '../cosmetics.js';
import { Character, type Runner } from './character.js';
import { CharacterModel } from './characterModel.js';
import { hasModel, instantiateModel } from './modelLoader.js';

/**
 * Build the right runner for a skin: a loaded GLB model if one is registered
 * for this skin id, otherwise the procedural character. Always succeeds — any
 * model failure falls back to procedural so the game never breaks.
 */
export function makeRunner(skin: Skin, ghost = false): Runner {
  if (hasModel(skin.id)) {
    const inst = instantiateModel(skin.id);
    if (inst) {
      try {
        return new CharacterModel(inst.scene, inst.animations, inst.skin, { ghost });
      } catch (e) {
        console.warn('[runner] model init failed, using procedural', e);
      }
    }
  }
  return new Character(skin, { ghost });
}

export type { Runner };
