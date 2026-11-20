import { Game } from "../core/Game";
import { World } from "../core/World";
import { SpatialHashGrid } from "../utils/SpatialHashGrid";
import { SpriteCache } from "../utils/SpriteCache";
import { PlayerBonePaths } from "../assets/svg/PlayerSVG";

export const tests = [
  // 1. Integer Key Spatial Hash
  async function testIntegerSpatialHash(_game: Game) {
    // Use raw class to verify internal behavior or functional result
    const grid = new SpatialHashGrid(100);

    // Insert item at 50, 50 (Cell 0,0)
    grid.insert(1, { x: 50, y: 50, width: 10, height: 10 });

    // Query same cell
    const out: number[] = [];
    grid.query({ x: 10, y: 10, width: 80, height: 80 }, out);

    if (!out.includes(1)) throw new Error("Integer hash query failed to find item in same cell");

    // Query neighbor cell (Cell 1,0 at 150,50)
    const out2: number[] = [];
    // Insert item at 150, 50
    grid.insert(2, { x: 150, y: 50, width: 10, height: 10 });

    grid.query({ x: 140, y: 40, width: 30, height: 30 }, out2);
    if (!out2.includes(2)) throw new Error("Integer hash query failed neighbor cell");
    if (out2.includes(1)) throw new Error("Integer hash query included distant item");
  },

  // 2. Entity Recycling
  async function testEntityRecycling(_game: Game) {
    const world = new World();
    const id1 = world.createEntity();
    const id2 = world.createEntity();

    if (id2 !== id1 + 1) throw new Error("Initial IDs not sequential");

    world.destroyEntity(id1);

    const id3 = world.createEntity();

    if (id3 !== id1) throw new Error(`Entity ID recycling failed. Expected ${id1}, got ${id3}`);

    const id4 = world.createEntity();
    if (id4 <= id2) throw new Error("Recycled IDs exhausted, should increment new. Got " + id4);
  },

  // 3. WeakMap Sprite Caching
  async function testWeakRefSpriteCache(_game: Game) {
    SpriteCache.clear();

    const refObj = PlayerBonePaths["head"];
    const path = refObj.path;

    // First get - generates
    const s1 = SpriteCache.get(refObj, path, refObj.fill, refObj.stroke, 1);

    if (!s1) throw new Error("Sprite generation failed");

    // Second get with SAME ref - should return same instance
    const s2 = SpriteCache.get(refObj, path, refObj.fill, refObj.stroke, 1);

    if (s1 !== s2) throw new Error("WeakMap cache failed to return same instance");

    // Third get with DIFFERENT ref but SAME props - should check string cache
    const diffRef = { ...refObj };
    const s3 = SpriteCache.get(diffRef, path, refObj.fill, refObj.stroke, 1);

    // Should also be same instance because string cache is secondary fallback layer
    if (s1 !== s3) throw new Error("String fallback cache failed");
  },
];
