import { Game } from "../core/Game";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { CombatComponent } from "../features/combat/CombatComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  async function testRogueWalkSelection(game: Game) {
    // Clear world
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    const enemyId = createEnemy(game.world, 0, 0, "rogue");
    const animator = game.world.getComponent<AnimatorComponent>(enemyId, "Animator")!;
    const physics = game.world.getComponent<PhysicsComponent>(enemyId, "Physics")!;

    // Force walk state via velocity
    physics.velocity.x = 50;
    physics.grounded = true;

    await runFrames(game, 1);
    if (animator.currentAnim !== "rogue_walk")
      throw new Error(`Rogue should use rogue_walk, got ${animator.currentAnim}`);
  },

  async function testRogueFastMovement(game: Game) {
    // Setup floor
    createPlatform(game.world, -100, 400, 2000, 50, "solid");
    const player = createPlayer(game.world, 0, 350);
    const rogue = createEnemy(game.world, 200, 350, "rogue");
    const ai = game.world.getComponent<AIControllerComponent>(rogue, "AIController")!;
    const phys = game.world.getComponent<PhysicsComponent>(rogue, "Physics")!;

    ai.target = player;
    ai.state = "combat";
    phys.grounded = true;

    // Run frames to let AI accelerate
    await runFrames(game, 10);

    // Run speed for rogue is runSpeed * 1.1 (from strategy)
    // Check if velocity is high
    if (Math.abs(phys.velocity.x) < 200)
      throw new Error(`Rogue movement not fast enough. Vel: ${phys.velocity.x}`);
  },

  async function testRogueReactiveRoll(game: Game) {
    // Setup floor
    createPlatform(game.world, -500, 400, 2000, 50, "solid");

    const player = createPlayer(game.world, 0, 400);
    const pCombat = game.world.getComponent<CombatComponent>(player, "Combat")!;
    const pTrans = game.world.getComponent<TransformComponent>(player, "Transform")!;

    const rogue = createEnemy(game.world, 30, 400, "rogue"); // Very close
    const rAi = game.world.getComponent<AIControllerComponent>(rogue, "AIController")!;
    const rMovement = game.world.getComponent<MovementStateComponent>(rogue, "MovementState")!;
    const rTrans = game.world.getComponent<TransformComponent>(rogue, "Transform")!;
    const rPhys = game.world.getComponent<PhysicsComponent>(rogue, "Physics")!;

    rAi.target = player;
    rAi.state = "combat";
    rAi.dodgeCooldownTimer = 0;
    rPhys.grounded = true;

    // Player winds up
    pTrans.facing = 1;
    pCombat.attackState = "windup";
    pCombat.attackTimer = 250; // Leave time to observe before the evasion window.

    // Force RNG to trigger roll
    const originalRandom = Math.random;
    Math.random = () => 0.1; // < 0.6 triggers roll

    try {
      await runFrames(game, 7);
    } finally {
      Math.random = originalRandom;
    }

    if (rMovement.current !== "roll")
      throw new Error(`Rogue did not roll from windup. State: ${rMovement.current}`);

    // Face target (1) so roll moves backwards (-X)
    if (rTrans.facing !== 1)
      throw new Error(`Rogue facing wrong way for backward roll. Facing: ${rTrans.facing}`);
  },

  async function testRogueAttackSelection(game: Game) {
    // Simple verification that rogue strategy can initiate its specific attacks
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    createPlatform(game.world, -500, 0, 2000, 50, "solid");
    const player = createPlayer(game.world, 0, 0);
    const rogue = createEnemy(game.world, 10, 0, "rogue");
    const ai = game.world.getComponent<AIControllerComponent>(rogue, "AIController")!;
    const animator = game.world.getComponent<AnimatorComponent>(rogue, "Animator")!;

    ai.target = player;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;
    ai.hasAttackToken = true;

    await runFrames(game, 8);

    if (!animator.currentAnim.includes("rogue_light_attack")) {
      throw new Error(
        `Rogue failed to initiate rogue-specific attack. Current: ${animator.currentAnim}`,
      );
    }
  },
];
