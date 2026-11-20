import { Game } from "../core/Game";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  async function testSeparationForce(game: Game) {
    // Create floor
    createPlatform(game.world, 0, 400, 1000, 50, "solid");

    // Spawn two enemies at the EXACT same position
    const e1 = createEnemy(game.world, 200, 350, "hollow");
    const e2 = createEnemy(game.world, 200, 350, "hollow");

    // Force grounded so friction/movement logic runs, but separation should override
    const phys1 = game.world.getComponent<PhysicsComponent>(e1, "Physics")!;
    const phys2 = game.world.getComponent<PhysicsComponent>(e2, "Physics")!;
    phys1.grounded = true;
    phys2.grounded = true;

    // Run simulation for 10 frames (~160ms)
    await runFrames(game, 10);

    const t1 = game.world.getComponent<TransformComponent>(e1, "Transform")!;
    const t2 = game.world.getComponent<TransformComponent>(e2, "Transform")!;

    const dist = Math.abs(t1.position.x - t2.position.x);

    // With 200px/s position push + 300 velocity impulse, they should separate
    // Expect at least > 10px in 160ms (stabilized unclumping)
    if (dist < 10) throw new Error(`Separation too weak. Distance: ${dist}`);
  },

  async function testFlankingTrigger(game: Game) {
    // Setup: Floor
    createPlatform(game.world, -500, 400, 2000, 50, "solid");

    // Grounded actors with a reachable landing beyond the player.
    const player = createPlayer(game.world, 500, 400);

    // Ally blocking the path.
    const ally = createEnemy(game.world, 550, 400, "hollow");

    // Flanker behind the ally, close enough to clear the target and brake.
    const flanker = createEnemy(game.world, 590, 400, "hollow");

    const aiAlly = game.world.getComponent<AIControllerComponent>(ally, "AIController")!;
    const aiFlanker = game.world.getComponent<AIControllerComponent>(flanker, "AIController")!;
    const physFlanker = game.world.getComponent<PhysicsComponent>(flanker, "Physics")!;

    // Set up AI state
    aiAlly.target = player;
    aiAlly.state = "combat";

    aiFlanker.target = player;
    aiFlanker.state = "combat";
    aiFlanker.flankTimer = 0; // Ensure cooldown is ready
    physFlanker.grounded = true; // Must be grounded to jump

    // Run frames to let AI think (deterministic roll to verify flank mechanics)
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      await runFrames(game, 5);
    } finally {
      Math.random = originalRandom;
    }

    // Check if flanking triggered
    if (!aiFlanker.isFlanking) throw new Error("Flanking state not triggered when blocked by ally");
    if (physFlanker.velocity.y >= 0) throw new Error("Flanking jump velocity not applied");
  },

  async function testFlankingMovement(game: Game) {
    // Setup
    createPlatform(game.world, -500, 400, 2000, 50, "solid");
    const player = createPlayer(game.world, 0, 350);
    const flanker = createEnemy(game.world, 150, 200, "hollow"); // In air

    const ai = game.world.getComponent<AIControllerComponent>(flanker, "AIController")!;
    const phys = game.world.getComponent<PhysicsComponent>(flanker, "Physics")!;

    ai.target = player;
    ai.state = "combat";
    ai.isFlanking = true;
    phys.grounded = false;
    phys.velocity.y = -100; // Moving up

    // Run multiple frames to allow acceleration to ramp up velocity
    await runFrames(game, 10);

    // Should be moving LEFT (towards player at 0)
    // Acceleration 1000px/s^2 * 0.16s = ~160px/s change per 10 frames
    if (phys.velocity.x >= 0) throw new Error("Flanker not moving towards target while airborne");
    if (Math.abs(phys.velocity.x) < 50)
      throw new Error(`Flanker movement too slow. Got ${phys.velocity.x}`);
  },

  async function testFlankingCompletion(game: Game) {
    // Create a platform so the enemy can land
    createPlatform(game.world, 0, 400, 1000, 50, "solid");
    const player = createPlayer(game.world, 0, 350); // Need a target

    // Position enemy ON the platform (y=400) so physics detects ground
    const flanker = createEnemy(game.world, 150, 400, "hollow");
    const ai = game.world.getComponent<AIControllerComponent>(flanker, "AIController")!;
    const phys = game.world.getComponent<PhysicsComponent>(flanker, "Physics")!;

    ai.target = player; // CRITICAL FIX: AI needs target to stay in Combat state
    ai.state = "combat";
    ai.isFlanking = true;

    // Simulate Landing state manually to start, but Physics will verify ground
    phys.grounded = true;
    phys.velocity.y = 0;

    // Run frames to process state change in Strategy
    await runFrames(game, 2);

    if (ai.state !== "combat")
      throw new Error(`AI state changed from combat to ${ai.state} (Target lost?)`);
    if (ai.isFlanking) throw new Error("Flanking state did not clear upon landing");
  },
];
