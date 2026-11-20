export interface AIParams {
  health: number;
  poise: number;
  attackPower: number;
  windupFrames: number;
  aggroRange: number;
  attackRange: number;
  attackCooldown: number;
  canFeint: boolean;
  canParry: boolean;
  parryWindowFrames: number;
  parryChance: number;
  hyperArmor: boolean;
  blockChance: number;
  zoneCycling: boolean; // For Soldier
  phaseThresholds?: number[]; // Percentage points (0.0 - 1.0) for phase markers
  flankJumpSpeed?: number;
}

export const ENEMY_STATS: Record<string, AIParams> = {
  hellhound: {
    health: 45,
    poise: 18,
    attackPower: 14,
    windupFrames: 18,
    aggroRange: 250,
    attackRange: 62,
    attackCooldown: 1200,
    canFeint: false,
    canParry: false,
    parryWindowFrames: 0,
    parryChance: 0,
    hyperArmor: false,
    blockChance: 0,
    zoneCycling: false,
    flankJumpSpeed: 360,
  },
  alpha_hellhound: {
    health: 650,
    poise: 180,
    attackPower: 42,
    windupFrames: 35,
    aggroRange: 450,
    attackRange: 175,
    attackCooldown: 1800,
    canFeint: false,
    canParry: false,
    parryWindowFrames: 0,
    parryChance: 0,
    hyperArmor: true,
    blockChance: 0,
    zoneCycling: false,
    phaseThresholds: [0.5],
    flankJumpSpeed: 450,
  },
  hollow: {
    health: 50,
    poise: 20,
    attackPower: 15,
    windupFrames: 30,
    aggroRange: 150,
    // Reduced from 45 to 35 to ensure close range hit
    attackRange: 35,
    attackCooldown: 2000,
    canFeint: false,
    canParry: false,
    parryWindowFrames: 0,
    parryChance: 0,
    hyperArmor: false,
    blockChance: 0.2,
    zoneCycling: false,
  },
  soldier: {
    health: 80,
    poise: 40,
    attackPower: 20,
    windupFrames: 24,
    aggroRange: 180,
    // Reduced from 45 to 40 to prevent whiffing due to animation pullback
    attackRange: 40,
    attackCooldown: 1500,
    canFeint: false,
    canParry: true, // ENABLED for stronger behavior
    parryWindowFrames: 6,
    parryChance: 0.15, // Conservative parry chance
    hyperArmor: false,
    blockChance: 0.8,
    zoneCycling: true,
  },
  duelist: {
    health: 60,
    poise: 30,
    attackPower: 25,
    windupFrames: 18,
    aggroRange: 200,
    // Reduced from 70 to 55
    attackRange: 55,
    attackCooldown: 1000,
    canFeint: true,
    canParry: true,
    parryWindowFrames: 6,
    parryChance: 0.3,
    hyperArmor: false,
    blockChance: 0.5,
    zoneCycling: false,
  },
  brute: {
    health: 150,
    poise: 80,
    attackPower: 40,
    windupFrames: 45,
    aggroRange: 120,
    // Reduced from 80 to 70
    attackRange: 70,
    attackCooldown: 2500,
    canFeint: false,
    canParry: false,
    parryWindowFrames: 0,
    parryChance: 0,
    hyperArmor: true,
    blockChance: 0.1,
    zoneCycling: false,
  },
  rogue: {
    health: 40,
    poise: 15,
    attackPower: 12,
    windupFrames: 10, // Fastest
    aggroRange: 250,
    attackRange: 25, // Shortest
    attackCooldown: 600,
    canFeint: false,
    canParry: false,
    parryWindowFrames: 0,
    parryChance: 0,
    hyperArmor: false,
    blockChance: 0.1,
    zoneCycling: false,
  },
  boss: {
    health: 500,
    poise: 150,
    attackPower: 50,
    windupFrames: 50,
    aggroRange: 400,
    // Reduced from 100 to 80
    attackRange: 80,
    attackCooldown: 1500,
    canFeint: false,
    canParry: false,
    parryWindowFrames: 0,
    parryChance: 0,
    hyperArmor: true,
    blockChance: 0.2,
    zoneCycling: false,
    phaseThresholds: [0.5],
  },
};

export const DEFAULT_ENEMY_STATS: Readonly<Record<string, AIParams>> = structuredClone(ENEMY_STATS);

export function resetEnemyStats() {
  for (const key of Object.keys(ENEMY_STATS)) {
    if (!Object.hasOwn(DEFAULT_ENEMY_STATS, key)) delete ENEMY_STATS[key];
  }
  for (const [key, baseline] of Object.entries(DEFAULT_ENEMY_STATS)) {
    ENEMY_STATS[key] = structuredClone(baseline);
  }
}
