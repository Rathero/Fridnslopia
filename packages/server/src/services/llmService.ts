import {
  CHUNKS,
  buildDailyConfigPrompt,
  defaultConfig,
  parseDailyConfig,
  type DailyConfig,
} from '@trampa/shared';
import { LLM_API_KEY, LLM_MODEL } from '../env.js';

/** All distinct chunk tags in the library — the palette the LLM may weight. */
const AVAILABLE_TAGS: string[] = Array.from(
  new Set(CHUNKS.flatMap((c) => c.tags)),
).sort();

/** Target difficulty passed to the prompt (spec §4.4). */
const TARGET_DIFFICULTY = 3;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

interface GetDailyConfigInput {
  date: string;
  recentThemes?: string[];
}

/**
 * Produce a validated DailyConfig for a given day. If an Anthropic key is set,
 * calls the Messages API and validates the JSON with Zod; otherwise (or on ANY
 * error) returns the deterministic fallback. This function NEVER throws — a
 * model hiccup must never break the day for a league (spec §4.4).
 */
export async function getDailyConfig(input: GetDailyConfigInput): Promise<DailyConfig> {
  const { date, recentThemes = [] } = input;

  if (!LLM_API_KEY) return defaultConfig;

  try {
    const { system, user } = buildDailyConfigPrompt({
      date,
      availableTags: AVAILABLE_TAGS,
      targetDifficulty: TARGET_DIFFICULTY,
      recentThemes,
    });

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': LLM_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    if (!res.ok) {
      console.warn(`[llm] non-OK response ${res.status}; using defaultConfig`);
      return defaultConfig;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((b) => b.type === 'text')?.text ?? '';
    const json = extractJson(text);

    const { config, usedFallback } = parseDailyConfig(json);
    if (usedFallback) {
      console.warn('[llm] model output failed validation; using defaultConfig');
    }
    return config;
  } catch (err) {
    console.warn('[llm] generation failed; using defaultConfig', err);
    return defaultConfig;
  }
}

/**
 * Best-effort extraction of a JSON object from model text. Handles a bare
 * object, or one wrapped in prose / code fences, by slicing the outermost
 * braces. Returns `null` if nothing parseable is found (parseDailyConfig then
 * falls back).
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to brace slice */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* ignore */
    }
  }
  return null;
}
