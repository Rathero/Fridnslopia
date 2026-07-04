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
