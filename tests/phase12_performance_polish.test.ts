import { Game } from "../core/Game";
import { createPlayer, createEnemy, createTrigger, createPlatform } from "../entities/Archetypes";
import { vecPool, vec2Set } from "../utils/Vec2";
import { SpatialHashGrid } from "../utils/SpatialHashGrid";
import { CameraState } from "../core/Resources";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { HitStopComponent } from "../components/HitStop";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  // === Performance: Vec2 Pool ===
  async function testVec2Pool(_game: Game) {
    const v1 = vecPool.acquire();
    vec2Set(v1, 10, 20);
    vecPool.release(v1);
    const v2 = vecPool.acquire();
    // Should reuse object
    if (v1 !== v2) throw new Error("Vec2 pool did not reuse object");
  },

  // === Performance: Spatial Hash ===
  async function testSpatialHashGrid(_game: Game) {
    const grid = new SpatialHashGrid(100);
    // Add item at 50,50
    grid.insert(1, { x: 50, y: 50, width: 10, height: 10 });
    // Add item at 500,500
    grid.insert(2, { x: 500, y: 500, width: 10, height: 10 });

    const buffer: number[] = [];
    const q1 = grid.query({ x: 40, y: 40, width: 30, height: 30 }, buffer);
    if (!q1.includes(1)) throw new Error("Spatial query missed target");
    if (q1.includes(2)) throw new Error("Spatial query hit distant target");
  },

  // === Game Feel: Per-Entity HitStop ===
  async function testPerEntityHitStop(game: Game) {
    // Clear world first
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    const player = createPlayer(game.world, 0, 0);
    // Remove input so MovementSystem doesn't override velocity to 0
    game.world.removeComponent(player, "PlayerInput");

    game.world.addComponent(player, "HitStop", { frames: 5 } as HitStopComponent);

    const physics = game.world.getComponent<PhysicsComponent>(player, "Physics")!;
    physics.velocity.x = 100;

    // Update 1 frame. HitStop=5 -> 4. Physics skipped.
    await runFrames(game, 1);

    const transform = game.world.getComponent<TransformComponent>(player, "Transform")!;
    if (transform.position.x !== 0) throw new Error("Physics updated during HitStop");

    // Wait for HitStop to clear
    await runFrames(game, 5);

    // Now it should move
    await runFrames(game, 1);
    if (transform.position.x === 0) throw new Error("Physics did not resume after HitStop");
  },

  // === Game Feel: Camera POI ===
  async function testCameraPOI(game: Game) {
    // Clear existing entities (Level 1 defaults and previous tests)
    const all = game.world.getAllEntities();
    for (const id of all) game.world.destroyEntity(id);

    const cam = game.world.getResource<CameraState>(CameraState);
    const playerId = createPlayer(game.world, 0, 0);

    // Add platform to keep player in trigger (PhysicsSystem handles gravity)
    createPlatform(game.world, -100, 0, 200, 50, "solid");

    // Prevent falling out of trigger (gravity) by forcing grounded
    const physics = game.world.getComponent<PhysicsComponent>(playerId, "Physics")!;
    physics.grounded = true;
    physics.velocity.y = 0;
    physics.velocity.x = 0; // Ensure no movement/separation drift

    // Create Boss
    createEnemy(game.world, 1000, 0, "boss");

    // Create Trigger colliding with player
    // Player at 0,0. Hurtbox ~20x64.
    createTrigger(game.world, -50, -50, 100, 100, "boss_start", {
      bounds: { min: { x: -1000, y: -1000 }, max: { x: 2000, y: 1000 } },
    });

    // Setup initial camera
    cam.position = { x: 0, y: 0 };
    cam.targetPosition = { x: 0, y: 0 };

    // Update
    await runFrames(game, 60);

    // Should be roughly between 0 and 1000. Player 0, POI 1000. Blend 0.4 POI.
    // Target ~400.
    // With 60 frames of lerp speed 5.0, it should be very close to 400.
    if (cam.position.x < 100) throw new Error(`Camera did not frame POI. Pos: ${cam.position.x}`);
    if (cam.position.x > 900) throw new Error("Camera snapped too hard to POI");
  },
];
