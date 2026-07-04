# Character models (Meshy / CC0 → TRAMPA)

Drop a `.glb` in this folder and add an entry to `manifest.json`. The game loads
it at boot and it becomes a playable character (shown in the Store tagged
**"modelo 3D"**). If a model is missing or fails to load, the game falls back to
the procedural character automatically — nothing breaks.

## 1. Generate the model (Meshy)

- **Text-to-3D** (or Image-to-3D) → set **Model Type: Low Poly** (real-time game mesh).
- Set **Pose: A-pose** (or T-pose) so the **auto-rig** works.
- Prompt structure: *silhouette + type + colour story + accessories + pose + art style*.
  Example: `chibi bean-shaped runner mascot, round chunky body, big friendly eyes,
  tiny arms and legs, glossy cyan plastic, A-pose, stylized low-poly hand-painted game character`.
- **Animate**: auto-rig, then add at least a **run/walk** clip (and optionally **jump**, **idle**).
- **Export as GLB** (embedded textures + embedded animations). Meshopt or Draco
  compression is fine (both decoders are bundled); uncompressed also works.

## 2. Drop it in

Put e.g. `runner-cyan.glb` in this folder.

## 3. Register it in `manifest.json`

```json
[
  {
    "id": "meshy-cyan",
    "name": "Corredor Cian",
    "file": "runner-cyan.glb",
    "emoji": "🟦",
    "scale": 1,
    "yaw": 0,
    "clips": { "run": "Run", "jump": "Jump", "idle": "Idle" }
  }
]
```

- `id` — unique. If it equals a procedural skin id (e.g. `"default"`) it **replaces** it.
- `file` — the GLB filename in this folder.
- `emoji` — store row icon.
- `scale` — leave `1`; the model auto-fits to standard height. Nudge if needed.
- `yaw` — radians. If the character runs **backwards**, set `3.14159`.
- `clips` — optional exact clip names. If omitted, the loader fuzzy-matches by
  name (`run`/`walk`, `jump`/`fall`, `idle`). If your GLB has one clip, it's used
  as the run loop.

## 4. See it

Rebuild + deploy (or `npm run dev`), open the game → **Tienda** → equip it. The
model gets auto-scaled, oriented, its feet dropped to the floor, and its run/jump
animation driven by the sim. Ghosts of friends using the same id use it too
(translucent).

Notes: models are **pure rendering** — they never touch the deterministic sim, so
anti-cheat is unaffected. Keep each GLB lean (~100–400 KB) for fast mobile load.
