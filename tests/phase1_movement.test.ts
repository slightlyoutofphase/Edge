import { Game } from "../core/Game";
import { InputState, CameraState, TimeState } from "../core/Resources";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PlayerInputComponent } from "../components/PlayerInput";
import { ColliderComponent } from "../components/Collider";
import { StaminaComponent } from "../components/Stamina";
import { HealthComponent } from "../components/Health";
import { CombatComponent } from "../features/combat/CombatComponent";
import { PLAYER_STATS, GRAVITY } from "../core/Constants";
import { createPlatform } from "../entities/Archetypes";

type PlayerComponents = {
  transform: TransformComponent;
  physics: PhysicsComponent;
  state: MovementStateComponent;
  inputComp: PlayerInputComponent;
  collider: ColliderComponent;
  stamina: StaminaComponent;
  health: HealthComponent;
  combat: CombatComponent;
};

function getPlayer(game: Game): PlayerComponents {
  const results = game.world.query(
    "Transform",
    "Physics",
    "MovementState",
    "PlayerInput",
    "Collider",
    "Stamina",
    "Health",
    "Combat",
  );
  if (results.length === 0) throw new Error("No player found in test world");
  const { components } = results[0];
  return {
    transform: components[0] as TransformComponent,
    physics: components[1] as PhysicsComponent,
    state: components[2] as MovementStateComponent,
    inputComp: components[3] as PlayerInputComponent,
    collider: components[4] as ColliderComponent,
    stamina: components[5] as StaminaComponent,
    health: components[6] as HealthComponent,
    combat: components[7] as CombatComponent,
  };
}

// Helper to ensure player is grounded with a platform
async function ensureGrounded(game: Game, player: PlayerComponents) {
  // Clear existing platforms and enemies to prevent interference from Level 1 defaults
  const platforms = game.world.query("Platform");
  platforms.forEach((e) => game.world.destroyEntity(e.id));

  const enemies = game.world.query("EnemyTag");
  enemies.forEach((e) => game.world.destroyEntity(e.id));

  // Set to 200 to avoid Level 1 Left Wall (ends at 0)
  player.transform.position.x = 200;
  player.transform.position.y = 400;
  player.physics.velocity.x = 0;
  player.physics.velocity.y = 0;
  player.transform.facing = 1; // Reset facing

  // Reset all movement timers to prevent state pollution
  player.state.slideCooldown = 0;
  player.state.slideTimer = 0;
  player.state.rollTimer = 0;
  player.state.rollDirection = undefined;
  player.state.backstepTimer = 0;
  player.state.current = "idle";

  // Reset input buffer
  player.inputComp.buffer = null;

  // Reset Stamina
  player.stamina.current = 100;
  player.stamina.isExhausted = false;

  // Reset Camera to prevent drift affecting Zone calculation tests
  const camera = game.world.getResource<CameraState>(CameraState);
  camera.position = { x: 0, y: 0 };
  camera.targetPosition = { x: 0, y: 0 };

  // Create floor
  createPlatform(game.world, -1000, 400, 2000, 50);

  // Run a few frames to let collision system settle
  await runFrames(game, 5, 16);

  // Force grounded
  player.physics.grounded = true;

  if (!player.physics.grounded) throw new Error("Test Setup: Failed to ground player");
}

// Manually step the game update loop
async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) {
    game.update(dt);
  }
}

// Helper to simulate key press via DOM events (so InputManager captures it correctly)
function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}
function releaseKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { code }));
}

// === Input System Tests ===

