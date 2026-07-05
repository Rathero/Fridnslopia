// Generation jobs for Meshy. Characters get auto-rigged + a running animation;
// props are static. Prompts follow Meshy's structure: silhouette + type +
// colour story + accessories + pose + art style. Characters emphasise clearly
// separated limbs + A-pose so the auto-rigger has a clean humanoid to work with.

const ART = 'stylized low-poly hand-painted mobile game art, clean silhouette, vibrant, smooth';

export const EXAMPLES = {
  characters: [
    {
      id: 'runner-cyan', name: 'Chispa', emoji: '🟦',
      prompt: `cute chibi runner mascot, round chunky body, big friendly eyes, clearly separated short arms and legs, standing upright, glossy cyan plastic skin, white belly, A-pose, ${ART}`,
    },
    {
      id: 'runner-royal', name: 'Realeza', emoji: '👑',
      prompt: `cute chibi runner mascot, round golden body, small crown on head, big friendly eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}`,
    },
  ],
  props: [
    {
      id: 'neon-tower', name: 'Torre neón', biome: 'neon',
      prompt: `futuristic neon skyscraper tower, dark glass panels, glowing cyan wireframe edges, sci-fi city building, ${ART}`,
    },
    {
      id: 'ice-crystal', name: 'Cristal de hielo', biome: 'ice',
      prompt: `jagged ice crystal cluster, translucent pale blue, sharp faceted shards, frozen game prop, ${ART}`,
    },
  ],
};

/**
 * The full asset batch: a character roster, rich biome props, and — new — the
 * map furniture (traps, moving hazards, walls, tileable floor panels). The 2
 * example characters + 2 example props already exist, so they're not re-listed
 * here (we don't spend credits regenerating them). Statics use the same
 * text-to-3d path as props (no rigging), each into its own public/<dir>.
 */
