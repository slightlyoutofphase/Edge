import { Game } from "../core/Game";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { AnimationKey } from "../core/AssetKeys";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { AssetLoader } from "../assets/AssetLoader";
import { CombatComponent } from "../features/combat/CombatComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function setupCombatScenario(game: Game, enemyType: string) {
  // 1. Clear existing entities to prevent interference
  const all = game.world.getAllEntities();
  for (const id of all) game.world.destroyEntity(id);

  // 2. Setup Scenario
  const player = createPlayer(game.world, 0, 0);
  const enemy = createEnemy(game.world, 30, 0, enemyType as any); // 30px distance (in range for most)
  createPlatform(game.world, -100, 0, 500, 50); // Floor

  const ai = game.world.getComponent<AIControllerComponent>(enemy, "AIController")!;
  const combat = game.world.getComponent<CombatComponent>(enemy, "Combat")!;
  const animator = game.world.getComponent<AnimatorComponent>(enemy, "Animator")!;

  // 3. Force readiness
  ai.target = player;
  ai.state = "combat";
  ai.attackCooldownTimer = 0;
  ai.decisionTimer = 0;
  ai.attackDecisionTimer = 0;
  ai.hasAttackToken = true; // Bypass director for test

  // 4. Force grounded physics
  const playerPhysics = game.world.getComponent<any>(player, "Physics");
  if (playerPhysics) playerPhysics.grounded = true;
  const physics = game.world.getComponent<any>(enemy, "Physics")!;
  physics.grounded = true;

  return { enemy, ai, combat, animator };
}

export const tests = [
  // 1. Verify Assets Loaded
  async function testAssetRegistration(_game: Game) {
    const keys = [
      AnimationKey.HOLLOW_ATTACK_LOW,
      AnimationKey.SOLDIER_ATTACK_THRUST,
      AnimationKey.DUELIST_ATTACK_HIGH,
      AnimationKey.BRUTE_ATTACK_SWEEP,
      AnimationKey.BOSS_ATTACK_THRUST,
    ];
    for (const key of keys) {
      if (!AssetLoader.getAnimation(key)) {
        throw new Error(`Animation ${key} not registered in AssetLoader`);
      }
    }
  },

  // 2. Hollow Randomization
  async function testHollowAttackVariation(game: Game) {
    const { animator } = setupCombatScenario(game, "hollow");

    const originalRandom = Math.random;
    try {
      // Force random >= 0.5 -> Zone 3 (Low) logic in HollowStrategy
      Math.random = () => 0.6;

      await runFrames(game, 5); // Allow AI to tick and initiate

      if (animator.currentAnim !== AnimationKey.HOLLOW_ATTACK_LOW) {
        throw new Error(`Expected Hollow Low Attack, got ${animator.currentAnim}`);
      }
    } finally {
      Math.random = originalRandom;
    }
  },

  // 3. Soldier Override Logic
  async function testSoldierThrustOverride(game: Game) {
    const { ai, animator } = setupCombatScenario(game, "soldier");

    const originalRandom = Math.random;
    try {
      // Soldier cycles zones: (index + 1) % 3.
      // We want Zone 2.
      // If current is 0: next is (0+1)%3 = 1. Zone = 1+1 = 2 (Mid).
      ai.currentComboIndex = 0;

      // Force random < 0.5 -> Trigger Thrust override logic
      Math.random = () => 0.1;

      await runFrames(game, 5);

      if (animator.currentAnim !== AnimationKey.SOLDIER_ATTACK_THRUST) {
        throw new Error(`Expected Soldier Thrust, got ${animator.currentAnim}`);
      }
    } finally {
      Math.random = originalRandom;
    }
  },

  // 4. Brute Sweep Logic
  async function testBruteSweepOverride(game: Game) {
    const { animator } = setupCombatScenario(game, "brute");

    const originalRandom = Math.random;
    try {
      // Brute: Random < 0.5 is Mid, >= 0.5 is Low (Sweep)
      Math.random = () => 0.6;

      await runFrames(game, 5);

      if (animator.currentAnim !== AnimationKey.BRUTE_ATTACK_SWEEP) {
        throw new Error(`Expected Brute Sweep, got ${animator.currentAnim}`);
      }
    } finally {
      Math.random = originalRandom;
    }
  },

  // 5. Boss Decision Tree
  async function testBossThrustOverride(game: Game) {
    const { animator, ai } = setupCombatScenario(game, "boss");
    // Exercise the ordinary thrust branch; special selection has its own suite.
    ai.bossSpecialReadyAt = Infinity;

    const originalRandom = Math.random;
    try {
      // Boss Logic:
      // rand < 0.25 -> Zone 1
      // rand < 0.5 -> Zone 3
      // else -> Zone 2 (Mid) -> Check secondary rand < 0.5 for Thrust

      let callCount = 0;
      Math.random = () => {
        callCount++;
        if (callCount === 1) return 0.6; // Call 1: Select Zone 2
        return 0.1; // Call 2: Select Thrust override
      };

      await runFrames(game, 5);

      if (animator.currentAnim !== AnimationKey.BOSS_ATTACK_THRUST) {
        throw new Error(`Expected Boss Thrust, got ${animator.currentAnim}`);
      }
    } finally {
      Math.random = originalRandom;
    }
  },
];
