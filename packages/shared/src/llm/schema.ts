import { z } from 'zod';
import { DAILY_MODIFIERS } from '../constants.js';

/**
 * The daily course config (spec §4.4). This is the ONLY thing the LLM
 * produces — theme, palette, tag weights, difficulty, length, a modifier from
 * a closed enum, and flavour text. It never touches geometry. Validated with
 * Zod; on any failure we fall back to defaultConfig so a model hiccup can
 * never break the day for a league.
 */
export const DailyConfigSchema = z.object({
  theme: z.string().min(1).max(40),
  palette: z.object({
    bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    platform: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  chunkWeights: z.record(z.string(), z.number().min(0).max(5)),
  maxDifficulty: z.number().int().min(1).max(5),
  length: z.number().int().min(4).max(20),
  dailyModifier: z.enum(DAILY_MODIFIERS),
  flavorText: z.string().min(1).max(200),
});

export type DailyConfig = z.infer<typeof DailyConfigSchema>;

/**
 * Deterministic fallback config. Used when there is no LLM configured, or the
 * model output fails validation, or it times out. Never throws.
 */
export const defaultConfig: DailyConfig = {
  theme: 'neon_grid',
  palette: { bg: '#0b0f1a', platform: '#2a3550', accent: '#38e1ff' },
  chunkWeights: { gap: 1.2, jump: 1.2, midair: 1.0, moving: 0.8, spike: 1.0, saw: 0.6, flat: 0.8, climb: 0.9 },
  maxDifficulty: 4,
  length: 16,
  dailyModifier: 'none',
  flavorText: 'Otro día, otra carrera. A correr.',
};

/**
 * Parse + validate arbitrary LLM output. Returns the validated config, or the
 * fallback if anything is wrong. `merge` fills any missing optional-ish fields
 * from the default so a partial-but-valid object still works.
 */
export function parseDailyConfig(raw: unknown): { config: DailyConfig; usedFallback: boolean } {
  const result = DailyConfigSchema.safeParse(raw);
  if (result.success) return { config: result.data, usedFallback: false };
  return { config: defaultConfig, usedFallback: true };
}