export const ASSETS = {
  characters: [
    { id: 'runner-toxic', name: 'Tóxico', emoji: '☢️',
      prompt: `cute chibi runner mascot, round toxic-green slime body, single antenna with glowing tip, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-bot', name: 'Voltio', emoji: '🤖',
      prompt: `cute chibi robot runner, boxy navy metal body, glowing visor, clearly separated arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-grape', name: 'Uva', emoji: '👾',
      prompt: `cute chibi runner mascot, round purple body, tiny devil horns, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-angel', name: 'Aura', emoji: '😇',
      prompt: `cute chibi runner mascot, round white body, glowing golden halo above head, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-lava', name: 'Magma', emoji: '🔥',
      prompt: `cute chibi runner mascot, round molten lava-rock body with glowing orange cracks, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
  ],
  props: [
    { id: 'toxic-pipe', name: 'Tubería tóxica', biome: 'toxic',
      prompt: `industrial waste pipe with glowing green valve, rusty metal, sci-fi factory prop, ${ART}` },
    { id: 'toxic-barrel', name: 'Bidón', biome: 'toxic',
      prompt: `leaking toxic waste barrel, green ooze, hazard symbol, rusty metal drum, game prop, ${ART}` },
    { id: 'sunset-ruin', name: 'Ruina', biome: 'sunset',
      prompt: `ancient sandstone ruin pillar, weathered cracked desert temple column, warm tones, ${ART}` },
    { id: 'sunset-cactus', name: 'Cactus', biome: 'sunset',
      prompt: `stylized round desert cactus with pink flower, warm sunset tones, game prop, ${ART}` },
    { id: 'neon-hologram', name: 'Holograma', biome: 'neon',
      prompt: `floating holographic billboard, glowing cyan projection, thin frame, sci-fi city prop, ${ART}` },
    { id: 'neon-arcade', name: 'Arcade', biome: 'neon',
      prompt: `retro neon arcade machine, glowing screen, chunky cabinet, cyan and magenta lights, game prop, ${ART}` },
    { id: 'ice-berg', name: 'Témpano', biome: 'ice',
      prompt: `chunky low-poly iceberg rock, pale blue and white, snow on top, frozen prop, ${ART}` },
    { id: 'ice-tree', name: 'Pino nevado', biome: 'ice',
      prompt: `snow-covered pine tree, frosty low-poly conifer, pale blue and white, winter game prop, ${ART}` },
  ],
  statics: [
    { dir: 'traps', items: [
      { id: 'trap-spike', type: 'spike', name: 'Pinchos',
        prompt: `menacing floor spike trap, cluster of sharp metallic spikes pointing straight up from a round dark base, red danger glow, stylized low-poly game hazard, ${ART}` },
      { id: 'trap-glue', type: 'glue', name: 'Pegamento',
        prompt: `sticky glowing green goo puddle on the ground, flat bubbling slime splat, gooey trap, stylized low-poly game hazard, ${ART}` },
      { id: 'trap-bounce', type: 'bounce', name: 'Muelle',
        prompt: `bouncy spring jump pad, coiled shiny metal spring under a round yellow rubber top, black stripes, stylized low-poly game prop, ${ART}` },
    ] },
    { dir: 'hazards', items: [
      { id: 'hazard-crusher', kind: 'crusher', name: 'Prensa',
        prompt: `heavy industrial crusher piston head, massive blunt metal stamping block with yellow-black warning stripes, menacing, flat bottom, sci-fi factory hazard, stylized low-poly, ${ART}` },
      { id: 'hazard-spinner', kind: 'spinner', name: 'Aspa',
        prompt: `long horizontal spinning hazard bar, straight metal rotor beam with spikes and yellow-black warning stripes, sci-fi, stylized low-poly, ${ART}` },
    ] },
    { dir: 'walls', items: [
      { id: 'wall-block', name: 'Muro',
        prompt: `sci-fi barrier wall block, solid rectangular blocker with glowing cyan edge trim, brushed metal, stylized low-poly game obstacle, ${ART}` },
      { id: 'wall-neon', name: 'Barrera',
        prompt: `futuristic energy barrier, dark metal frame holding a glowing translucent neon force-field panel, rectangular, stylized low-poly game obstacle, ${ART}` },
    ] },
    { dir: 'floors', items: [
      { id: 'floor-panel', name: 'Placa',
        prompt: `seamless tileable sci-fi floor panel, square dark metal plate with glowing cyan seam grooves and rivets, flat top-down surface, stylized low-poly game floor tile, ${ART}` },
      { id: 'floor-grid', name: 'Rejilla',
        prompt: `seamless tileable futuristic floor tile, dark hexagonal grid metal with subtle inner glow, flat square top-down surface, stylized low-poly game floor, ${ART}` },
    ] },
  ],
};

export const FINAL = {
  characters: [
    EXAMPLES.characters[0],
    EXAMPLES.characters[1],
    { id: 'runner-toxic', name: 'Tóxico', emoji: '☢️',
      prompt: `cute chibi runner mascot, round toxic-green slime body, single antenna with glowing tip, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-bot', name: 'Voltio', emoji: '🤖',
      prompt: `cute chibi robot runner, boxy navy metal body, glowing visor, clearly separated arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-grape', name: 'Uva', emoji: '👾',
      prompt: `cute chibi runner mascot, round purple body, tiny devil horns, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
    { id: 'runner-angel', name: 'Aura', emoji: '😇',
      prompt: `cute chibi runner mascot, round white body, glowing halo above head, big eyes, clearly separated short arms and legs, standing upright, A-pose, ${ART}` },
  ],
  props: [
    EXAMPLES.props[0], EXAMPLES.props[1],
    { id: 'toxic-pipe', name: 'Tubería tóxica', biome: 'toxic',
      prompt: `industrial waste pipe with glowing green valve, rusty metal, sci-fi factory prop, ${ART}` },
    { id: 'sunset-ruin', name: 'Ruina', biome: 'sunset',
      prompt: `ancient sandstone ruin pillar, weathered, cracked, desert temple column, warm tones, ${ART}` },
    { id: 'neon-hologram', name: 'Holograma', biome: 'neon',
      prompt: `floating holographic billboard, glowing cyan projection, thin frame, sci-fi city prop, ${ART}` },
    { id: 'ice-berg', name: 'Témpano', biome: 'ice',
      prompt: `chunky low-poly iceberg rock, pale blue and white, snow on top, frozen prop, ${ART}` },
  ],
};
