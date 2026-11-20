import { Game } from "../core/Game";
import { InputState, CameraState } from "../core/Resources";
import { CombatComponent } from "../features/combat/CombatComponent";
import { StaminaComponent } from "../components/Stamina";
import { HealthComponent } from "../components/Health";
import { PlayerInputComponent } from "../components/PlayerInput";
import { createDummy, createPlatform } from "../entities/Archetypes";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { TransformComponent } from "../components/Transform";

function getPlayer(game: Game) {
  const results = game.world.query(
    "Combat",
    "Stamina",
    "Health",
    "PlayerInput",
    "Transform",
    "Animator",
    "Physics",
    "MovementState",
  );
  if (results.length === 0) throw new Error("No player found");
  const { id, components } = results[0];
  return {
    id,
    combat: components[0] as CombatComponent,
    stamina: components[1] as StaminaComponent,
    health: components[2] as HealthComponent,
    input: components[3] as PlayerInputComponent,
    transform: components[4] as TransformComponent,
    animator: components[5] as AnimatorComponent,
    physics: components[6] as PhysicsComponent,
    movement: components[7] as MovementStateComponent,
  };
}

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

// Helpers
function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

function ensureGrounded(game: Game, player: any) {
  player.transform.position.x = 0;
  player.transform.position.y = 400;
  player.transform.facing = 1;
  player.physics.velocity.x = 0;
  player.physics.velocity.y = 0;
  player.physics.grounded = true;
  player.movement.current = "idle";

  createPlatform(game.world, -1000, 400, 2000, 50, "semisolid");

  player.combat.attackState = "idle";
  player.combat.lastZoneChangeTime = -2000;
  player.combat.isBlocking = false;
  player.stamina.current = 100;
  player.health.invulnTimer = 0;
  player.health.current = 100;

  // Clear keys
  const input = game.world.getResource<InputState>(InputState);
  input.keysDown.clear();
  input.keysPressed.clear();
}

export const tests = [
  // 1. Reactive Parry (Frame Perfect Input)
  async function testReactiveParry(game: Game) {
    const player = getPlayer(game);
    ensureGrounded(game, player);

    // Setup: Player is IDLE (not parrying). Enemy hits Player on this exact frame.
    // AND Player presses 'Q' on this exact frame.

    // 1. Create Dummy Hitbox overlapping Player
    const dummyId = createDummy(game.world, 0, 400);
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 20,
      poiseDamage: 10,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    // 2. Press Q
    pressKey("KeyQ");

    // 3. Run frame.
    await runFrames(game, 1);

    // Success criteria: Player took NO damage, and Counter Window is Active.
    if (player.health.current !== 100)
      throw new Error(`Reactive Parry failed. Took damage. HP: ${player.health.current}`);

    if (!player.combat.counterWindowActive)
      throw new Error("Reactive Parry did not trigger counter window");
  },

  // 2. Omni-Directional Parry
  async function testOmniDirectionalParry(game: Game) {
    const player = getPlayer(game);
    ensureGrounded(game, player);

    // Player in Zone 1 (High)
    player.combat.attackZone = 1;

    // Start Parry
    player.combat.attackState = "parry";
    player.combat.attackTimer = 100;

    // Enemy attacks Low (Zone 3) - Mismatch
    const dummyId = createDummy(game.world, 0, 400);
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 20,
      poiseDamage: 10,
      knockback: { x: 0, y: 0 },
      zone: 3, // Low vs High
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    if (player.health.current !== 100)
      throw new Error("Parry failed on Zone Mismatch (Omni-Parry broken)");
  },

  // 3. Parry Hysteresis Bypass
  async function testParryHysteresisBypass(game: Game) {
    const player = getPlayer(game);
    ensureGrounded(game, player);

    const input = game.world.getResource<InputState>(InputState);
    const camera = game.world.getResource<CameraState>(CameraState);

    // 1. Move mouse to Zone 3 (Low)
    // Player 0,400. Mouse 150, 550.
    const cx = game.canvas.width / 2;
    const cy = game.canvas.height / 2;
    input.mousePosition.x = (150 - camera.position.x) * camera.zoom + cx;
    input.mousePosition.y = (550 - camera.position.y) * camera.zoom + cy;

    // Update zone.
    await runFrames(game, 1);
    if (player.combat.attackZone !== 3) throw new Error("Setup failed: Not in Zone 3");

    // 2. Quickly move mouse to Zone 1 (High) within hysteresis window (50ms)
    // Mouse 150, 200 (High)
    input.mousePosition.y = (200 - camera.position.y) * camera.zoom + cy;

    // Normally this update would be blocked by Hysteresis if we just ran updateZone.
    // But Parry should force it.

    // Press Parry
    pressKey("KeyQ");

    await runFrames(game, 1);

    // If bypass worked, we are now in Zone 1 AND Parrying.
    if ((player.combat.attackZone as number) !== 1)
      throw new Error(`Hysteresis not bypassed. Stuck in Zone ${player.combat.attackZone}`);
    if (player.combat.attackState !== "parry") throw new Error("Parry not started");
  },

  // 4. Extended Parry Window (12 frames)
  async function testExtendedParryWindow(game: Game) {
    const player = getPlayer(game);
    ensureGrounded(game, player);

    pressKey("KeyQ");
    await runFrames(game, 1); // Frame 1 (Start)

    // Wait 10 more frames (Total 11). Should still be parrying.
    // 6 frames was old limit. 12 is new.
    await runFrames(game, 10);

    if (player.combat.attackState !== "parry")
      throw new Error("Parry ended too early (Window not extended?)");

    // One more frame -> 12. Should transition to recovery or be at end.
    await runFrames(game, 2);
    if (player.combat.attackState === "parry")
      throw new Error("Parry did not end after 12+ frames");
  },

  // 5. Failed Parry (Whiff/Recovery Hit)
  async function testFailedParryStagger(game: Game) {
    const player = getPlayer(game);
    ensureGrounded(game, player);

    // Start parry
    pressKey("KeyQ");
    await runFrames(game, 1);

    // Wait for window to expire (12 frames + buffer)
    await runFrames(game, 15);

    if (player.combat.attackState !== "recovery")
      throw new Error("Setup failed: Player not in recovery");

    const dummyId = createDummy(game.world, 0, 400);
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 10,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    // Player should take damage because they were hit in recovery
    if (player.health.current === 100)
      throw new Error("Player did not take damage when hit during parry recovery");
  },
];
