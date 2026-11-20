import { Game } from "../core/Game";
import { World } from "../core/World";
import {
  BattleState,
  CameraState,
  CombatEventQueue,
  EditorState,
  InputState,
  InteractionState,
  PlayerProgress,
  SpatialGridState,
  TimeState,
} from "../core/Resources";
import { InputManager } from "../core/Input";
import { ActiveKeybindings, InputAction } from "../core/InputDefinitions";
import { AudioSystem } from "../systems/AudioSystem";
import { CameraSystem } from "../systems/CameraSystem";
import { CollisionSystem } from "../systems/CollisionSystem";
import { EffectSystem } from "../systems/EffectSystem";
import { GameModeSystem } from "../systems/GameModeSystem";
import { TriggerSystem } from "../systems/TriggerSystem";
import { CombatSystem } from "../features/combat/CombatSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { CombatComponent } from "../features/combat/CombatComponent";
import { MovementSystem } from "../features/movement/MovementSystem";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { ColliderComponent } from "../components/Collider";
import { InventoryComponent } from "../components/Inventory";
import { PlayerInputComponent } from "../components/PlayerInput";
import { TriggerComponent } from "../components/Trigger";
import { AssetLoader } from "../assets/AssetLoader";
import { AudioDefinitions } from "../assets/audio/AudioDefinitions";
import { ENEMY_STATS } from "../data/EnemyStats";
import { WEAPONS } from "../data/WeaponDefinitions";
import { LEVELS } from "../data/Levels";
import { createEnemy, createPlatform, createPlayer } from "../entities/Archetypes";
import { SpriteCache } from "../utils/SpriteCache";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function createBaseWorld() {
  const world = new World();
  const time = Object.assign(new TimeState(), { delta: 1000 / 60, elapsed: 1000 });
  world.setResource(TimeState, time);
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  world.setResource(PlayerProgress, new PlayerProgress());
  world.setResource(BattleState, new BattleState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(InteractionState, new InteractionState());
  world.setResource(EditorState, new EditorState());
  return { world, time };
}

function testHitStopAndHitFlashFramerateIndependence(_game: Game) {
  const { world, time } = createBaseWorld();
  const effectSystem = new EffectSystem(world);

  // 3 frames at 60fps = 50ms
  time.hitStopFrames = 3;
  assert(
    Math.abs(time.hitStopRemainingMs - 50) < 0.01,
    `Expected 3 frames to equal 50ms, got ${time.hitStopRemainingMs}`,
  );
  time.hitStopRemainingMs -= 1000 / 120; // 1 tick at 120fps (~8.33ms)
  assert(time.hitStopFrames === 3, `Expected hitStopFrames=3 mid-frame, got ${time.hitStopFrames}`);
  time.hitStopRemainingMs -= 42;
  assert(
    (time.hitStopFrames as number) === 0,
    `Expected hitStopFrames=0 after 50ms, got ${time.hitStopFrames}`,
  );

  // HitFlash decays by dtMs
  const flashId = world.createEntity();
  world.addComponent(flashId, "HitFlash", { color: "#fff", frames: 3 });
  time.delta = 25;
  effectSystem.update();
  const flash = world.getComponent<any>(flashId, "HitFlash");
  assert(
    flash && flash.frames === 2,
    `Expected 2 frames remaining after 25ms, got ${flash?.frames}`,
  );
  time.delta = 26;
  effectSystem.update();
  assert(!world.hasComponent(flashId, "HitFlash"), "HitFlash should be removed after >= 50ms");
}

function testGameModeSystemChecksAtElapsedMs(_game: Game) {
  const { world, time } = createBaseWorld();
  const gameMode = new GameModeSystem(world);
  const battle = world.getResource<BattleState>(BattleState);
  battle.isActive = true;

  const red = world.createEntity();
  world.addComponent(red, "Health", { current: 50, max: 50, isDead: false, regenDelay: 0 });
  world.addComponent(red, "Faction", { team: 3 });

  const blue = world.createEntity();
  world.addComponent(blue, "Health", { current: 0, max: 50, isDead: true, regenDelay: 0 });
  world.addComponent(blue, "Faction", { team: 4 });

  time.delta = 250;
  gameMode.update();
  assert(battle.winner === null, "Should not decide battle winner before 500ms elapsed");

  time.delta = 250;
  gameMode.update();
  assert(battle.winner === "RED TEAM", `Expected RED TEAM after 500ms, got ${battle.winner}`);

  gameMode.reset();
  assert(battle.winner === null && !battle.isActive, "GameModeSystem.reset() should clear state");
}

function testMovementSystemLockExitAndZeroPlayerInput(_game: Game) {
  const { world } = createBaseWorld();
  const movement = new MovementSystem(world);
  const input = world.getResource<InputState>(InputState);

  // 1. Unlock transition from roll -> idle + zero horizontal velocity when !playerInput
  const aiId = createEnemy(world, 100, 100, "hollow");
  const aiState = world.getComponent<MovementStateComponent>(aiId, "MovementState")!;
  const aiPhys = world.getComponent<PhysicsComponent>(aiId, "Physics")!;
  const aiAnim = world.getComponent<AnimatorComponent>(aiId, "Animator")!;
  aiState.current = "roll";
  aiPhys.velocity.x = 180;
  aiPhys.grounded = true;
  aiAnim.currentAnim = "idle";

  movement.update();
  assert(
    (aiState.current as string) === "idle",
    `Expected roll to recover to idle, got ${aiState.current}`,
  );
  assert(
    aiPhys.velocity.x === 0,
    `Expected AI velocity.x to zero on idle unlock, got ${aiPhys.velocity.x}`,
  );

  // 2. Player slide lock exit: crouch if holding CROUCH, idle if released
  const playerId = createPlayer(world, 200, 100);
  const pState = world.getComponent<MovementStateComponent>(playerId, "MovementState")!;
  const pPhys = world.getComponent<PhysicsComponent>(playerId, "Physics")!;
  pState.current = "slide";
  pState.slideTimer = 0;
  pPhys.velocity.x = 220;
  pPhys.grounded = true;

  const crouchKey = ActiveKeybindings[InputAction.CROUCH].keys[0];
  input.keysDown.add(crouchKey);
  movement.update();
  assert(
    (pState.current as string) === "crouch",
    `Expected slide with crouch held to recover to crouch, got ${pState.current}`,
  );

  pState.current = "slide";
  input.keysDown.delete(crouchKey);
  movement.update();
  assert(
    (pState.current as string) === "idle",
    `Expected slide without crouch held to recover to idle, got ${pState.current}`,
  );
}

function testCombatInvalidWeaponFallbackAndStaggerClearsSweep(_game: Game) {
  const { world, time } = createBaseWorld();
  const combatSystem = new CombatSystem(world);
  const damageSystem = new DamageSystem(world);

  const player = createPlayer(world, 100, 100);
  const attacker = createPlayer(world, 150, 100);
  const inventory = world.getComponent<InventoryComponent>(player, "Inventory")!;
  inventory.currentWeapon = "does_not_exist";

  const playerInput = world.getComponent<PlayerInputComponent>(player, "PlayerInput")!;
  playerInput.buffer = { action: "lightAttack", timestamp: time.elapsed, priority: 1 };

  combatSystem.update();
  const combat = world.getComponent<CombatComponent>(player, "Combat")!;
  assert(
    combat.attackTiming !== undefined && combat.attackState === "windup",
    `Invalid weapon ID should fall back to longsword and start windup, got ${combat.attackState}`,
  );

  world.addComponent(player, "HitboxSweep", { prevTip: { x: 0, y: 0 }, prevBase: { x: 0, y: 0 } });
  combat.animationDelta = 5;

  const queue = world.getResource<CombatEventQueue>(CombatEventQueue);
  queue.events.push({
    attackerId: attacker,
    targetId: player,
    damage: 10,
    poiseDamage: combat.poise + 50,
    knockback: { x: 50, y: 0 },
    zone: 1,
    attackType: "light",
    impactPoint: { x: 100, y: 100 },
    isBlockable: true,
    contactType: "body",
  });
  damageSystem.update();

  assert(
    (combat.attackState as string) === "stagger",
    `Expected stagger state, got ${combat.attackState}`,
  );
  assert(combat.attackTiming === undefined, "applyStagger must clear attackTiming");
  assert(combat.animationDelta === undefined, "applyStagger must clear animationDelta");
  assert(!world.hasComponent(player, "HitboxSweep"), "applyStagger must remove HitboxSweep");
}

function testTriggerAndCameraRespectHurtboxOffsetAndEmptyHurtboxes(_game: Game) {
  const { world, time } = createBaseWorld();
  time.delta = 1000 / 60;
  const triggerSystem = new TriggerSystem(world);
  const cameraSystem = new CameraSystem(world);

  createPlayer(world, 100, 200);
  const cam = world.getResource<CameraState>(CameraState);
  cam.viewport = { x: 800, y: 600 };

  // Empty hurtbox trigger must not throw
  const emptyTrig = world.createEntity();
  world.addComponent(emptyTrig, "Transform", {
    position: { x: 100, y: 200 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  });
  world.addComponent(emptyTrig, "Collider", {
    layer: 16,
    mask: 2,
    hurtboxes: [],
    hitboxes: [],
  } as ColliderComponent);
  world.addComponent(emptyTrig, "Trigger", {
    type: "camera_lock",
    isActive: true,
    oneshot: true,
    triggered: false,
    bounds: { min: { x: 0, y: 0 }, max: { x: 500, y: 500 } },
  } as TriggerComponent);

  triggerSystem.update();
  cameraSystem.update();
  assert(cam.bounds === null, "Empty-hurtbox trigger should not lock camera");

  // Offset hurtbox trigger (transform at 0,0; hurtbox overlaps player at x:80..140, y:120..220)
  const offsetTrig = world.createEntity();
  world.addComponent(offsetTrig, "Transform", {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  });
  world.addComponent(offsetTrig, "Collider", {
    layer: 16,
    mask: 2,
    hurtboxes: [{ x: 80, y: 120, width: 60, height: 100 }],
    hitboxes: [],
  } as ColliderComponent);
  const bounds = { min: { x: 0, y: 0 }, max: { x: 1000, y: 800 } };
  world.addComponent(offsetTrig, "Trigger", {
    type: "camera_lock",
    isActive: true,
    oneshot: true,
    triggered: false,
    bounds,
  } as TriggerComponent);

  cameraSystem.update();
  assert(cam.bounds === bounds, "CameraSystem must respect hurtbox offset in actorBounds");

  cam.bounds = null;
  triggerSystem.update();
  assert(cam.bounds === bounds, "TriggerSystem must respect hurtbox offset in actorBounds");
}

function testWorldEntityDestroyPrunesCollisionCooldowns(_game: Game) {
  const { world } = createBaseWorld();
  const collision = new CollisionSystem(world);
  const e1 = createPlayer(world, 100, 100);
  const haz = createPlatform(world, 90, 90, 40, 20, "hazard", 10);

  const map = (collision as any).hazardCooldowns as Map<number, Map<number, number>>;
  map.set(e1, new Map([[haz, 9999]]));
  assert(map.has(e1), "Expected cooldown entry before destroyEntity");

  world.destroyEntity(e1);
  assert(!map.has(e1), "Destroying actor must remove hazardCooldowns entry");

  const e2 = createPlayer(world, 300, 100);
  map.set(e2, new Map([[haz, 9999]]));
  world.destroyEntity(haz);
  assert(!map.get(e2)?.has(haz), "Destroying hazard must prune inner hazardCooldowns entry");

  const empty = world.createEntity();
  assert(world.isEmptyEntity(empty), "New entity with no components must be empty");
  world.addComponent(empty, "Transform", {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  });
  assert(!world.isEmptyEntity(empty), "Entity with Transform must not be empty");
}

async function testAssetLoaderResetAllRestoresMutatedData(_game: Game) {
  const origHp = ENEMY_STATS.hollow.health;
  const origDmg = WEAPONS.longsword.baseDamage;
  const origIdleEvents = JSON.stringify(AssetLoader.getAnimation("idle")?.events ?? []);

  ENEMY_STATS.hollow.health = 9999;
  WEAPONS.longsword.baseDamage = 9999;
  const idle = AssetLoader.getAnimation("idle");
  if (idle) {
    if (!idle.events) idle.events = [];
    idle.events.push({ time: 0.5, type: "sound", data: "test-marker" });
  }

  AssetLoader.resetAll();
  await AssetLoader.loadAll();

  assert(
    ENEMY_STATS.hollow.health === origHp,
    `Expected hollow HP restored to ${origHp}, got ${ENEMY_STATS.hollow.health}`,
  );
  assert(
    WEAPONS.longsword.baseDamage === origDmg,
    `Expected longsword damage restored to ${origDmg}, got ${WEAPONS.longsword.baseDamage}`,
  );
  assert(
    JSON.stringify(AssetLoader.getAnimation("idle")?.events ?? []) === origIdleEvents,
    "Expected idle animation events restored to baseline",
  );
}

function testSpriteCacheBoundsForComplexSvgCommands(_game: Game) {
  const boundsHVC = SpriteCache.getBounds("M 10 20 H 50 V 60 C 50 80 70 80 70 60 Z");
  assert(
    boundsHVC.x === 6 && boundsHVC.y === 16 && boundsHVC.width >= 68 && boundsHVC.height >= 48,
    `Unexpected H/V/C bounds: ${JSON.stringify(boundsHVC)}`,
  );

  // Relative arc command with packed flags (01)
  const boundsArc = SpriteCache.getBounds("M 0 0 a 10 20 0 0120 0");
  assert(
    Number.isFinite(boundsArc.x) &&
      Number.isFinite(boundsArc.y) &&
      boundsArc.width >= 20 &&
      boundsArc.height >= 16,
    `Unexpected arc bounds with packed flags: ${JSON.stringify(boundsArc)}`,
  );

  const boundsQST = SpriteCache.getBounds("M 0 0 Q 20 -30 40 0 T 80 0 S 100 30 120 0");
  assert(
    boundsQST.width >= 120 && boundsQST.height >= 20,
    `Unexpected Q/T/S bounds: ${JSON.stringify(boundsQST)}`,
  );
}

function testNavigationGraphSpatialQueryAndBinaryHeapPathfinding(_game: Game) {
  const { world } = createBaseWorld();
  createPlatform(world, 0, 500, 320, 32, "solid");
  createPlatform(world, 80, 484, 16, 16, "solid"); // Low solid curb blocking walk near x=80..96
  createPlatform(world, 280, 440, 320, 32, "semisolid");
  createPlatform(world, 560, 380, 320, 32, "semisolid");

  const nav = new NavigationGraph();
  nav.build(world);

  // 1) Local hop over low curb using terrainGrid.query (60 -> 115, dx=55px within 75px jump range)
  const hopPath = nav.findPath({ x: 60, y: 500 }, { x: 115, y: 500 });
  assert(
    hopPath.some((step) => step.action === "jump"),
    `Expected jump hop over solid curb, got ${JSON.stringify(hopPath)}`,
  );

  // 2) Multi-hop binary-heap A* path across upper platforms (x=300 -> x=840)
  assert(nav.nodes.size >= 9, `Expected >=9 nav nodes, got ${nav.nodes.size}`);
  const path = nav.findPath({ x: 300, y: 500 }, { x: 840, y: 380 });
  assert(path.length >= 3, `Expected multi-hop A* path, got ${path.length}`);
  assert(
    path[path.length - 1].y <= 390,
    `Expected destination near upper platform, got y=${path[path.length - 1].y}`,
  );
}

async function testAudioSystemPanningZeroFreqEndAndUnlockRetry(_game: Game) {
  const { world } = createBaseWorld();
  const camera = world.getResource<CameraState>(CameraState);
  camera.position = { x: 500, y: 300 };
  camera.viewport = { x: 800, y: 600 };
  camera.zoom = 2.0; // halfViewW = 200

  let resumeAttempts = 0;
  let panValue = 0;
  let usedLinearRampForZero = false;
  let state: "suspended" | "running" = "suspended";

  const makeParam = (onLinear?: (v: number) => void, onExp?: (v: number) => void) => ({
    value: 0,
    cancelScheduledValues: () => {},
    setValueAtTime: (v: number) => {
      onLinear?.(v);
    },
    linearRampToValueAtTime: (v: number) => {
      onLinear?.(v);
    },
    exponentialRampToValueAtTime: (v: number) => {
      if (v <= 0) throw new Error("exponentialRampToValueAtTime called with <= 0");
      onExp?.(v);
    },
  });

  const fakeAudioCtx = {
    get state() {
      return state;
    },
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume: async () => {
      resumeAttempts++;
      if (resumeAttempts >= 2) state = "running";
    },
    close: async () => {},
    createGain: () => ({
      gain: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
    createStereoPanner: () => ({
      pan: makeParam((v) => {
        panValue = v;
      }),
      connect: () => {},
      disconnect: () => {},
    }),
    createOscillator: () => ({
      type: "sine",
      frequency: makeParam((v) => {
        if (v === 0) usedLinearRampForZero = true;
      }),
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      onended: null as any,
    }),
    createBiquadFilter: () => ({
      type: "lowpass",
      frequency: makeParam(),
      connect: () => {},
      disconnect: () => {},
    }),
    createBuffer: (_c: number, len: number) => ({
      getChannelData: () => new Float32Array(len),
    }),
    createBufferSource: () => ({
      buffer: null,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
      onended: null as any,
    }),
  };

  const prevAudioCtor = (window as any).AudioContext;
  (window as any).AudioContext = function () {
    return fakeAudioCtx;
  };

  const tempId = "__test_zero_freq_end__";
  (AudioDefinitions as Record<string, any>)[tempId] = {
    id: tempId,
    type: "oscillator",
    oscType: "sine",
    frequencyStart: 220,
    frequencyEnd: 0,
    duration: 100,
    volume: 0.5,
    priority: 1,
  };

  const audio = new AudioSystem(world);
  try {
    // 1) Panning calculation: position.x = 600, camera.x = 500, halfViewW = 200 -> pan = +0.5
    audio.playSound(tempId, 1.0, 1.0, { x: 600, y: 300 });
    assert(
      Math.abs(panValue - 0.5) < 0.01,
      `Expected stereo pan +0.5 relative to camera, got ${panValue}`,
    );
    assert(
      usedLinearRampForZero,
      "Expected frequencyEnd=0 to use linearRampToValueAtTime instead of throwing",
    );

    // 2) Unlock listener stays attached after failed/suspended first resume and cleans up on second
    const attempts = () => resumeAttempts;
    window.dispatchEvent(new MouseEvent("click"));
    await Promise.resolve();
    assert(attempts() === 1, `Expected 1 resume attempt, got ${attempts()}`);

    window.dispatchEvent(new MouseEvent("click"));
    await Promise.resolve();
    assert(attempts() === 2, `Expected 2nd click to trigger resume, got ${attempts()}`);

    window.dispatchEvent(new MouseEvent("click"));
    await Promise.resolve();
    assert(
      attempts() === 2,
      `Expected unlock listener removed once state=running, got ${attempts()}`,
    );
  } finally {
    audio.dispose();
    delete (AudioDefinitions as Record<string, any>)[tempId];
    (window as any).AudioContext = prevAudioCtor;
  }
}

function testInputManagerZeroCanvasAndKeyboardCaptureToggle(game: Game) {
  const prevCapture = game.inputManager.captureKeyboard;
  game.inputManager.captureKeyboard = false;
  const inputState = new InputState();
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

  const manager = new InputManager(inputState, canvas);
  try {
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 120, clientY: 90 }));
    assert(
      Number.isFinite(inputState.mousePosition.x) && Number.isFinite(inputState.mousePosition.y),
      "mousePosition must stay finite on 0x0 canvas",
    );

    manager.captureKeyboard = false;
    const disabledEv = new KeyboardEvent("keydown", { code: "KeyD", cancelable: true });
    window.dispatchEvent(disabledEv);
    assert(
      !inputState.keysDown.has("KeyD") && !disabledEv.defaultPrevented,
      "Disabled captureKeyboard should not capture or preventDefault KeyD",
    );

    manager.captureKeyboard = true;
    const enabledEv = new KeyboardEvent("keydown", { code: "KeyD", cancelable: true });
    window.dispatchEvent(enabledEv);
    assert(
      inputState.keysDown.has("KeyD") && enabledEv.defaultPrevented,
      "Enabled captureKeyboard should capture and preventDefault KeyD",
    );
  } finally {
    manager.dispose();
    game.inputManager.captureKeyboard = prevCapture;
  }
}

function testCoalescedTowerLevelsCoverageAndStoneFloorRows(_game: Game) {
  for (const levelId of ["level2", "level3"] as const) {
    const tiles = LEVELS[levelId].tiles;
    assert(
      tiles.length <= 70,
      `Expected coalesced ${levelId} tile count <= 70, got ${tiles.length}`,
    );
    for (const tile of tiles) {
      if (tile.asset === "stone-floor" && tile.y < 1504) {
        assert(
          tile.height === 32,
          `${levelId} stone-floor tile at (${tile.x},${tile.y}) must remain height=32, got ${tile.height}`,
        );
      }
    }
  }
}

export const tests = [
  testHitStopAndHitFlashFramerateIndependence,
  testGameModeSystemChecksAtElapsedMs,
  testMovementSystemLockExitAndZeroPlayerInput,
  testCombatInvalidWeaponFallbackAndStaggerClearsSweep,
  testTriggerAndCameraRespectHurtboxOffsetAndEmptyHurtboxes,
  testWorldEntityDestroyPrunesCollisionCooldowns,
  testAssetLoaderResetAllRestoresMutatedData,
  testSpriteCacheBoundsForComplexSvgCommands,
  testNavigationGraphSpatialQueryAndBinaryHeapPathfinding,
  testAudioSystemPanningZeroFreqEndAndUnlockRetry,
  testInputManagerZeroCanvasAndKeyboardCaptureToggle,
  testCoalescedTowerLevelsCoverageAndStoneFloorRows,
];
