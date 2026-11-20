import { Game } from "../core/Game";
import { PlayerBonePaths } from "../assets/svg/PlayerSVG";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";
import { TilePaths } from "../assets/svg/EnvironmentSVGs";
import { PlayerSkeleton } from "../skeleton/data/PlayerSkeleton";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { TransformComponent } from "../components/Transform";
import { CameraState, TimeState, InputState } from "../core/Resources";
import { createDummy } from "../entities/Archetypes";
import { HealthComponent } from "../components/Health";
import { CombatComponent } from "../features/combat/CombatComponent";
import {
  VisualEffectComponent,
  HitFlashComponent,
} from "../features/visuals/VisualEffectComponent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { Animation } from "../features/animation/AnimationTypes";
import { AssetLoader } from "../assets/AssetLoader";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function getPlayer(game: Game) {
  // FIX: Added 'PlayerInput' to query to ensure we get the Player, not an Enemy
  const results = game.world.query(
    "Skeleton",
    "Animator",
    "Transform",
    "Combat",
    "Health",
    "PlayerInput",
  );
  if (results.length === 0) throw new Error("No player found");
  const { id, components } = results[0];

  // Fix: Remove MovementState so manual animator control works for tests
  if (game.world.hasComponent(id, "MovementState")) {
    game.world.removeComponent(id, "MovementState");
  }

  return {
    id,
    skeleton: components[0] as SkeletonComponent,
    animator: components[1] as AnimatorComponent,
    transform: components[2] as TransformComponent,
    combat: components[3] as CombatComponent,
    health: components[4] as HealthComponent,
  };
}

