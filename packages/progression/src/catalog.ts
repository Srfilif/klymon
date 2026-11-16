import { z } from 'zod';

export const COSMETIC_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type CosmeticRarity = (typeof COSMETIC_RARITIES)[number];

export const RARITY_POINTS: Record<CosmeticRarity, number> = {
  common: 150,
  uncommon: 400,
  rare: 900,
  epic: 1800,
  legendary: 3500,
};

export const RARITY_COLORS: Record<CosmeticRarity, string> = {
  common: '#9aa4b2',
  uncommon: '#3ddc84',
  rare: '#3b9ff0',
  epic: '#b15df0',
  legendary: '#f5a623',
};

/** Equipment slots. One item equipped per slot (plus any number of profile flair). */
export const COSMETIC_SLOTS = [
  'cape',
  'wings',
  'hat',
  'particles',
  'aura',
  'trail',
  'pet',
  'emote',
  'entrance',
  'profile',
] as const;
export type CosmeticSlot = (typeof COSMETIC_SLOTS)[number];

/**
 * How the item is rendered in game. `procedural` items need no art assets:
 * the mod draws them from `colors`/`particle`/`shape` at runtime.
 */
export const zCosmeticVisual = z
  .object({
    kind: z.enum(['procedural', 'texture']),
    /** Hex colors used by the procedural renderer (cape cloth, wings, hat…). */
    colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(4).default([]),
    /** Vanilla particle id used for particles/trail/aura/entrance effects. */
    particle: z.string().max(64).optional(),
    /** Shape hint for the procedural renderer. */
    shape: z.string().max(32).optional(),
    /** Vanilla item/block id used as the visual base (hats, pets). */
    baseItem: z.string().max(64).optional(),
  })
  .strict();

export type CosmeticVisual = z.infer<typeof zCosmeticVisual>;

export const zCosmeticItem = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{3,48}$/),
    slot: z.enum(COSMETIC_SLOTS),
    rarity: z.enum(COSMETIC_RARITIES),
    name: z.object({ es: z.string().min(1).max(60), en: z.string().min(1).max(60) }).strict(),
    description: z.object({ es: z.string().min(1).max(220), en: z.string().min(1).max(220) }).strict(),
    /** Price in Klymon points. 0 = free. */
    price: z.number().int().min(0).max(100000),
    /** Minimum player level required to buy/equip. */
    minLevel: z.number().int().min(1).max(999).default(1),
    /**
     * When set, the item cannot be bought: it is granted by completing
     * the referenced quest/achievement id.
     */
    questUnlock: z.string().max(64).optional(),
    visual: zCosmeticVisual,
    /** Catalog version this item shipped in (for "new" badges). */
    addedIn: z.string().max(16).default('1.0'),
  })
  .strict();

export type CosmeticItem = z.infer<typeof zCosmeticItem>;

function item(raw: z.input<typeof zCosmeticItem>): CosmeticItem {
  return zCosmeticItem.parse(raw);
}

/**
 * The starter catalog. To extend it, add entries here (ids must stay stable:
 * the inventory stores ids, and future servers will resolve the same ids).
 */
