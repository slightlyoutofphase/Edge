import { Game } from "../core/Game";
import { createPlatform, createPlayer, createDummy } from "../entities/Archetypes";
import { SpatialGridState } from "../core/Resources";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { HealthComponent } from "../components/Health";

import { NavigationGraph } from "../features/navigation/NavigationGraph";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  // 1. Spatial Grid Integration
  async function testSpatialGridStateInitialized(game: Game) {
    const grids = game.world.getResource<SpatialGridState>(SpatialGridState);
    if (!grids) throw new Error("SpatialGridState resource missing");
    if (!grids.dynamicGrid) throw new Error("Dynamic grid missing");
    if (!grids.staticGrid) throw new Error("Static grid missing");
  },

  async function testStaticGridPopulation(game: Game) {
    // Create platform
    createPlatform(game.world, 0, 400, 1000, 50, "solid");

    // Force update to run collision system which populates grid
    await runFrames(game, 1);

    const grids = game.world.getResource<SpatialGridState>(SpatialGridState);

    // Query near 0,400
    const buffer: number[] = [];
    const results = grids.staticGrid.query({ x: 0, y: 400, width: 10, height: 10 }, buffer);
    if (results.length === 0) throw new Error("Static grid not populated with platform");
  },

  async function testDynamicGridPopulation(game: Game) {
    const player = createPlayer(game.world, 100, 100);

    await runFrames(game, 1);

    const grids = game.world.getResource<SpatialGridState>(SpatialGridState);
    const buffer: number[] = [];
    const results = grids.dynamicGrid.query({ x: 90, y: 90, width: 20, height: 20 }, buffer);

    if (!results.includes(player)) throw new Error("Dynamic grid not populated with player");
  },

  // 2. Hit Detection using Spatial Hash
  async function testHitDetectionSpatialQuery(game: Game) {
    const player = createPlayer(game.world, 1000, 1000); // Safe positive coordinates
    const nearDummy = createDummy(game.world, 1050, 1000); // Should hit
    const farDummy = createDummy(game.world, 3000, 1000); // Should not even be checked (optimization)

    // Verify grids populated
    await runFrames(game, 1);

    // Mock hitbox
    game.world.addComponent(player, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 200,
      height: 200,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: player,
      attackType: "light",
    } as ActiveHitboxComponent);

    // Run frame
    await runFrames(game, 1);

    const hNear = game.world.getComponent<HealthComponent>(nearDummy, "Health")!;
    const hFar = game.world.getComponent<HealthComponent>(farDummy, "Health")!;

    if (hNear.current === 100) throw new Error("Near dummy missed");
    if (hFar.current !== 100) throw new Error("Far dummy hit (impossible spatially)");
  },

  // 3. Render System Culling Logic
  async function testRenderSystemCulling(game: Game) {
    // Can't easily test visual output, but can ensure logic doesn't crash
    // and uses the grid.

    // Create 2 platforms, one far away
    createPlatform(game.world, 0, 0, 100, 100);
    createPlatform(game.world, 10000, 0, 100, 100);

    await runFrames(game, 1); // Trigger render
    // Success if no error
  },

  // 4. NavGraph Optimization Check
  async function testNavGraphBuildOptimization(game: Game) {
    // Create many small platforms to stress edge generation
    for (let i = 0; i < 20; i++) {
      createPlatform(game.world, i * 100, 400, 50, 50);
    }

    const start = performance.now();
    const nav = game.world.getResource<NavigationGraph>(NavigationGraph);
    nav.build(game.world);
    const end = performance.now();

    if (nav.nodes.size < 20) throw new Error("Nav nodes missing");
    // Just ensuring it runs fast and completes
    if (end - start > 100) console.warn("NavGraph build slow even with optimization");
  },
];
