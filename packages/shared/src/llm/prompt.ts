import { DAILY_MODIFIERS } from '../constants.js';

/**
 * Build the LLM prompt for the daily config (spec §4.4). The model returns
 * STRICT JSON only — theme, palette, tag weights, difficulty, length, a
 * modifier from the closed enum, and flavour text. It never emits geometry.
 */
export function buildDailyConfigPrompt(input: {
  date: string;
  availableTags: string[];
  targetDifficulty: number;
  recentThemes: string[];
}): { system: string; user: string } {
  const system = [
    'You are the level DIRECTOR for a comedic 2D obstacle-race game.',
    'You DO NOT design geometry. You only choose a theme, palette, tag weights,',
    'a difficulty target, a length, one daily modifier, and a short flavour line.',
    'Respond with STRICT JSON only — no prose, no markdown fences.',
    '',
    'JSON shape:',
    '{',
    '  "theme": string (snake_case, e.g. "lava_caves"),',
    '  "palette": { "bg": "#rrggbb", "platform": "#rrggbb", "accent": "#rrggbb" },',
    `  "chunkWeights": object mapping any of [${input.availableTags.join(', ')}] to a number 0..5,`,
    '  "maxDifficulty": integer 1..5,',
    '  "length": integer 4..20,',
    `  "dailyModifier": one of [${DAILY_MODIFIERS.join(', ')}],`,
    '  "flavorText": short Spanish one-liner, max 120 chars',
    '}',
  ].join('\n');

  const user = [
    `Date: ${input.date}`,
    `Target difficulty (guidance for maxDifficulty): ${input.targetDifficulty}`,
    `Recent themes to avoid repeating: ${input.recentThemes.join(', ') || 'none'}`,
    'Make today feel distinct from recent days. Output JSON only.',
  ].join('\n');

  return { system, user };
}