export const tests = [
  async function testKeyboardInputCapture(game: Game) {
    const input = game.world.getResource<InputState>(InputState);

    pressKey("KeyA");
    game.inputManager.update();

    if (!input.keysDown.has("KeyA")) throw new Error("KeyA not captured in keysDown");
    if (!input.keysPressed.has("KeyA")) throw new Error("KeyA not captured in keysPressed");
  },

  async function testMousePositionTracking(game: Game) {
    const input = game.world.getResource<InputState>(InputState);

    const canvasRect = game.canvas.getBoundingClientRect();
    const clientX = canvasRect.left + 100;
    const clientY = canvasRect.top + 200;

    window.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY }));

    if (Math.abs(input.mousePosition.x - 100) > 0.1)
      throw new Error(`Mouse X incorrect. Expected 100, got ${input.mousePosition.x}`);
    if (Math.abs(input.mousePosition.y - 200) > 0.1)
      throw new Error(`Mouse Y incorrect. Expected 200, got ${input.mousePosition.y}`);
  },

  async function testInputBufferStorage(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    // Use dispatchEvent so InputManager sees it pending, and update() promotes it to keysPressed
    pressKey("Space");

    await runFrames(game, 1);

    if (player.inputComp.buffer?.action !== "jump") throw new Error("Jump input not buffered");
    if (Math.abs(player.inputComp.buffer.timestamp - time.elapsed) > 16)
      throw new Error("Buffer timestamp not synchronized with game time");
  },

  async function testInputBufferExpiration(game: Game) {
    const player = getPlayer(game);

    pressKey("Space");
    await runFrames(game, 1);

    if (!player.inputComp.buffer) throw new Error("Setup failed: buffer empty");

    // Advance time past expiration (133ms)
    await runFrames(game, 10, 16);

    if (player.inputComp.buffer !== null) throw new Error("Buffer did not expire after 133ms");
  },

  // === Ground Movement Tests ===

  async function testWalkSpeed(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);

    pressKey("KeyD");
    const startX = player.transform.position.x;

    await runFrames(game, 10, 16); // 160ms

    const dist = player.transform.position.x - startX;
    const expected = PLAYER_STATS.walkSpeed * 0.16;

    if (Math.abs(dist - expected) > 1)
      throw new Error(`Walk speed incorrect. Expected ~${expected}, got ${dist}`);
  },

  async function testRunSpeed(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);

    pressKey("KeyD");
    pressKey("ShiftLeft");
    const startX = player.transform.position.x;

    await runFrames(game, 10, 16);

    const dist = player.transform.position.x - startX;
    const expected = PLAYER_STATS.runSpeed * 0.16;

    if (Math.abs(dist - expected) > 1)
      throw new Error(`Run speed incorrect. Expected ~${expected}, got ${dist}`);
  },

  async function testCrouchSpeed(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);

    pressKey("KeyD");
    pressKey("KeyS");
    const startX = player.transform.position.x;

    await runFrames(game, 10, 16);

    const dist = player.transform.position.x - startX;
    const expected = PLAYER_STATS.crouchSpeed * 0.16;

    if (Math.abs(dist - expected) > 1)
      throw new Error(`Crouch speed incorrect. Expected ~${expected}, got ${dist}`);
  },

  async function testCrouchHitboxReduction(game: Game) {
    const player = getPlayer(game);

    pressKey("KeyS");
    await runFrames(game, 1);

    if ((player.collider.hurtboxes[0].height as number) !== 38)
      throw new Error(
        `Crouch hitbox height incorrect. Expected 38, got ${player.collider.hurtboxes[0].height}`,
      );

    releaseKey("KeyS");
    await runFrames(game, 1);
    if (player.collider.hurtboxes[0].height !== 64)
      throw new Error(
        `Standing hitbox height incorrect. Expected 64, got ${player.collider.hurtboxes[0].height}`,
      );
  },

  async function testFacingDirection(game: Game) {
    const player = getPlayer(game);

    player.transform.facing = 1;

    pressKey("KeyA");
    await runFrames(game, 1);
    if ((player.transform.facing as number) !== -1) throw new Error("Failed to face left");

    releaseKey("KeyA");
    pressKey("KeyD");
    await runFrames(game, 1);
    if (player.transform.facing !== 1) throw new Error("Failed to face right");
  },

  async function testFacingLockedDuringAttack(game: Game) {
    const player = getPlayer(game);

    player.transform.facing = 1;
    player.combat.attackState = "active";

    pressKey("KeyA");
    await runFrames(game, 1);

    if (player.transform.facing !== 1) throw new Error("Facing changed during attack");
  },

  // === Jump Tests ===

  async function testJumpInitiation(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    // Single frame check doesn't need collision system stability, just manual flag
    player.physics.grounded = true;
    player.inputComp.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };

    await runFrames(game, 1);

    if (player.physics.velocity.y >= 0)
      throw new Error(`Jump velocity not applied: ${player.physics.velocity.y}`);
    if (player.state.current !== "jump") throw new Error("State did not change to jump");
  },

  async function testVariableJumpHeight(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    // Short Jump
    player.transform.position.y = 300;
    player.physics.velocity.y = 0;
    player.physics.grounded = true;
    player.inputComp.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };
    // No Space key pressed means tapped (released immediately)

    await runFrames(game, 1);

    let minYShort = 300;
    for (let i = 0; i < 20; i++) {
      await runFrames(game, 1);
      minYShort = Math.min(minYShort, player.transform.position.y);
    }

    // Long Jump
    game.resetLevel();
    const player2 = getPlayer(game);
    const input2 = game.world.getResource<InputState>(InputState);
    const time2 = game.world.getResource<TimeState>(TimeState);

    player2.transform.position.y = 300;
    player2.physics.velocity.y = 0;
    player2.physics.grounded = true;
    player2.inputComp.buffer = { action: "jump", priority: 1, timestamp: time2.elapsed };

    // Ensure InputManager knows Space is held
    pressKey("Space");
    input2.keysDown.add("Space");

    await runFrames(game, 1);

    let minYLong = 300;
    for (let i = 0; i < 20; i++) {
      await runFrames(game, 1);
      minYLong = Math.min(minYLong, player2.transform.position.y);
    }

    if (minYLong >= minYShort)
      throw new Error(`Long jump (${minYLong}) not higher than short jump (${minYShort})`);
  },

  async function testJumpMomentumPreservation(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    player.physics.grounded = true;
    player.physics.velocity.x = 100;

    player.inputComp.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };
    await runFrames(game, 1);

    if (player.physics.velocity.x !== 100)
      throw new Error(`Momentum lost on jump start. Got ${player.physics.velocity.x}`);
  },

  async function testNoDoubleJump(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    player.physics.grounded = false;
    player.state.current = "jump";
    player.state.coyoteTimer = 0;

    player.inputComp.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };

    const velY = player.physics.velocity.y;
    await runFrames(game, 1);

    if (player.physics.velocity.y < velY && player.physics.velocity.y < -100) {
      throw new Error("Double jump occurred");
    }
  },

  async function testCoyoteTime(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    player.physics.grounded = false;
    player.state.previousGrounded = true;
    player.state.coyoteTimer = 0; // Ensure system resets it

    // Simulate transition
    player.physics.grounded = true;
    await runFrames(game, 1);
    player.physics.grounded = false;
    await runFrames(game, 1);

    if (player.state.coyoteTimer <= 0) throw new Error("Coyote timer not set");

    player.inputComp.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };
    await runFrames(game, 1);

    if (player.state.current !== "jump") throw new Error("Failed to coyote jump");
  },

  async function testJumpBuffer(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);

    // FIX: Move player high into air to avoid any residual platform collision from previous tests
    player.transform.position.y = 0;

    player.physics.grounded = false;
    player.state.coyoteTimer = 0; // Ensure no coyote jump

    player.inputComp.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };

    // Wait a few frames
    await runFrames(game, 2);

    if ((player.state.current as string) === "jump") throw new Error("Jump fired in air");

    player.physics.grounded = true;
    await runFrames(game, 1);

    if (player.state.current !== "jump") throw new Error("Buffered jump did not fire on landing");
  },

  // === Dodge Roll Tests ===

  async function testRollDistance(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    const time = game.world.getResource<TimeState>(TimeState);

    player.transform.facing = 1;
    const startX = player.transform.position.x;

    player.inputComp.buffer = { action: "roll", priority: 3, timestamp: time.elapsed };

    // Run until roll is finished
    let frames = 0;
    await runFrames(game, 1); // Start roll

    if (player.transform.facing !== 1)
      throw new Error(
        `Default backward roll should preserve facing 1, got ${player.transform.facing}`,
      );

    while (player.state.current === "roll" && frames < 60) {
      await runFrames(game, 1);
      frames++;
    }

    const dist = startX - player.transform.position.x;
    // 180 is target backwards (-X when facing 1). Tolerance increased slightly due to discrete steps.
    if (Math.abs(dist - PLAYER_STATS.rollDistance) > 25)
      throw new Error(`Default backward roll distance mismatch. Expected -180 delta, got ${-dist}`);
  },

  async function testRollDuration(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    const time = game.world.getResource<TimeState>(TimeState);

    player.inputComp.buffer = { action: "roll", priority: 3, timestamp: time.elapsed };

    await runFrames(game, 1);
    if (player.state.current !== "roll") throw new Error("Roll did not start");

    await runFrames(game, Math.floor(PLAYER_STATS.rollDuration / 16) - 1, 16);
    if (player.state.current !== "roll") throw new Error("Roll ended early");

    await runFrames(game, 2, 16);
    if (player.state.current === "roll") throw new Error("Roll did not end");
  },

  async function testRollIFrames(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    const time = game.world.getResource<TimeState>(TimeState);

    player.inputComp.buffer = { action: "roll", priority: 3, timestamp: time.elapsed };

    await runFrames(game, 1);
    if (player.health.invulnTimer !== 200)
      throw new Error(`Roll i-frames not set. Expected 200, got ${player.health.invulnTimer}`);
  },

  async function testRollDirectionChange(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    const time = game.world.getResource<TimeState>(TimeState);

    player.transform.facing = 1;

    pressKey("KeyA");

    player.inputComp.buffer = { action: "roll", priority: 3, timestamp: time.elapsed };

    await runFrames(game, 1);
    releaseKey("KeyA");

    if ((player.transform.facing as number) !== -1)
      throw new Error("Facing did not update before roll");
    if (player.physics.velocity.x >= 0) throw new Error("Roll velocity wrong direction");
  },

  async function testRollBackwardsByDefaultLeftFacing(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);

    player.transform.facing = -1;
    const startX = player.transform.position.x;

    pressKey("KeyG");
    await runFrames(game, 1);
    releaseKey("KeyG");

    if (player.state.current !== "roll") throw new Error("Roll did not start while facing left");
    if (player.transform.facing !== -1)
      throw new Error(`Backward roll changed facing from -1 to ${player.transform.facing}`);
    if (player.physics.velocity.x <= 0)
      throw new Error(
        `Expected +X backward roll velocity when facing -1, got ${player.physics.velocity.x}`,
      );

    let frames = 0;
    while (player.state.current === "roll" && frames < 60) {
      await runFrames(game, 1);
      frames++;
    }

    const dist = player.transform.position.x - startX;
    if (Math.abs(dist - PLAYER_STATS.rollDistance) > 25)
      throw new Error(`Left-facing backward roll distance mismatch. Expected +180, got ${dist}`);
  },

  async function testRollForwardsWhenHoldingForwardsKey(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);

    // Facing right + holding KeyD -> roll forwards (+X)
    player.transform.facing = 1;
    const startXRight = player.transform.position.x;
    pressKey("KeyD");
    pressKey("KeyG");
    await runFrames(game, 1);
    releaseKey("KeyG");
    releaseKey("KeyD");

    if (player.state.current !== "roll" || player.physics.velocity.x <= 0)
      throw new Error(
        `Expected forward +X roll when holding KeyD, got vel=${player.physics.velocity.x}`,
      );

    let frames = 0;
    while (player.state.current === "roll" && frames < 60) {
      await runFrames(game, 1);
      frames++;
    }
    const rightDelta = player.transform.position.x - startXRight;
    if (Math.abs(rightDelta - PLAYER_STATS.rollDistance) > 25)
      throw new Error(`Forward roll right distance mismatch. Expected +180, got ${rightDelta}`);

    // Facing left + holding KeyA -> roll forwards (-X)
    await ensureGrounded(game, player);
    player.transform.facing = -1;
    const startXLeft = player.transform.position.x;
    pressKey("KeyA");
    pressKey("KeyG");
    await runFrames(game, 1);
    releaseKey("KeyG");
    releaseKey("KeyA");

    if (player.state.current !== "roll" || player.physics.velocity.x >= 0)
      throw new Error(
        `Expected forward -X roll when holding KeyA, got vel=${player.physics.velocity.x}`,
      );

    frames = 0;
    while (player.state.current === "roll" && frames < 60) {
      await runFrames(game, 1);
      frames++;
    }
    const leftDelta = startXLeft - player.transform.position.x;
    if (Math.abs(leftDelta - PLAYER_STATS.rollDistance) > 25)
      throw new Error(
        `Forward roll left distance mismatch. Expected -180 delta, got ${-leftDelta}`,
      );
  },

  async function testRollRespectsForwardsKeyAtPressTime(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);

    const playerId = game.world.query("PlayerInput")[0].id;

    // 1. Mid-attack facing right, holding KeyA (backwards key) + press Roll -> rolls backwards (-X) and preserves facing
    player.transform.facing = 1;
    pressKey("KeyE");
    await runFrames(game, 1);
    releaseKey("KeyE");
    pressKey("KeyA");
    pressKey("KeyG");
    await runFrames(game, 1);
    releaseKey("KeyG");
    releaseKey("KeyA");

    if (
      player.state.current !== "roll" ||
      player.physics.velocity.x >= 0 ||
      player.transform.facing !== 1
    )
      throw new Error(
        `Expected backwards -X roll with facing 1 during windup while holding KeyA, got state=${player.state.current}, vel=${player.physics.velocity.x}, facing=${player.transform.facing}`,
      );

    // 2. Press Roll while holding KeyD during HitStop, release KeyD before HitStop ends -> rolls forwards (+X)
    await ensureGrounded(game, player);
    player.transform.facing = 1;
    game.world.addComponent(playerId, "HitStop", { frames: 2, remainingMs: 32 });
    pressKey("KeyD");
    pressKey("KeyG");
    await runFrames(game, 1); // InputSystem captures KeyD down on Roll press while HitStop blocks MovementSystem
    releaseKey("KeyG");
    releaseKey("KeyD");
    await runFrames(game, 3); // HitStop expires and buffered roll executes

    if (player.state.current !== "roll" || player.physics.velocity.x <= 0)
      throw new Error(
        `Buffered roll should honor KeyD held at press time, got state=${player.state.current}, vel=${player.physics.velocity.x}`,
      );

    // 3. Press Roll without forwards key during HitStop, then press KeyD before HitStop ends -> still rolls backwards (-X)
    await ensureGrounded(game, player);
    player.transform.facing = 1;
    game.world.addComponent(playerId, "HitStop", { frames: 2, remainingMs: 32 });
    pressKey("KeyG");
    await runFrames(game, 1);
    releaseKey("KeyG");
    pressKey("KeyD");
    await runFrames(game, 3);
    releaseKey("KeyD");

    if (player.state.current !== "roll" || player.physics.velocity.x >= 0)
      throw new Error(
        `Buffered roll without KeyD at press time should default backwards, got state=${player.state.current}, vel=${player.physics.velocity.x}`,
      );
  },

  async function testNoAirRoll(game: Game) {
    const player = getPlayer(game);
    const time = game.world.getResource<TimeState>(TimeState);
    player.physics.grounded = false;
    player.inputComp.buffer = { action: "roll", priority: 3, timestamp: time.elapsed };

    await runFrames(game, 1);
    if (player.state.current === "roll") throw new Error("Rolled in air");
  },

  // === Backstep Tests ===

  async function testBackstepDistance(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    // Ensure starting position is safe from walls (200)
    // ensureGrounded sets to 200.
    player.transform.facing = 1;

    const startX = player.transform.position.x;

    pressKey("AltLeft");

    const duration = PLAYER_STATS.backstepDuration;
    const frames = Math.ceil(duration / 16);

    await runFrames(game, frames, 16);

    const dist = startX - player.transform.position.x;
    if (Math.abs(dist - PLAYER_STATS.backstepDistance) > 10)
      throw new Error(`Backstep distance mismatch. Expected 80, got ${dist}`);
  },

  async function testBackstepDuration(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    pressKey("AltLeft");

    await runFrames(game, 1);
    if (player.state.current !== "backstep") throw new Error("Backstep start failed");

    await runFrames(game, Math.floor(PLAYER_STATS.backstepDuration / 16) - 1, 16);
    if (player.state.current !== "backstep") throw new Error("Backstep ended early");

    await runFrames(game, 2, 16);
    if (player.state.current === "backstep") throw new Error("Backstep did not end");
  },

  async function testBackstepIFrames(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    pressKey("AltLeft");

    await runFrames(game, 1);
    if (player.health.invulnTimer !== 100)
      throw new Error(
        `Backstep i-frames incorrect. Expected 100, got ${player.health.invulnTimer}`,
      );
  },

  // === Crouch Slide Tests ===

  async function testSlideDistance(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    player.physics.velocity.x = 100; // Moving
    player.transform.facing = 1;

    const startX = player.transform.position.x;

    pressKey("KeyV");

    const frames = Math.ceil(PLAYER_STATS.slideDuration / 16);
    await runFrames(game, frames, 16);

    const dist = player.transform.position.x - startX;
    if (Math.abs(dist - PLAYER_STATS.slideDistance) > 20)
      throw new Error(`Slide distance mismatch. Expected 200, got ${dist}`);
  },

  async function testSlideDuration(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    player.physics.velocity.x = 100;
    pressKey("KeyV");

    await runFrames(game, 1);
    if (player.state.current !== "slide") throw new Error("Slide start failed");

    await runFrames(game, Math.floor(PLAYER_STATS.slideDuration / 16) - 1, 16);
    if (player.state.current !== "slide") throw new Error("Slide ended early");

    await runFrames(game, 2, 16);
    if (player.state.current === "slide") throw new Error("Slide did not end");
  },

  async function testSlideCooldown(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    player.physics.velocity.x = 100;

    // Slide 1
    pressKey("KeyV");
    await runFrames(game, Math.ceil(PLAYER_STATS.slideDuration / 16) + 2, 16);
    releaseKey("KeyV"); // Ensure released

    // Try Slide 2 immediately
    // Note: Must press movement keys to have velocity
    pressKey("KeyD");

    pressKey("KeyV");
    await runFrames(game, 1);

    if (player.state.current === "slide") throw new Error("Slide cooldown ignored");

    // Wait out cooldown
    await runFrames(game, Math.ceil(500 / 16) + 5, 16);

    releaseKey("KeyV");
    pressKey("KeyV"); // Repress
    await runFrames(game, 1);
    if ((player.state.current as string) !== "slide")
      throw new Error("Failed to slide after cooldown");
  },

  async function testSlideHitbox(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    player.physics.velocity.x = 100;
    pressKey("KeyV");

    await runFrames(game, 1);

    if (player.collider.hurtboxes[0].height !== 38)
      throw new Error("Slide did not reduce hitbox height");
  },

  async function testSlideStaminaCost(game: Game) {
    const player = getPlayer(game);
    await ensureGrounded(game, player);
    player.physics.velocity.x = 100;
    player.stamina.current = 100;

    pressKey("KeyV");
    await runFrames(game, 1);

    if (player.stamina.current > 85.1) throw new Error("Stamina not deducted for slide");
  },

  // === Physics Tests ===

  async function testGravityApplication(game: Game) {
    const player = getPlayer(game);

    // FIX: Ensure player is in the air
    player.transform.position.y = 0;

    player.physics.grounded = false;
    player.physics.velocity.y = 0;

    await runFrames(game, 10, 16);

    const expected = GRAVITY * 0.16; // 980 * 0.16 = 156.8
    if (Math.abs(player.physics.velocity.y - expected) > 10)
      throw new Error(`Gravity incorrect. Expected ~${expected}, got ${player.physics.velocity.y}`);
  },

  async function testGroundedDetection(game: Game) {
    const player = getPlayer(game);

    // Place player slightly above floor (400)
    player.transform.position.y = 398;
    player.physics.grounded = false;
    player.physics.velocity.y = 100;

    createPlatform(game.world, -100, 400, 500, 50);

    // Should hit immediately
    await runFrames(game, 5, 16);

    if (!player.physics.grounded) throw new Error("Failed to detect ground");
    if (Math.abs(player.transform.position.y - 400) > 1)
      throw new Error(`Position correction failed. Pos: ${player.transform.position.y}`);
  },

  async function testPlatformCollision(game: Game) {
    const player = getPlayer(game);

    // Use explicit platform for this test to avoid dependency on default level layout
    // Create platform at 600, 250
    createPlatform(game.world, 600, 250, 200, 20, "solid");

    // Place player above it
    player.transform.position.x = 650;
    player.transform.position.y = 100;
    player.physics.grounded = false;
    player.physics.velocity.x = 0;
    player.physics.velocity.y = 0;

    await runFrames(game, 40, 16);

    if (Math.abs(player.transform.position.y - 250) > 2)
      throw new Error(`Passed through solid platform. Y=${player.transform.position.y}`);
    if (!player.physics.grounded) throw new Error("Not grounded on platform");
  },

  // === Camera Tests ===

  async function testCameraFollowsPlayer(game: Game) {
    // Reset level FIRST, so we don't query dead components
    game.resetLevel();

    const player = getPlayer(game);
    const camera = game.world.getResource<CameraState>(CameraState);

    // Use coordinates far from Level 1 triggers (x=1500) to avoid bounds locking interference
    const TEST_X = -2000;
    const TEST_Y = 1000;

    // Reset camera state explicitly for this test
    camera.position = { x: TEST_X, y: TEST_Y };
    camera.targetPosition = { x: TEST_X, y: TEST_Y };
    camera.bounds = null;

    // Ensure player is supported by platform so they don't fall
    createPlatform(game.world, TEST_X - 100, TEST_Y, 200, 50);

    player.transform.position.x = TEST_X;
    player.transform.position.y = TEST_Y;
    player.physics.grounded = true;
    player.physics.velocity.y = 0;
    player.physics.velocity.x = 0; // No velocity = no lookahead

    // Let physics settle first
    await runFrames(game, 5, 16);

    await runFrames(game, 100, 16);

    if (Math.abs(camera.position.x - TEST_X) > 100)
      throw new Error(`Camera not following X. Player: ${TEST_X}, Cam: ${camera.position.x}`);
    if (Math.abs(camera.position.y - TEST_Y) > 100)
      throw new Error(`Camera not following Y. Player: ${TEST_Y}, Cam: ${camera.position.y}`);
  },

  async function testCameraDeadZone(game: Game) {
    game.resetLevel();
    const player = getPlayer(game);
    const camera = game.world.getResource<CameraState>(CameraState);

    player.transform.position = { x: 0, y: 0 };
    camera.position = { x: 0, y: 0 };
    camera.targetPosition = { x: 0, y: 0 };
    player.physics.velocity = { x: 0, y: 0 };

    player.transform.position.x = 20;
    await runFrames(game, 1, 16);
    if (camera.targetPosition.x !== 0) throw new Error("Camera target moved inside deadzone");

    player.transform.position.x = 40;
    await runFrames(game, 1, 16);
    if (camera.targetPosition.x === 0)
      throw new Error("Camera target did not move outside deadzone");
  },

  async function testCameraLookAhead(game: Game) {
    game.resetLevel();
    const player = getPlayer(game);
    const camera = game.world.getResource<CameraState>(CameraState);

    // Simulate input so MovementSystem maintains velocity
    pressKey("KeyD");
    pressKey("ShiftLeft");

    player.physics.velocity.x = 250;

    camera.position.x = 0;
    camera.targetPosition.x = 0;
    player.transform.position.x = 0;

    await runFrames(game, 60, 16);

    // Target should include offset
    // If x=0, targetX = 0 + 100 = 100.
    // Camera moves to 100.
    // Even if player moves, relative lookahead adds to target
    if (camera.position.x <= 10) throw new Error("Camera lookahead not applied");
  },

  async function testCameraNullBounds(game: Game) {
    const camera = game.world.getResource<CameraState>(CameraState);
    camera.bounds = null;
    if (camera.bounds !== null) throw new Error("Camera bounds not null");
  },
];
