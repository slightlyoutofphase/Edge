import { Game } from "../core/Game";
import { createEnemy } from "../entities/Archetypes";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { AssetLoader } from "../assets/AssetLoader";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function setupEnemy(game: Game, type: "hollow" | "soldier" | "duelist" | "brute" | "boss") {
  // Clear world
  const all = game.world.getAllEntities();
  for (const id of all) game.world.destroyEntity(id);

  const enemyId = createEnemy(game.world, 0, 0, type);
  const animator = game.world.getComponent<AnimatorComponent>(enemyId, "Animator")!;
  const physics = game.world.getComponent<PhysicsComponent>(enemyId, "Physics")!;
  const movement = game.world.getComponent<MovementStateComponent>(enemyId, "MovementState")!;

  // Force walk state via velocity
  physics.velocity.x = 50;
  physics.grounded = true;

  return { enemyId, animator, movement };
}

export const tests = [
  async function testHollowWalkSelection(game: Game) {
    const { animator } = setupEnemy(game, "hollow");
    await runFrames(game, 1);
    if (animator.currentAnim !== "hollow_walk")
      throw new Error(`Hollow should use hollow_walk, got ${animator.currentAnim}`);
  },

  async function testSoldierWalkSelection(game: Game) {
    const { animator } = setupEnemy(game, "soldier");
    await runFrames(game, 1);
    if (animator.currentAnim !== "soldier_walk")
      throw new Error(`Soldier should use soldier_walk, got ${animator.currentAnim}`);
  },

  async function testDuelistWalkSelection(game: Game) {
    const { animator } = setupEnemy(game, "duelist");
    await runFrames(game, 1);
    if (animator.currentAnim !== "duelist_walk")
      throw new Error(`Duelist should use duelist_walk, got ${animator.currentAnim}`);
  },

  async function testBruteWalkSelection(game: Game) {
    const { animator } = setupEnemy(game, "brute");
    await runFrames(game, 1);
    if (animator.currentAnim !== "brute_walk")
      throw new Error(`Brute should use brute_walk, got ${animator.currentAnim}`);
  },

  async function testBossWalkSelection(game: Game) {
    const { animator } = setupEnemy(game, "boss");
    await runFrames(game, 1);
    if (animator.currentAnim !== "boss_walk")
      throw new Error(`Boss should use boss_walk, got ${animator.currentAnim}`);
  },

  async function testAssetLoadVerification(_game: Game) {
    const keys = ["hollow_walk", "soldier_walk", "duelist_walk", "brute_walk", "boss_walk"];
    for (const k of keys) {
      if (!AssetLoader.getAnimation(k)) throw new Error(`Animation asset ${k} not found in loader`);
    }
  },
];
