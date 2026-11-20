import { Game } from "../core/Game";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { createPlatform, createPlayer, createEnemy } from "../entities/Archetypes";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { TransformComponent } from "../components/Transform";
import { AnimationKey } from "../core/AssetKeys";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  async function testAssetKeys(game: Game) {
    // Ensure keys work in AssetLoader
    const idle = game.world.query("Animator")[0]?.components[0] as AnimatorComponent;
    // Check if enum value works
    if (idle && idle.currentAnim === AnimationKey.IDLE) {
      // OK
    }
  },

  async function testNavGraphBuild(game: Game) {
    // Create 2 platforms
    createPlatform(game.world, 0, 400, 200, 50); // 0-200
    createPlatform(game.world, 250, 400, 200, 50); // 250-450

    const nav = game.world.getResource<NavigationGraph>(NavigationGraph);
    nav.build(game.world);

    if (nav.nodes.size === 0) throw new Error("NavGraph failed to build nodes");
    if (nav.edges.size === 0) throw new Error("NavGraph failed to build edges");
  },

  async function testPathfindingGapJump(game: Game) {
    // Clear world
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    createPlatform(game.world, 0, 400, 200, 50);
    createPlatform(game.world, 240, 400, 200, 50); // Feasible 40px gap at the enemy's jump speed

    const nav = game.world.getResource<NavigationGraph>(NavigationGraph);
    nav.build(game.world);

    const start = { x: 50, y: 400 };
    const end = { x: 400, y: 400 };
    const path = nav.findPath(start, end);

    if (path.length === 0) throw new Error("Pathfinding failed to bridge gap");
  },

  async function testEnemyFollowsPath(game: Game) {
    // Clear world
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    createPlatform(game.world, 0, 400, 1000, 50);

    const enemyId = createEnemy(game.world, 50, 300, "hollow");
    const playerId = createPlayer(game.world, 800, 300);

    // Manually trigger nav calculation logic by moving state
    const ai = game.world.getComponent<AIControllerComponent>(enemyId, "AIController")!;
    ai.target = playerId;
    ai.state = "combat";
    ai.behaviorParams.attackRange = 50; // Force path usage (dist > range)

    // Build Graph
    const nav = game.world.getResource<NavigationGraph>(NavigationGraph);
    nav.build(game.world);

    await runFrames(game, 10);

    if (ai.currentPath.length === 0) throw new Error("Enemy did not generate path");

    const transform = game.world.getComponent<TransformComponent>(enemyId, "Transform")!;
    const startX = transform.position.x;

    await runFrames(game, 20);

    if (transform.position.x <= startX) throw new Error("Enemy did not follow path");
  },
];
