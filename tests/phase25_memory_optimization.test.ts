import { Game } from "../core/Game";
import { SpatialHashGrid } from "../utils/SpatialHashGrid";
import { createPlayer } from "../entities/Archetypes";

import { getOverlap } from "../utils/AABB";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  // 1. SpatialHashGrid Output Buffer
  async function testSpatialHashGridAlloc(_game: Game) {
    const grid = new SpatialHashGrid(100);
    grid.insert(1, { x: 50, y: 50, width: 10, height: 10 });

    const buffer1: number[] = [];
    const result1 = grid.query({ x: 40, y: 40, width: 30, height: 30 }, buffer1);

    if (result1 !== buffer1) throw new Error("SpatialHashGrid did not return the input buffer");
    if (buffer1.length !== 1 || buffer1[0] !== 1)
      throw new Error("SpatialHashGrid query incorrect content");

    // Reuse buffer
    grid.insert(2, { x: 50, y: 50, width: 10, height: 10 });
    const result2 = grid.query({ x: 40, y: 40, width: 30, height: 30 }, buffer1);

    if (result2 !== buffer1) throw new Error("SpatialHashGrid reuse failed ref check");
    if ((buffer1.length as number) !== 2)
      throw new Error("SpatialHashGrid reuse failed content update");
  },

  // 2. CollisionSystem persistent objects
  async function testCollisionSystemRobustness(game: Game) {
    // Ensure the collision system runs without error with the new refactor
    createPlayer(game.world, 0, 0);
    // Force update
    await runFrames(game, 2);
  },

  // 3. AABB.getOverlap allocation check
  async function testAABBOverlapAlloc(_game: Game) {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    const out = { x: 0, y: 0 };

    const res = getOverlap(a, b, out);

    if (res !== out) throw new Error("getOverlap did not return output vector");
    if (out.x !== 5 || out.y !== 5) throw new Error("getOverlap math wrong");
  },
];
