# @trampa/shared

The **deterministic core** of TRAMPA. No UI, no server, no DB — just the pieces
that must produce identical results everywhere: PRNG, physics, course generation,
verification, the Rapier2D simulation, and the LLM daily-config schema. Both the
client and the server import the **built** package (`npm run build:shared`), which
is how the server can re-simulate a run for anti-cheat.

> Read the repo-root [`CLAUDE.md`](../../CLAUDE.md) for the golden determinism
> rules before changing anything here.

## What's inside

| Module | Exports | Purpose |
|--------|---------|---------|
| `prng.ts` | `Rng`, `seedFromString` | mulberry32 seeded PRNG (float/int/pick/weightedPick). The ONLY randomness allowed in the sim. |
| `constants.ts` | `PHYSICS`, `FIXED_DT`, `DAILY_MODIFIERS`, `applyModifier`, `MAX_RUN_FRAMES` | Feel/physics params (§3.1) + closed modifier enum. |
| `chunks/` | `CHUNKS`, `CHUNKS_BY_ID`, chunk types | Hand-authored 2D chunk library + contracts. |
| `assembler.ts` | `assembleCourse(seed, config)` | Deterministic seeded course build with a difficulty curve. |
| `reach.ts` | `computeReachEnvelope`, `maxHorizontalReach` | Analytic jump reach for the verifier. |
| `verifier.ts` | `verifyCourse`, `verifyTrapPlacement` | Completability BFS + trap-slot validation. |
| `course.ts` | `Course`, `PlacedTrap`, `TrapType`, `CourseTrapSlot` | The laid-out course model. |
| `sim/world.ts` | `SimWorld`, `initRapier`, `InputLog` | **The movement source of truth** (fixed 60 Hz Rapier2D). Drives live play, ghosts, and anti-cheat. |
| `sim/simulate.ts` | `simulateRun(course, log, traps)` | Headless replay → `{ finished, timeMs, frames, deaths }`. |
| `sim/autopilot.ts` | `autopilot(course, traps)` | Heuristic bot that produces a **finishing** input log (tests/CI/demos). |
| `llm/schema.ts` | `DailyConfigSchema`, `defaultConfig`, `parseDailyConfig` | Zod-validated daily config + safe fallback. |
| `llm/prompt.ts` | `buildDailyConfigPrompt` | The strict-JSON prompt for the model. |
| `index.ts` | `generateVerifiedCourse(seed, config)` | Assemble + verify (re-samples on failure). |

## Build & test

```bash
npm run build          # tsc → dist/  (client & server consume dist)
npm test               # node:test — determinism, completability, autopilot
```

`determinism.test.ts` is the tripwire: same seed → identical course; same input
log → identical sim (frame-by-frame); every default course verifies; the autopilot
finishes and its log re-simulates to the exact time. Keep it green.

## Extending

- **New chunk** → `chunks/library.ts`. Keep `entryY === exitY === 8` so seams
  connect; add `trapSlots` (authored = pre-vetted safe), `tags`, `difficulty`.
- **New daily modifier** → `DAILY_MODIFIERS` + `applyModifier` (+ the enum is
  inferred by the Zod schema automatically).
- **New trap type** → extend `TrapType` and materialise its effect in
  `SimWorld` (danger resolution). Anything that changes the sim must keep the
  determinism tests passing.