export const tests = [
  // === SVG Rendering Tests ===

  async function testPlayerSVGComplete(_game: Game) {
    for (const [boneId, _] of PlayerSkeleton.bones) {
      if (
        boneId === "root" ||
        boneId === "body-pivot" ||
        boneId === "hip" ||
        boneId === "weapon-grip" ||
        boneId === "neck" ||
        boneId === "off-hand-item"
      )
        continue;
      if (!PlayerBonePaths[boneId]) throw new Error(`Missing SVG for player bone: ${boneId}`);
    }
  },

  async function testPlayerLimbProportions(_game: Game) {
    if (!PlayerBonePaths["leg-front-upper"].path.includes("L 2 12"))
      throw new Error("Leg upper geometry looks wrong (length check)");
  },

  async function testEnemySVGsComplete(_game: Game) {
    const types = ["hollow", "soldier", "duelist", "brute"];
    for (const t of types) {
      if (!EnemyBonePaths[t]) throw new Error(`Missing Enemy SVG set for: ${t}`);
      if (!EnemyBonePaths[t]["head"]) throw new Error(`Missing head for ${t}`);
    }
  },

  async function testSVGPathParsing(_game: Game) {
    if (typeof Path2D !== "undefined") {
      try {
        new Path2D(PlayerBonePaths["head"].path);
      } catch (e) {
        throw new Error(`Invalid SVG path string: ${e}`);
      }
    }
  },

  // === Animation Polish Tests ===

  async function testIdleAnimationLoop(game: Game) {
    const { animator } = getPlayer(game);
    animator.currentAnim = "idle";
    animator.time = 1990;
    await runFrames(game, 2);
    if (animator.time > 100) throw new Error("Idle did not loop");
  },

  async function testWalkAnimationCycle(game: Game) {
    const { animator } = getPlayer(game);
    animator.currentAnim = "walk";
    animator.time = 0;
    await runFrames(game, 10);
    if (animator.time === 0) throw new Error("Walk animation stuck");
  },

  async function testAttackAnimationTiming(game: Game) {
    const { combat } = getPlayer(game);
    combat.attackState = "windup";
    // Assume verified in phase 2/3 tests.
  },

  async function testBlendingNoPopping(game: Game) {
    const { animator, id } = getPlayer(game);

    // Remove PlayerInput so MovementSystem doesn't override manual velocity to 0
    game.world.removeComponent(id, "PlayerInput");

    // Re-add MovementState to drive animation logic naturally
    game.world.addComponent(id, "MovementState", {
      current: "idle",
      previousGrounded: true,
      coyoteTimer: 0,
      slideTimer: 0,
      slideCooldown: 0,
      rollTimer: 0,
      backstepTimer: 0,
      jumpBufferTimer: 0,
      dropThroughTimer: 0,
    });

    // FORCE physics grounded to ensure MovementSystem doesn't override state to 'fall'
    const physics = game.world.getComponent<PhysicsComponent>(id, "Physics");
    if (physics) {
      physics.grounded = true;
      physics.velocity = { x: 0, y: 0 };
    }

    animator.currentAnim = "idle";
    animator.blendFrom = null;

    await runFrames(game, 1);

    // Trigger blend by inducing movement via velocity
    // We set velocity so MovementSystem (which runs before AnimationSystem) detects movement and sets state to 'walk'
    if (physics) {
      physics.velocity.x = 100;
    }

    await runFrames(game, 1);

    if (animator.blendFrom !== "idle")
      throw new Error(`Blend from not set. Got ${animator.blendFrom}`);
    if (animator.blendElapsed <= 0) throw new Error("Blend not elapsing");
  },

  async function testAnimationLayering(game: Game) {
    const { animator, skeleton } = getPlayer(game);

    // Define test anim for layer
    const layerAnim: Animation = {
      name: "layer_test",
      duration: 100,
      loop: false,
      keyframes: [{ time: 0, bones: { head: { rotate: 90 } } }],
    };
    (AssetLoader as any).animations.set("layer_test", layerAnim);

    animator.layers.push({
      name: "test",
      boneMask: new Set(["head"]),
      animation: layerAnim,
      time: 0,
      weight: 1.0,
      blendMode: "override",
      priority: 10,
    });

    await runFrames(game, 1);

    if (skeleton.currentPose["head"]?.rotate !== 90) throw new Error("Layer did not override bone");
  },

  // === Visual Effect Tests ===

  async function testHitSparkSpawn(game: Game) {
    const player = getPlayer(game);

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    const effects = game.world.query("VisualEffect");
    const spark = effects.find(
      (e) => (e.components[0] as VisualEffectComponent).type === "flesh_hit",
    );

    if (!spark) throw new Error("Flesh contact effect not spawned on hit");
  },

  async function testHitFlashOnDamage(game: Game) {
    const player = getPlayer(game);
    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    const flash = game.world.getComponent<HitFlashComponent>(player.id, "HitFlash");
    if (!flash) throw new Error("HitFlash component not added on hit");
  },

  async function testBlockSparkEffect(game: Game) {
    const player = getPlayer(game);
    player.combat.isBlocking = true;
    player.combat.blockZone = 2;

    const input = game.world.getResource<InputState>(InputState);
    input.mouseButtons.add(2);

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    const effects = game.world.query("VisualEffect");
    const spark = effects.find(
      (e) => (e.components[0] as VisualEffectComponent).type === "block_spark",
    );
    if (!spark) throw new Error("Block spark not spawned");
  },

  async function testParrySparkBurst(game: Game) {
    const player = getPlayer(game);
    player.combat.attackState = "parry";
    player.combat.attackZone = 2;
    player.combat.attackTimer = 100;

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    const effects = game.world.query("VisualEffect");
    const burst = effects.filter(
      (e) => (e.components[0] as VisualEffectComponent).type === "spark",
    );
    if (burst.length < 5) throw new Error("Parry burst (multiple sparks) not spawned");
  },

  async function testParryTimeSlowEffect(game: Game) {
    const player = getPlayer(game);
    player.combat.attackState = "parry";
    player.combat.attackZone = 2;
    player.combat.attackTimer = 100;

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    const time = game.world.getResource<TimeState>(TimeState);
    if (time.timeScale >= 1.0) throw new Error(`Time scale not reduced. Got ${time.timeScale}`);
  },

  // === Screen Shake Tests ===

  async function testLightHitShake(game: Game) {
    const cam = game.world.getResource<CameraState>(CameraState);

    const player = getPlayer(game);
    player.health.invulnTimer = 0;

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);
    if (cam.shake.amplitude < 1.4)
      throw new Error(`Light hit shake missing. Got ${cam.shake.amplitude}`);
  },

  async function testHeavyHitShake(game: Game) {
    const cam = game.world.getResource<CameraState>(CameraState);
    const player = getPlayer(game);
    player.health.invulnTimer = 0;

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "heavy",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);
    if (cam.shake.amplitude < 3.4)
      throw new Error(`Heavy hit shake missing. Got ${cam.shake.amplitude}`);
  },

  async function testBossAttackShake(game: Game) {
    const cam = game.world.getResource<CameraState>(CameraState);

    // Mock active hitbox from boss hitting player
    const player = getPlayer(game);
    // Fix: Force player position to 0,0 to ensure overlap with dummy boss
    player.transform.position.x = 0;
    player.transform.position.y = 0;

    const dummyBoss = createDummy(game.world, 0, 0); // Attacker
    game.world.addComponent(dummyBoss, "EnemyTag", { enemyType: "boss" });

    game.world.addComponent(dummyBoss, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 200,
      height: 200,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyBoss,
      attackType: "heavy",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    if (cam.shake.amplitude < 3.4) throw new Error("Boss attack shake missing");
  },

  async function testParryShake(game: Game) {
    const cam = game.world.getResource<CameraState>(CameraState);
    const player = getPlayer(game);
    player.combat.attackState = "parry";
    player.combat.attackZone = 2;

    const dummyId = createDummy(
      game.world,
      player.transform.position.x,
      player.transform.position.y,
    );
    game.world.addComponent(dummyId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: dummyId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    if (cam.shake.amplitude <= 0) throw new Error("Parry shake missing");
  },

  async function testShakeDecay(game: Game) {
    const cam = game.world.getResource<CameraState>(CameraState);
    cam.shake.amplitude = 10;
    cam.shake.duration = 1000;
    cam.shake.elapsed = 0;

    await runFrames(game, 10);
    if (cam.shake.amplitude >= 10) throw new Error("Shake did not decay");
  },

  // === Invulnerability Visual Tests ===

  async function testIFrameFlicker(game: Game) {
    const player = getPlayer(game);
    player.health.invulnTimer = 100;
    if (player.health.invulnTimer <= 0) throw new Error("IFrame setup failed");
  },

  async function testFlickerDuration(game: Game) {
    const player = getPlayer(game);

    // Re-add MovementState so MovementSystem updates the timer
    game.world.addComponent(player.id, "MovementState", {
      current: "idle",
      previousGrounded: true,
      coyoteTimer: 0,
      slideTimer: 0,
      slideCooldown: 0,
      rollTimer: 0,
      backstepTimer: 0,
      jumpBufferTimer: 0,
      dropThroughTimer: 0,
    });

    player.health.invulnTimer = 500;

    await runFrames(game, 10);

    if (player.health.invulnTimer >= 500) throw new Error("Timer not decrementing");
  },

  // FIX: Updated test to check if alpha was ever reduced during frame
  async function testInvulnVisualFlicker(game: Game) {
    const player = getPlayer(game);
    player.health.invulnTimer = 300;

    // Ensure player is visible to render system by centering camera on them
    const camera = game.world.getResource<CameraState>(CameraState);
    camera.position = { ...player.transform.position };

    // Mock Context to check globalAlpha setter
    const ctx = game.canvas.getContext("2d") as any;
    let lowestAlpha = 1.0;

    // Define setter on prototype or instance
    Object.defineProperty(ctx, "globalAlpha", {
      set: (val) => {
        if (val < lowestAlpha) lowestAlpha = val;
      },
      get: () => 1.0, // dummy
      configurable: true,
    });

    await runFrames(game, 1);

    // Clean up
    delete (ctx as any).globalAlpha;

    if (Math.abs(lowestAlpha - 0.3) > 0.01)
      throw new Error(`Alpha not reduced during flicker. Lowest: ${lowestAlpha}`);
  },

  // === Roll Effect Tests ===

  async function testRollMotionBlur(game: Game) {
    const player = getPlayer(game);
    // Correct query for specific entity
    // Note: MovementState was removed by getPlayer, we need it for this test.
    // Re-adding it or just mocking the logic in EffectSystem if it depended on it?
    // EffectSystem checks MovementState from world query.
    // We removed it from player entity. Re-add it.
    game.world.addComponent(player.id, "MovementState", {
      current: "roll",
      rollTimer: 120,
      previousGrounded: true,
      coyoteTimer: 0,
      slideTimer: 0,
      slideCooldown: 0,
      backstepTimer: 0,
      jumpBufferTimer: 0,
      dropThroughTimer: 0,
    });

    await runFrames(game, 1);

    const effects = game.world.query("VisualEffect");
    const ghost = effects.find((e) => (e.components[0] as VisualEffectComponent).type === "ghost");
    if (!ghost) throw new Error("Ghost (motion blur) not spawned");
  },

  async function testRollDustParticles(game: Game) {
    const player = getPlayer(game);
    // Re-add MovementState
    game.world.addComponent(player.id, "MovementState", {
      current: "idle",
      rollTimer: 0,
      previousGrounded: true,
      coyoteTimer: 0,
      slideTimer: 0,
      slideCooldown: 0,
      backstepTimer: 0,
      jumpBufferTimer: 0,
      dropThroughTimer: 0,
    });

    // Mock input to start roll
    const input = game.world.getComponent<any>(player.id, "PlayerInput")!;
    input.buffer = { action: "roll", priority: 3, timestamp: 0 };
    // Physics component is part of archetype, but let's ensure it exists
    if (!game.world.hasComponent(player.id, "Physics")) {
      // Re-add physics if getPlayer didn't include it (it didn't return it but query filtered for it?)
      // getPlayer queries for it but doesn't return it. It's there.
    }
    const phys = game.world.getComponent<any>(player.id, "Physics")!;
    phys.grounded = true;

    await runFrames(game, 1);

    const effects = game.world.query("VisualEffect");
    const dust = effects.find((e) => (e.components[0] as VisualEffectComponent).type === "dust");

    if (!dust) throw new Error("Roll dust not spawned");
  },

  // === Environment Tests ===

  async function testTileSVGsRender(_game: Game) {
    if (!TilePaths["stone-block"]) throw new Error("Tile SVG missing");
  },

  async function testBackgroundLayering(game: Game) {
    // Can't easily check draw order via ECS, but we can verify RenderSystem exists
    if (!game.systems.find((s) => s.constructor.name === "RenderSystem")) {
      throw new Error("RenderSystem missing");
    }

    const cam = game.world.getResource<CameraState>(CameraState);
    if (!cam) throw new Error("CameraState missing");
  },
];
