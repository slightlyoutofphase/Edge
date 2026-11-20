import { Game } from "../core/Game";
import { TriggerSystem } from "../systems/TriggerSystem";
import { PlayerProgress, InputState, TimeState, CameraState } from "../core/Resources";
import { createEnemy, createPlatform } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { HealthComponent } from "../components/Health";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { LEVELS, TriggerData } from "../data/Levels";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function getPlayer(game: Game) {
  // FIX: Include PlayerInput to distinguish from enemies
  const results = game.world.query(
    "Transform",
    "Physics",
    "MovementState",
    "Health",
    "PlayerInput",
  );
  if (results.length === 0) throw new Error("No player found");
  const { id, components } = results[0];
  return {
    id,
    transform: components[0] as TransformComponent,
    physics: components[1] as PhysicsComponent,
    state: components[2] as MovementStateComponent,
    health: components[3] as HealthComponent,
  };
}

function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

function getTrigger(levelId: keyof typeof LEVELS, predicate: (trigger: TriggerData) => boolean) {
  const trigger = LEVELS[levelId].triggers.find(predicate);
  if (!trigger) throw new Error(`No matching trigger found for ${levelId}`);
  return trigger;
}

export const tests = [
  // === Level Loading Tests ===

  async function testLevelDataParsing(game: Game) {
    game.loadLevel("level1");
    const data = LEVELS["level1"];
    if (!data) throw new Error("Level data missing");

    // Filter out Interactables which also have Platform component (used for rendering/collision)
    const platforms = game.world
      .query("Platform")
      .filter((e) => !game.world.hasComponent(e.id, "Interactable"));

    if (platforms.length !== data.tiles.length)
      throw new Error(
        `Platform count mismatch. Expected ${data.tiles.length}, got ${platforms.length}`,
      );
  },

  async function testTilePlacement(game: Game) {
    game.loadLevel("level1");
    const platforms = game.world.query("Platform", "Transform");
    const ladder = platforms.find(
      (p) => (p.components[1] as TransformComponent).position.x === 1760, // Fixed expectation
    );
    if (!ladder) throw new Error("Specific tile (ladder) not found at expected position");
  },

  async function testEnemySpawnPositions(game: Game) {
    game.loadLevel("level1");
    const enemies = game.world.query("EnemyTag", "Transform");
    if (enemies.length === 0) throw new Error("No enemies spawned");

    const hollow = enemies.find(
      (e) => Math.abs((e.components[1] as TransformComponent).position.x - 608) < 1, // Fixed expectation
    );
    if (!hollow) throw new Error("Enemy spawn position incorrect");
  },

  // === Platform Type Tests ===

  async function testSolidPlatformCollision(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);

    player.transform.position = { x: 100, y: 800 };
    player.physics.velocity.y = 100;
    player.physics.grounded = false;

    await runFrames(game, 60);

    // Floor is at 1088. Player stops ON it.
    if (Math.abs(player.transform.position.y - 1088) > 5)
      throw new Error(`Passed through floor or stopped early. Y=${player.transform.position.y}`);
    if (!player.physics.grounded) throw new Error("Not grounded on solid platform");
  },

  async function testSemiSolidJumpThrough(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);

    player.transform.position = { x: 350, y: 750 };
    // Increase velocity significantly to clear 700 within 20 frames (prev was -400)
    player.physics.velocity.y = -600;
    player.physics.grounded = false;

    await runFrames(game, 20);

    if (player.transform.position.y > 700)
      throw new Error(`Blocked by semisolid from below. PosY: ${player.transform.position.y}`);
  },

  async function testSemiSolidDropThrough(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    player.transform.position = { x: 350, y: 700 };
    player.physics.grounded = true;
    player.physics.velocity.y = 0;

    const input = game.world.getResource<InputState>(InputState);
    input.keysDown.add("KeyS");
    const time = game.world.getResource<TimeState>(TimeState);
    const pInput = game.world.getComponent<any>(player.id, "PlayerInput")!;
    pInput.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };

    await runFrames(game, 5);

    if (player.transform.position.y <= 700) throw new Error("Did not drop through semisolid");
  },

  async function testHazardDamage(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);

    // Explicitly set health and invuln to ensure clean state
    player.health.current = 100;
    player.health.invulnTimer = 0;

    // Move player to intersect hazard at 800, 1180. Width 500.
    // Center of hazard is 1050. Move player to center to avoid any edge weirdness.
    // Y=1190 is slightly too high if hurtbox is -64 to 0.
    // Hurtbox relative to Y=1190 is Y=1126 to 1190.
    // Hazard Y is 1180.
    // There is an overlap of 10px.
    // Force the player slightly deeper into the spikes to guarantee contact
    player.transform.position = { x: 1050, y: 1195 };
    const startHealth = player.health.current;

    // Run more frames to ensure collision system picks it up and processes it
    await runFrames(game, 10);

    if (player.health.current >= startHealth) throw new Error("Hazard did not apply damage");
  },

  async function testHazardDamageInterval(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);

    // Build the hazard in empty space well away from authored level geometry,
    // enemies, and triggers so this test measures only hazard interval timing.
    const testHazardX = -400;
    const testHazardY = 576;
    const testPlayerX = testHazardX + 80;
    const testPlayerY = 607;

    createPlatform(game.world, testHazardX, 608, 160, 32, "solid", 0, "stone-floor");
    createPlatform(game.world, testHazardX, testHazardY, 160, 32, "hazard", 25, "hazard-spikes");

    player.health.current = 100;
    player.health.invulnTimer = 0;

    const runOverlappingFrames = async (count: number) => {
      for (let index = 0; index < count; index++) {
        player.transform.position = { x: testPlayerX, y: testPlayerY };
        player.physics.velocity.x = 0;
        player.physics.velocity.y = 0;
        player.physics.grounded = false;
        await runFrames(game, 1);
      }
    };

    await runOverlappingFrames(1);
    const h1 = player.health.current;

    await runOverlappingFrames(10);
    const h2 = player.health.current;

    if (h1 !== h2) throw new Error("Hazard damaged too quickly (ignored interval)");

    await runOverlappingFrames(60);
    if (player.health.current === h2)
      throw new Error("Hazard failed to damage again after interval");
  },

  async function testLadderGrab(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    // Ladder at 1760, 608. Center is 1776. (Width 32)
    // Floor is at 1088. Top is at 608.
    player.transform.position = { x: 1776, y: 750 }; // Lowered to 750 to be safe from top floor

    const input = game.world.getResource<InputState>(InputState);
    input.keysDown.add("KeyW");

    await runFrames(game, 1);

    if (player.state.current !== "climb") throw new Error("Failed to grab ladder");
  },

  async function testLadderMovement(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    // Ladder at 1760. Center 1776.
    player.transform.position = { x: 1776, y: 750 };
    player.state.current = "climb";

    const input = game.world.getResource<InputState>(InputState);
    input.keysDown.add("KeyW");

    const startY = player.transform.position.y;
    await runFrames(game, 5);

    if (player.transform.position.y >= startY)
      throw new Error(
        `Failed to climb up. StartY: ${startY}, CurrY: ${player.transform.position.y}`,
      );

    input.keysDown.delete("KeyW");
    input.keysDown.add("KeyS");
    const midY = player.transform.position.y;
    await runFrames(game, 5);

    if (player.transform.position.y <= midY) throw new Error("Failed to climb down");
  },

  async function testLadderDismount(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    player.transform.position = { x: 1776, y: 750 };
    player.state.current = "climb";

    const time = game.world.getResource<TimeState>(TimeState);
    const pInput = game.world.getComponent<any>(player.id, "PlayerInput")!;
    pInput.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };

    await runFrames(game, 1);

    if ((player.state.current as string) !== "jump")
      throw new Error("Failed to dismount ladder via jump");
  },

  async function testLadderJumpOff(game: Game) {
    // Same as dismount
    game.loadLevel("level1");
    const player = getPlayer(game);
    player.transform.position = { x: 1776, y: 750 };
    player.state.current = "climb";

    const time = game.world.getResource<TimeState>(TimeState);
    const pInput = game.world.getComponent<any>(player.id, "PlayerInput")!;
    pInput.buffer = { action: "jump", priority: 1, timestamp: time.elapsed };

    await runFrames(game, 1);

    if ((player.state.current as string) !== "jump") throw new Error("Failed to jump off ladder");
  },

  // === Checkpoint Tests ===

  async function testCheckpointActivation(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);

    player.transform.position = { x: 200, y: 1100 };

    await runFrames(game, 1);

    if (progress.lastCheckpointId !== "cp_start") throw new Error("Checkpoint not activated");
  },

  async function testRespawnAtCheckpoint(game: Game) {
    game.loadLevel("level1");
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);

    // Allow frames to pass so entities settle.
    // Important: runFrames triggers updates which might re-trigger checkpoints if player spawns on them.
    await runFrames(game, 1);

    // Set checkpoint ID AFTER settling the initial frame to avoid overwrites by cp_start
    progress.lastCheckpointId = "cp_ramparts"; // 1760, 608

    game.respawn();

    const player = getPlayer(game);
    if (Math.abs(player.transform.position.x - 1760) > 1) {
      // Fixed expectation
      throw new Error(
        `Respawn pos wrong. Expected 1760, got ${player.transform.position.x}. Is checkpoint ID 'cp_ramparts' valid?`,
      );
    }
  },

  async function testCheckpointPersistence(game: Game) {
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);
    progress.lastCheckpointId = "test";
    game.loadLevel("level1");

    const p2 = game.world.getResource<PlayerProgress>(PlayerProgress);
    if (p2.lastCheckpointId !== "test") throw new Error("Progress reset on level load");
  },

  async function testEnemyRespawnOnDeath(game: Game) {
    game.loadLevel("level1");
    const enemies = game.world.query("EnemyTag");
    const initialCount = enemies.length;

    game.world.destroyEntity(enemies[0].id);

    game.respawn();

    // Wait a frame to ensure load settles
    await runFrames(game, 1);

    const enemiesAfter = game.world.query("EnemyTag");
    if (enemiesAfter.length !== initialCount) throw new Error("Enemies not respawned correctly");
  },

  async function testHealthResetOnRespawn(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    player.health.current = 10;

    game.respawn();
    const p2 = getPlayer(game);
    if (p2.health.current !== 100) throw new Error("Health not reset");
  },

  async function testRespawnInvulnerability(game: Game) {
    game.respawn();
    const player = getPlayer(game);
    if (player.health.invulnTimer <= 0) throw new Error("No respawn invulnerability");
  },

  // === Death Screen Tests ===

  async function testDeathScreenAppears(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);

    player.health.current = 0;
    player.health.isDead = true;

    await runFrames(game, 1);
    if (!progress.isDead) throw new Error("Progress did not register death");
  },

  async function testDeathAnimationPlays(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    player.health.isDead = true;
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);

    await runFrames(game, 10);
    if (progress.deathTimer <= 0) throw new Error("Death timer not running");
  },

  async function testRespawnFromDeathScreen(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);
    player.health.isDead = true;

    progress.isDead = true;
    progress.deathTimer = 2001;

    pressKey("Space");

    await runFrames(game, 1);

    if (progress.isDead) throw new Error("Failed to respawn from input");
  },

  // === Boss Arena Tests ===

  async function testBossArenaCamera(game: Game) {
    game.loadLevel("level1");
    const player = getPlayer(game);
    const cam = game.world.getResource<CameraState>(CameraState);

    // Move into boss start trigger at 4512-5536
    // The trigger is a thin strip at 4512, w=64. Range [4512, 4576].
    // Position player squarely inside.
    player.transform.position = { x: 4544, y: 500 };

    await runFrames(game, 1);

    if (!cam.bounds) throw new Error("Camera bounds not locked in boss arena");
  },

  async function testBossHealthBar(game: Game) {
    const id = createEnemy(game.world, 0, 0, "boss");
    const ai = game.world.getComponent<AIControllerComponent>(id, "AIController")!;
    ai.target = game.playerId;

    await runFrames(game, 1);

    const tag = game.world.getComponent<any>(id, "EnemyTag");
    const health = game.world.getComponent<any>(id, "Health");

    if (tag.enemyType !== "boss") throw new Error("Enemy type not boss");
    if (!ai.target) throw new Error("AI target not set (required for UI visibility)");
    if (health.isDead) throw new Error("Boss is dead");
  },

  async function testBossPhaseTransitions(game: Game) {
    // Test that boss_start trigger sets boss AI to combat
    game.loadLevel("level3");
    const player = getPlayer(game);
    const bossTrigger = getTrigger("level3", (trigger) => trigger.type === "boss_start");

    player.transform.position.x = bossTrigger.x + bossTrigger.width / 2;
    player.transform.position.y = bossTrigger.y + bossTrigger.height / 2;

    await runFrames(game, 5);

    // Find Boss
    const enemies = game.world.query("EnemyTag", "AIController");
    const boss = enemies.find((e) => (e.components[0] as any).enemyType === "boss");
    if (!boss) throw new Error("Boss not found in level3");

    const ai = boss.components[1] as any;
    if (ai.state !== "combat")
      throw new Error(`Boss state not combat after trigger. State: ${ai.state}`);

    // Camera locked?
    const cam = game.world.getResource<CameraState>(CameraState);
    if (!cam.bounds) throw new Error("Camera not locked after boss trigger");
  },

  async function testLevelTransition(game: Game) {
    game.loadLevel("level2");
    const player = getPlayer(game);
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);
    const transitionTrigger = getTrigger(
      "level2",
      (trigger) => trigger.type === "transition" && trigger.target === "level3",
    );

    player.transform.position.x = transitionTrigger.x + transitionTrigger.width / 2;
    player.transform.position.y = transitionTrigger.y + transitionTrigger.height / 2;

    // Transition takes 1000ms. Wait > 60 frames.
    await runFrames(game, 70);

    if (progress.currentLevelId !== "level3")
      throw new Error(`Level transition failed. Current: ${progress.currentLevelId}`);
  },

  async function testVictoryState(game: Game) {
    // Simulate killing the boss
    game.loadLevel("level3");
    const enemies = game.world.query("EnemyTag", "Health");
    const boss = enemies.find((e) => (e.components[0] as any).enemyType === "boss");
    if (!boss) throw new Error("Boss not found");

    const bossHealth = boss.components[1] as HealthComponent;
    bossHealth.current = 0;
    bossHealth.isDead = true;

    const goal = LEVELS.level3.triggers.find((trigger) => trigger.type === "victory")!;
    getPlayer(game).transform.position = { x: goal.x + goal.width / 2, y: goal.y + 70 };
    new TriggerSystem(game.world).update();
    if (!game.world.getResource<PlayerProgress>(PlayerProgress).isVictory)
      throw new Error("Final goal did not enter victory after boss death");
  },
];