export const COSMETIC_CATALOG: CosmeticItem[] = [
  item({
    id: 'cape-klymon-ember',
    slot: 'cape',
    rarity: 'common',
    name: { es: 'Capa Ascuas de Klymon', en: 'Klymon Ember Cape' },
    description: {
      es: 'La capa fundacional de Klymon: degradado klymon sobre negro carbón.',
      en: 'The founding Klymon cape: klymon gradient over carbon black.',
    },
    price: 0,
    visual: { kind: 'procedural', colors: ['#22d3ee', '#0e7490'], shape: 'cape' },
  }),
  item({
    id: 'cape-midnight-teal',
    slot: 'cape',
    rarity: 'uncommon',
    name: { es: 'Capa Medianoche Turquesa', en: 'Midnight Teal Cape' },
    description: {
      es: 'Turquesa profundo con borde luminoso. Elegante en cualquier bioma.',
      en: 'Deep teal with a glowing edge. Elegant in any biome.',
    },
    price: 400,
    visual: { kind: 'procedural', colors: ['#14b8a6', '#0f172a'], shape: 'cape' },
  }),
  item({
    id: 'cape-solar-flare',
    slot: 'cape',
    rarity: 'rare',
    name: { es: 'Capa Llamarada Solar', en: 'Solar Flare Cape' },
    description: {
      es: 'Naranja y oro fundidos. Para quienes juegan de día… y de noche.',
      en: 'Molten orange and gold. For those who play by day… and by night.',
    },
    price: 900,
    visual: { kind: 'procedural', colors: ['#fb923c', '#b45309'], shape: 'cape' },
  }),
  item({
    id: 'cape-void-tide',
    slot: 'cape',
    rarity: 'epic',
    name: { es: 'Capa Marea del Vacío', en: 'Void Tide Cape' },
    description: {
      es: 'Violeta abisal con brillo klymon. Requiere nivel 8.',
      en: 'Abyssal violet with klymon shimmer. Requires level 8.',
    },
    price: 1800,
    minLevel: 8,
    visual: { kind: 'procedural', colors: ['#7c3aed', '#06b6d4'], shape: 'cape' },
  }),
  item({
    id: 'cape-founder-aurora',
    slot: 'cape',
    rarity: 'legendary',
    name: { es: 'Capa Aurora del Fundador', en: "Founder's Aurora Cape" },
    description: {
      es: 'Solo para pioneros: completa el logro «Pionero Klymon».',
      en: 'For pioneers only: complete the “Klymon Pioneer” achievement.',
    },
    price: 0,
    questUnlock: 'ach-pioneer',
    visual: { kind: 'procedural', colors: ['#22d3ee', '#a78bfa', '#f0abfc'], shape: 'cape' },
  }),
  item({
    id: 'wings-frost-shard',
    slot: 'wings',
    rarity: 'rare',
    name: { es: 'Alas Fragmento Glacial', en: 'Frost Shard Wings' },
    description: {
      es: 'Alas cristalinas de hielo klymon que se despliegan al planear.',
      en: 'Crystalline klymon-ice wings that unfold while gliding.',
    },
    price: 1200,
    visual: { kind: 'procedural', colors: ['#a5f3fc', '#0ea5e9'], shape: 'wings' },
  }),
  item({
    id: 'wings-ember-drake',
    slot: 'wings',
    rarity: 'epic',
    name: { es: 'Alas Draco Ígneo', en: 'Ember Drake Wings' },
    description: {
      es: 'Membranas de dragón con brasas. Requiere nivel 10.',
      en: 'Dragon membranes with embers. Requires level 10.',
    },
    price: 2200,
    minLevel: 10,
    visual: { kind: 'procedural', colors: ['#ef4444', '#f59e0b'], shape: 'wings' },
  }),
  item({
    id: 'wings-void-collector',
    slot: 'wings',
    rarity: 'legendary',
    name: { es: 'Alas Coleccionista del Vacío', en: 'Void Collector Wings' },
    description: {
      es: 'Desbloqueado al reunir 15 cosméticos.',
      en: 'Unlocked by collecting 15 cosmetics.',
    },
    price: 0,
    questUnlock: 'ach-collector-15',
    visual: { kind: 'procedural', colors: ['#8b5cf6', '#111827'], shape: 'wings' },
  }),
  item({
    id: 'hat-miner-lantern',
    slot: 'hat',
    rarity: 'common',
    name: { es: 'Lámpara de Minero', en: "Miner's Lantern" },
    description: {
      es: 'Un farolillo cálido sobre la cabeza. Gratis para empezar.',
      en: 'A warm little lantern on your head. Free to start.',
    },
    price: 0,
    visual: { kind: 'procedural', colors: ['#fbbf24'], shape: 'lantern', baseItem: 'minecraft:lantern' },
  }),
  item({
    id: 'hat-frog-beanie',
    slot: 'hat',
    rarity: 'uncommon',
    name: { es: 'Gorro Rana', en: 'Frog Beanie' },
    description: {
      es: 'Verde, suave y con ojitos. Croac.',
      en: 'Green, soft and googly-eyed. Ribbit.',
    },
    price: 350,
    visual: { kind: 'procedural', colors: ['#4ade80', '#f8fafc'], shape: 'beanie' },
  }),
  item({
    id: 'hat-golden-crown',
    slot: 'hat',
    rarity: 'epic',
    name: { es: 'Corona Dorada', en: 'Golden Crown' },
    description: {
      es: 'Para cabezas que ya alcanzaron el nivel 12.',
      en: 'For heads that already reached level 12.',
    },
    price: 2000,
    minLevel: 12,
    visual: { kind: 'procedural', colors: ['#facc15', '#ef4444'], shape: 'crown', baseItem: 'minecraft:golden_helmet' },
  }),
  item({
    id: 'particles-klymon-sparks',
    slot: 'particles',
    rarity: 'common',
    name: { es: 'Chispas Klymon', en: 'Klymon Sparks' },
    description: {
      es: 'Pequeñas chispas klymon orbitando a tu alrededor.',
      en: 'Small klymon sparks orbiting around you.',
    },
    price: 150,
    visual: { kind: 'procedural', particle: 'minecraft:electric_spark' },
  }),
  item({
    id: 'particles-soul-flames',
    slot: 'particles',
    rarity: 'rare',
    name: { es: 'Llamas de Alma', en: 'Soul Flames' },
    description: {
      es: 'Fuego azulado de las profundidades.',
      en: 'Bluish fire from the depths.',
    },
    price: 950,
    visual: { kind: 'procedural', particle: 'minecraft:soul_fire_flame' },
  }),
  item({
    id: 'particles-dragon-breath',
    slot: 'particles',
    rarity: 'legendary',
    name: { es: 'Aliento de Dragón', en: "Dragon's Breath" },
    description: {
      es: 'El aliento del End. Requiere nivel 15.',
      en: "The breath of the End. Requires level 15.",
    },
    price: 3500,
    minLevel: 15,
    visual: { kind: 'procedural', particle: 'minecraft:dragon_breath' },
  }),
  item({
    id: 'aura-teal-ring',
    slot: 'aura',
    rarity: 'uncommon',
    name: { es: 'Anillo Turquesa', en: 'Teal Ring' },
    description: {
      es: 'Un anillo de luz klymon bajo tus pies.',
      en: 'A ring of klymon light under your feet.',
    },
    price: 500,
    visual: { kind: 'procedural', colors: ['#22d3ee'], particle: 'minecraft:glow' },
  }),
  item({
    id: 'aura-warden-pulse',
    slot: 'aura',
    rarity: 'epic',
    name: { es: 'Pulso del Warden', en: 'Warden Pulse' },
    description: {
      es: 'Oscuridad sculk pulsante. Impone respeto.',
      en: 'Pulsing sculk darkness. Commands respect.',
    },
    price: 1900,
    minLevel: 9,
    visual: { kind: 'procedural', colors: ['#0d9488', '#111827'], particle: 'minecraft:sculk_soul' },
  }),
  item({
    id: 'trail-bubble-stream',
    slot: 'trail',
    rarity: 'common',
    name: { es: 'Estela de Burbujas', en: 'Bubble Stream' },
    description: {
      es: 'Deja burbujas al caminar. Gratis para empezar.',
      en: 'Leave bubbles as you walk. Free to start.',
    },
    price: 0,
    visual: { kind: 'procedural', particle: 'minecraft:bubble' },
  }),
  item({
    id: 'trail-note-melody',
    slot: 'trail',
    rarity: 'uncommon',
    name: { es: 'Melodía Andante', en: 'Walking Melody' },
    description: {
      es: 'Notas musicales flotando tras cada paso.',
      en: 'Musical notes floating behind every step.',
    },
    price: 450,
    visual: { kind: 'procedural', particle: 'minecraft:note' },
  }),
  item({
    id: 'trail-end-rod',
    slot: 'trail',
    rarity: 'rare',
    name: { es: 'Estela del End', en: 'End Trail' },
    description: {
      es: 'Destellos blancos del End tras tus movimientos.',
      en: 'White End sparkles behind your moves.',
    },
    price: 1000,
    visual: { kind: 'procedural', particle: 'minecraft:end_rod' },
  }),
  item({
    id: 'pet-baby-slime',
    slot: 'pet',
    rarity: 'uncommon',
    name: { es: 'Mini Slime', en: 'Baby Slime' },
    description: {
      es: 'Un slime diminuto que salta a tu lado.',
      en: 'A tiny slime bouncing by your side.',
    },
    price: 600,
    visual: { kind: 'procedural', baseItem: 'minecraft:slime_ball', shape: 'companion' },
  }),
  item({
    id: 'pet-allay-wisp',
    slot: 'pet',
    rarity: 'epic',
    name: { es: 'Fuego Fatuo Allay', en: 'Allay Wisp' },
    description: {
      es: 'Un destello azulado que te acompaña. Requiere nivel 11.',
      en: 'A bluish glimmer following you. Requires level 11.',
    },
    price: 2100,
    minLevel: 11,
    visual: { kind: 'procedural', particle: 'minecraft:glow', baseItem: 'minecraft:amethyst_shard', shape: 'companion' },
  }),
  item({
    id: 'emote-wave',
    slot: 'emote',
    rarity: 'common',
    name: { es: 'Saludo', en: 'Wave' },
    description: {
      es: 'Saluda con la mano. Gratis para empezar.',
      en: 'Wave hello. Free to start.',
    },
    price: 0,
    visual: { kind: 'procedural', shape: 'wave' },
  }),
  item({
    id: 'emote-dance-party',
    slot: 'emote',
    rarity: 'rare',
    name: { es: 'Baile Festivo', en: 'Party Dance' },
    description: {
      es: 'Un baile corto con notas musicales.',
      en: 'A short dance with musical notes.',
    },
    price: 1100,
    visual: { kind: 'procedural', shape: 'dance', particle: 'minecraft:note' },
  }),
  item({
    id: 'entrance-klymon-burst',
    slot: 'entrance',
    rarity: 'uncommon',
    name: { es: 'Aparición Klymon', en: 'Klymon Burst' },
    description: {
      es: 'Explosión de chispas klymon al entrar en un mundo.',
      en: 'A burst of klymon sparks when entering a world.',
    },
    price: 550,
    visual: { kind: 'procedural', particle: 'minecraft:firework' },
  }),
  item({
    id: 'entrance-totem-flash',
    slot: 'entrance',
    rarity: 'legendary',
    name: { es: 'Destello de Tótem', en: 'Totem Flash' },
    description: {
      es: 'El legendario destello verde del tótem al aparecer.',
      en: 'The legendary green totem flash on arrival.',
    },
    price: 3200,
    minLevel: 14,
    visual: { kind: 'procedural', particle: 'minecraft:totem_of_undying' },
  }),
  item({
    id: 'profile-klymon-badge',
    slot: 'profile',
    rarity: 'common',
    name: { es: 'Insignia Klymon', en: 'Klymon Badge' },
    description: {
      es: 'Marco klymon para tu perfil. Gratis para empezar.',
      en: 'A klymon frame for your profile. Free to start.',
    },
    price: 0,
    visual: { kind: 'procedural', colors: ['#22d3ee'], shape: 'frame' },
  }),
  item({
    id: 'profile-gilded-frame',
    slot: 'profile',
    rarity: 'epic',
    name: { es: 'Marco Dorado', en: 'Gilded Frame' },
    description: {
      es: 'Marco dorado animado para tu perfil del launcher.',
      en: 'Animated golden frame for your launcher profile.',
    },
    price: 1600,
    visual: { kind: 'procedural', colors: ['#facc15'], shape: 'frame' },
  }),
  item({
    id: 'profile-pioneer-banner',
    slot: 'profile',
    rarity: 'legendary',
    name: { es: 'Estandarte Pionero', en: 'Pioneer Banner' },
    description: {
      es: 'Solo para pioneros: completa el logro «Pionero Klymon».',
      en: 'For pioneers only: complete the “Klymon Pioneer” achievement.',
    },
    price: 0,
    questUnlock: 'ach-pioneer',
    visual: { kind: 'procedural', colors: ['#a78bfa', '#22d3ee'], shape: 'banner' },
  }),
];

const BY_ID = new Map(COSMETIC_CATALOG.map((entry) => [entry.id, entry]));

export function cosmeticById(id: string): CosmeticItem | null {
  return BY_ID.get(id) ?? null;
}

export function cosmeticsBySlot(slot: CosmeticSlot): CosmeticItem[] {
  return COSMETIC_CATALOG.filter((entry) => entry.slot === slot);
}

/** Validates that every catalog id is unique and every quest unlock id exists. */
export function validateCatalog(questIds: Set<string>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of COSMETIC_CATALOG) {
    if (seen.has(entry.id)) errors.push(`duplicate cosmetic id: ${entry.id}`);
    seen.add(entry.id);
    if (entry.questUnlock && !questIds.has(entry.questUnlock)) {
      errors.push(`cosmetic ${entry.id} unlocks from unknown quest ${entry.questUnlock}`);
    }
  }
  return errors;
}
