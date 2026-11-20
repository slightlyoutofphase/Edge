export interface WeaponDef {
  id: string;
  name: string;

  // Stats
  baseDamage: number;
  staminaCostLight: number;
  staminaCostHeavy: number;
  poiseDamageLight: number;
  poiseDamageHeavy: number;
  blockStability: number;

  // Timing (frames at 60fps)
  lightAttack: {
    anticipation: number;
    active: number;
    recovery: number;
  };
  heavyAttack: {
    anticipation: number;
    active: number;
    recovery: number;
  };

  // Hitbox
  reach: number; // Pixels from hand
  arcWidth: number; // Degrees of swing arc

  // Visual
  gripOffset: { x: number; y: number }; // Offset in weapon-grip bone
  svgAsset: string; // Reference to SVG asset ID
}

export const WEAPONS: Record<string, WeaponDef> = {
  longsword: {
    id: "longsword",
    name: "Longsword",
    baseDamage: 20,
    staminaCostLight: 15,
    staminaCostHeavy: 30,
    poiseDamageLight: 20,
    poiseDamageHeavy: 50,
    blockStability: 50,
    lightAttack: { anticipation: 8, active: 4, recovery: 12 },
    heavyAttack: { anticipation: 18, active: 6, recovery: 20 },
    // Reduced from 40 to 28
    reach: 28,
    arcWidth: 90,
    gripOffset: { x: 0, y: 0 },
    svgAsset: "weapon-longsword",
  },
  rapier: {
    id: "rapier",
    name: "Rapier",
    baseDamage: 15,
    staminaCostLight: 10,
    staminaCostHeavy: 22,
    poiseDamageLight: 10,
    poiseDamageHeavy: 25,
    blockStability: 30,
    lightAttack: { anticipation: 5, active: 3, recovery: 8 },
    heavyAttack: { anticipation: 12, active: 4, recovery: 14 },
    // Reduced from 50 to 35
    reach: 35,
    arcWidth: 30,
    gripOffset: { x: 0, y: -2 },
    svgAsset: "weapon-rapier",
  },
  greatsword: {
    id: "greatsword",
    name: "Greatsword",
    baseDamage: 35,
    staminaCostLight: 22,
    staminaCostHeavy: 45,
    poiseDamageLight: 35,
    poiseDamageHeavy: 80,
    blockStability: 70,
    lightAttack: { anticipation: 14, active: 6, recovery: 18 },
    heavyAttack: { anticipation: 26, active: 8, recovery: 28 },
    // Reduced from 55 to 40
    reach: 40,
    arcWidth: 120,
    gripOffset: { x: 0, y: 2 },
    svgAsset: "weapon-greatsword",
  },
  dagger: {
    id: "dagger",
    name: "Dagger",
    baseDamage: 10,
    staminaCostLight: 8,
    staminaCostHeavy: 16,
    poiseDamageLight: 5,
    poiseDamageHeavy: 15,
    blockStability: 15,
    lightAttack: { anticipation: 4, active: 2, recovery: 6 },
    heavyAttack: { anticipation: 8, active: 3, recovery: 10 },
    reach: 20,
    arcWidth: 60,
    gripOffset: { x: 0, y: -1 },
    svgAsset: "weapon-dagger",
  },
};

export const DEFAULT_WEAPONS: Readonly<Record<string, WeaponDef>> = structuredClone(WEAPONS);

export function resetWeapons() {
  for (const key of Object.keys(WEAPONS)) {
    if (!Object.hasOwn(DEFAULT_WEAPONS, key)) delete WEAPONS[key];
  }
  for (const [key, baseline] of Object.entries(DEFAULT_WEAPONS)) {
    WEAPONS[key] = structuredClone(baseline);
  }
}
