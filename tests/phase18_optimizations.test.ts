import { Game } from "../core/Game";
import { createPlatform, createPlayer, createEnemy } from "../entities/Archetypes";

import { CollisionSystem } from "../systems/CollisionSystem";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";

import { BattleState, SpatialGridState } from "../core/Resources";
import { HealthComponent } from "../components/Health";
import { FactionComponent } from "../components/Faction";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  // 1. Static Grid Optimization Test
  async function testStaticGridOptimization(game: Game) {
    // Clear world
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    // Create platforms
    createPlatform(game.world, 0, 400, 1000, 50);

    // Force reset to build static grid
    const colSys = game.systems.find((s) => s instanceof CollisionSystem) as any;
    if (!colSys) throw new Error("CollisionSystem missing");

    const grids = game.world.getResource<SpatialGridState>(SpatialGridState);

    // Mock staticGrid insert to verify it's called
    const spyInsert = { count: 0 };
    const originalInsert = grids.staticGrid.insert.bind(grids.staticGrid);
    grids.staticGrid.insert = (id: any, rect: any) => {
      spyInsert.count++;
      originalInsert(id, rect);
    };

    // Reset calls needsStaticRebuild = true
    colSys.reset();

    // First update should build grid
    await runFrames(game, 1);

    if (spyInsert.count === 0) throw new Error("Static grid not populated on first frame");

    const countAfterFirst = spyInsert.count;

    // Second update should NOT rebuild grid
    await runFrames(game, 1);

    if (spyInsert.count > countAfterFirst) throw new Error("Static grid rebuilt unnecessarily");
  },

  // 2. Matrix Reuse Test
  async function testMatrixReuse(game: Game) {
    const player = createPlayer(game.world, 0, 0);
    const skeleton = game.world.getComponent<SkeletonComponent>(player, "Skeleton")!;

    await runFrames(game, 1);

    const matrix1 = skeleton.worldTransforms.get("head");
    if (!matrix1) throw new Error("Head matrix missing");

    // Store reference
    const ref1 = matrix1;

    await runFrames(game, 1);

    const matrix2 = skeleton.worldTransforms.get("head");

    // Should be same object instance
    if (ref1 !== matrix2) throw new Error("Matrix object recreated (not reused)");
  },

  // 3. Battle Logic Decoupling Test
  async function testBattleLogicDecoupling(game: Game) {
    const battle = game.world.getResource<BattleState>(BattleState);
    battle.isActive = true;
    battle.winner = null;

    // Create Red Team (3)
    const red = createEnemy(game.world, 0, 0, "hollow");
    const facRed = game.world.getComponent<FactionComponent>(red, "Faction")!;
    facRed.team = 3;

    // Create Blue Team (4)
    const blue = createEnemy(game.world, 100, 0, "hollow");
    const facBlue = game.world.getComponent<FactionComponent>(blue, "Faction")!;
    facBlue.team = 4;

    // Run frames to let GameModeSystem check
    // Check runs every 30 frames. Run 40.
    await runFrames(game, 40);

    if (battle.winner) throw new Error(`Winner decided prematurely: ${battle.winner}`);

    // Kill Red
    const healthRed = game.world.getComponent<HealthComponent>(red, "Health")!;
    healthRed.isDead = true;

    // Run frames
    await runFrames(game, 40);

    if (battle.winner !== "BLUE TEAM")
      throw new Error(`Battle logic failed. Winner: ${battle.winner}`);
  },
];
