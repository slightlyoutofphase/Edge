import { Game } from "../core/Game";
import { World } from "../core/World";
import { InputManager } from "../core/Input";
import {
  InputState,
  TimeState,
  CameraState,
  PlayerProgress,
  SpatialGridState,
  CombatEventQueue,
  InteractionState,
  EditorState,
} from "../core/Resources";
import {
  ActiveKeybindings,
  InputAction,
  loadKeybindings,
  saveKeybindings,
} from "../core/InputDefinitions";
import { createPlayer, createEnemy, createPlatform } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { HealthComponent } from "../components/Health";
import { ColliderComponent } from "../components/Collider";
import { StaminaComponent } from "../components/Stamina";
import { InventoryComponent } from "../components/Inventory";
import { PlayerInputComponent } from "../components/PlayerInput";
import { InteractableComponent } from "../components/Interactable";
import { HitStopComponent } from "../components/HitStop";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { PhysicsSystem } from "../features/movement/PhysicsSystem";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { MovementSystem } from "../features/movement/MovementSystem";
import { CombatComponent } from "../features/combat/CombatComponent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { CombatSystem } from "../features/combat/CombatSystem";
import { HitDetectionSystem } from "../features/combat/HitDetectionSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { applyHealthDamage } from "../features/combat/HealthDamage";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { Animation, AnimationEvent } from "../features/animation/AnimationTypes";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { AISystem } from "../features/ai/AISystem";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { CollisionSystem } from "../systems/CollisionSystem";
import { InventorySystem } from "../systems/InventorySystem";
import { InteractionSystem } from "../systems/InteractionSystem";
import { TriggerSystem } from "../systems/TriggerSystem";
import { EffectSystem } from "../systems/EffectSystem";
import { AudioSystem } from "../systems/AudioSystem";
import { AssetLoader } from "../assets/AssetLoader";
import { WEAPONS } from "../data/WeaponDefinitions";
import { LevelData, LEVELS } from "../data/Levels";
import { validateLevelData } from "../data/LevelValidation";
import { Matrix2D } from "../utils/Matrix2D";
import { TestRunner } from "./TestRunner";

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}
function near(actual: number, expected: number) {
  expect(Math.abs(actual - expected) < 0.01, `${actual} != ${expected}`);
}
function worldFixture() {
  const world = new World();
  world.setResource(TimeState, Object.assign(new TimeState(), { delta: 16 }));
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(PlayerProgress, new PlayerProgress());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  world.setResource(InteractionState, new InteractionState());
  world.setResource(NavigationGraph, new NavigationGraph());
  return world;
}
function actor(world: World, x = 50, y = 80) {
  const id = createPlayer(world, x, y);
  return {
    id,
    transform: world.getComponent<TransformComponent>(id, "Transform")!,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
    movement: world.getComponent<MovementStateComponent>(id, "MovementState")!,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
  };
}
const hitData = {
  offset: { x: 14, y: -40 },
  width: 28,
  height: 20,
  damage: 20,
  poiseDamage: 20,
  knockback: { x: 0, y: 0 },
  zone: 2,
  attackType: "light",
};
function animationActor(world: World, events: AnimationEvent[], loop = false) {
  const a = actor(world);
  world.removeComponent(a.id, "MovementState");
  world.removeComponent(a.id, "Combat");
  const name = "audit-regression-animation";
  AssetLoader.registerAnimation(name, {
    name,
    duration: 100,
    loop,
    keyframes: [],
    events,
  } as Animation);
  a.animator.currentAnim = name;
  a.animator.time = 0;
  return a;
}
function emptyLevel(): LevelData {
  return {
    id: "audit-test",
    width: 1000,
    height: 800,
    startPos: { x: 100, y: 400 },
    tiles: [],
    enemies: [],
    checkpoints: [],
    triggers: [],
    interactables: [],
  };
}

export const tests = [
  async function testPlatformInteriorNeverGrounds() {
    const world = worldFixture(),
      a = actor(world, 50, 140);
    createPlatform(world, 0, 100, 200, 64, "semisolid");
    const physics = new PhysicsSystem(world),
      collisions = new CollisionSystem(world);
    for (let i = 0; i < 30; i++) {
      physics.update();
      collisions.update();
      expect(!a.physics.grounded, "An actor inside/below the one-way surface was grounded");
    }
    expect(a.transform.position.y > 200, "Actor remained suspended inside the platform");
  },
  async function testFastOneWayLandingUsesSurface() {
    const world = worldFixture(),
      a = actor(world, 50, 180);
    a.physics.previousPosition = { x: 50, y: 80 };
    a.physics.velocity.y = 900;
    createPlatform(world, 0, 100, 200, 16, "semisolid");
    new CollisionSystem(world).update();
    near(a.transform.position.y, 100);
    near(a.physics.velocity.y, 0);
    expect(a.physics.grounded, "Crossed surface did not ground the actor");
  },
  async function testOneWayAllowsUpwardPassage() {
    const world = worldFixture(),
      a = actor(world, 50, 90);
    a.physics.previousPosition = { x: 50, y: 150 };
    a.physics.velocity.y = -500;
    createPlatform(world, 0, 100, 200, 64, "semisolid");
    new CollisionSystem(world).update();
    near(a.transform.position.y, 90);
    expect(!a.physics.grounded, "Ascending actor was grounded");
  },
  async function testOneWayDropThroughDoesNotLand() {
    const world = worldFixture(),
      a = actor(world, 50, 120);
    a.physics.previousPosition = { x: 50, y: 100 };
    a.physics.velocity.y = 100;
    a.movement.dropThroughTimer = 200;
    createPlatform(world, 0, 100, 200, 64, "semisolid");
    new CollisionSystem(world).update();
    near(a.transform.position.y, 120);
    expect(!a.physics.grounded, "Drop-through was cancelled by collision");
  },
  async function testFastMotionCannotCrossSolidWall() {
    const world = worldFixture(),
      a = actor(world, 300, 80);
    a.physics.previousPosition = { x: 0, y: 80 };
    a.physics.velocity.x = 3000;
    createPlatform(world, 150, 0, 16, 200, "solid");
    new CollisionSystem(world).update();
    near(a.transform.position.x, 143);
    near(a.physics.velocity.x, 0);
  },
  async function testFastMotionCannotCrossCeiling() {
    const world = worldFixture(),
      a = actor(world, 50, 80);
    a.physics.previousPosition = { x: 50, y: 200 };
    a.physics.velocity.y = -1500;
    createPlatform(world, 0, 100, 200, 16, "solid");
    new CollisionSystem(world).update();
    near(a.transform.position.y, 180);
    near(a.physics.velocity.y, 0);
  },
  async function testFirstSurfaceWinsRegardlessOfInsertionOrder() {
    const world = worldFixture(),
      a = actor(world, 50, 250);
    a.physics.previousPosition = { x: 50, y: 50 };
    a.physics.velocity.y = 1000;
    createPlatform(world, 0, 200, 200, 16, "solid");
    createPlatform(world, 0, 100, 200, 16, "solid");
    new CollisionSystem(world).update();
    near(a.transform.position.y, 100);
    expect(a.physics.grounded, "Actor did not rest on the first surface");
  },
  async function testLargeDeltaFrictionCannotReverseMotion() {
    const world = worldFixture(),
      a = actor(world);
    world.getResource<TimeState>(TimeState).delta = 250;
    a.physics.grounded = true;
    a.physics.velocity.x = 100;
    new PhysicsSystem(world).update();
    expect(
      a.physics.velocity.x >= 0 && a.physics.velocity.x <= 100,
      "Friction reversed or accelerated motion",
    );
  },
  async function testStationaryClimbHasNoGravity() {
    const world = worldFixture(),
      a = actor(world);
    a.movement.current = "climb";
    new PhysicsSystem(world).update();
    near(a.physics.velocity.y, 0);
    near(a.transform.position.y, 80);
  },
  async function testFrozenSecondActorCannotBeSeparated() {
    const world = worldFixture(),
      first = actor(world, 50, 80),
      second = actor(world, 52, 80);
    world.addComponent(second.id, "HitStop", { frames: 6, remainingMs: 100 } as HitStopComponent);
    new CollisionSystem(world).update();
    near(second.transform.position.x, 52);
    expect(first.transform.position.x < 50, "An unfrozen actor remained inside the frozen actor");
  },
  async function testHitStopDoesNotFreezeOtherAnimations() {
    const world = worldFixture(),
      first = actor(world),
      second = actor(world, 200, 80);
    world.addComponent(first.id, "HitStop", { frames: 6 } as HitStopComponent);
    new AnimationSystem(world).update();
    near(first.animator.time, 0);
    expect(second.animator.time > 0, "Later actor's animation was skipped");
  },
  async function testHitStopFreezesMovementAndCombatTimers() {
    const world = worldFixture(),
      a = actor(world);
    a.combat.attackState = "windup";
    a.combat.attackTimer = 100;
    a.movement.rollTimer = 50;
    world.getResource<InputState>(InputState).keysDown.add("KeyD");
    world.addComponent(a.id, "HitStop", { frames: 6 } as HitStopComponent);
    new CombatSystem(world).update();
    new MovementSystem(world).update();
    new PhysicsSystem(world).update();
    near(a.combat.attackTimer, 100);
    near(a.movement.rollTimer, 50);
    near(a.transform.position.x, 50);
  },
  async function testHitStopDurationUsesElapsedTime(game: Game) {
    game.world.addComponent(game.playerId, "HitStop", {
      frames: 6,
      remainingMs: 100,
    } as HitStopComponent);
    game.update(99);
    expect(game.world.hasComponent(game.playerId, "HitStop"), "Hitstop ended before 100ms");
    game.update(1);
    expect(!game.world.hasComponent(game.playerId, "HitStop"), "Hitstop outlasted 100ms");
  },
  async function testUnsortedEventsEndHitbox() {
    const world = worldFixture();
    const a = animationActor(world, [
      { time: 0.9, type: "sound", data: "audit-end" },
      { time: 0.2, type: "hitbox-start", data: hitData },
      { time: 0.5, type: "hitbox-end" },
    ]);
    world.getResource<TimeState>(TimeState).delta = 100;
    new AnimationSystem(world).update();
    expect(!world.hasComponent(a.id, "ActiveHitbox"), "Unsorted end event left a live hitbox");
    expect(
      a.animator.pendingEvents.map((e) => e.type).join() === "hitbox-start,hitbox-end,sound",
      "Events were not chronological",
    );
  },
  async function testLoopBoundaryEventsFireOnce() {
    const world = worldFixture(),
      a = animationActor(
        world,
        [
          { time: 0.1, type: "sound", data: "audit-start" },
          { time: 0.9, type: "sound", data: "audit-end" },
        ],
        true,
      );
    a.animator.time = 85;
    world.getResource<TimeState>(TimeState).delta = 30;
    const system = new AnimationSystem(world);
    system.update();
    expect(a.animator.pendingEvents.length === 2, "Loop boundary missed or duplicated an event");
    world.getResource<TimeState>(TimeState).delta = 10;
    system.update();
    expect(a.animator.pendingEvents.length === 0, "Old events survived or fired twice");
  },
  async function testPendingEventsRemainBounded() {
    const world = worldFixture(),
      a = animationActor(world, [{ time: 0.5, type: "sound", data: "audit-step" }], true);
    const system = new AnimationSystem(world);
    for (let i = 0; i < 1000; i++) {
      system.update();
      expect(a.animator.pendingEvents.length <= 1, "Event history accumulated");
    }
  },
  async function testWeaponStatsDriveHitboxes() {
    for (const weapon of Object.values(WEAPONS)) {
      const world = worldFixture(),
        a = animationActor(world, [{ time: 0, type: "hitbox-start", data: hitData }]);
      world.getComponent<InventoryComponent>(a.id, "Inventory")!.currentWeapon = weapon.id;
      new AnimationSystem(world).update();
      const hitbox = world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
      near(hitbox.damage, weapon.baseDamage);
      near(hitbox.width, weapon.reach);
      near(hitbox.poiseDamage, weapon.poiseDamageLight);
    }
  },
  async function testAttackPhasesMatchHitboxLifetime() {
    for (const weaponId of ["dagger", "greatsword"]) {
      const world = worldFixture(),
        a = actor(world);
      world.getComponent<InventoryComponent>(a.id, "Inventory")!.currentWeapon = weaponId;
      world.getComponent<PlayerInputComponent>(a.id, "PlayerInput")!.buffer = {
        action: "lightAttack",
        priority: 1,
        timestamp: 0,
      };
      const combat = new CombatSystem(world),
        animation = new AnimationSystem(world);
      world.getResource<TimeState>(TimeState).delta = 1;
      combat.update();
      animation.update();
      let activeFrames = 0;
      for (let i = 0; i < 1000 && a.combat.attackState !== "idle"; i++) {
        combat.update();
        animation.update();
        const active = world.hasComponent(a.id, "ActiveHitbox");
        expect(
          active === (a.combat.attackState === "active"),
          "Hitbox disagreed with combat phase",
        );
        if (active) activeFrames++;
      }
      expect(
        Math.abs(activeFrames - (WEAPONS[weaponId].lightAttack.active / 60) * 1000) <= 1,
        "Configured active duration was ignored",
      );
      expect(a.combat.attackState === "idle", "Attack did not finish");
    }
  },
  async function testWeaponSwapIsBlockedDuringAttack() {
    const world = worldFixture(),
      a = actor(world);
    a.combat.attackState = "windup";
    a.combat.attackTimer = 100;
    world.getResource<InputState>(InputState).keysPressed.add("Digit3");
    new InventorySystem(world).update();
    expect(
      world.getComponent<InventoryComponent>(a.id, "Inventory")!.currentWeapon === "longsword",
      "Weapon changed during an attack",
    );
  },
  async function testAttackUsesCapturedWeaponStats() {
    const world = worldFixture(),
      a = actor(world);
    const inventory = world.getComponent<InventoryComponent>(a.id, "Inventory")!;
    world.getComponent<PlayerInputComponent>(a.id, "PlayerInput")!.buffer = {
      action: "lightAttack",
      priority: 1,
      timestamp: 0,
    };
    const combat = new CombatSystem(world),
      animation = new AnimationSystem(world);
    combat.update();
    animation.update();
    inventory.currentWeapon = "greatsword";
    for (let i = 0; i < 20 && !world.hasComponent(a.id, "ActiveHitbox"); i++) {
      combat.update();
      animation.update();
    }
    const hitbox = world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
    expect(!!hitbox, "Attack never became active");
    near(hitbox.damage, WEAPONS.longsword.baseDamage);
    near(hitbox.poiseDamage, WEAPONS.longsword.poiseDamageLight);
  },
  async function testWeaponStabilityChangesGuardCost() {
    const costs: number[] = [];
    for (const weaponId of ["dagger", "greatsword"]) {
      const world = worldFixture(),
        defender = actor(world, 100, 100);
      const attackerId = createEnemy(world, 120, 100, "hollow");
      defender.combat.isBlocking = true;
      defender.combat.blockZone = 2;
      world.getComponent<InventoryComponent>(defender.id, "Inventory")!.currentWeapon = weaponId;
      world.getResource<CombatEventQueue>(CombatEventQueue).events.push({
        attackerId,
        targetId: defender.id,
        damage: 20,
        poiseDamage: 10,
        zone: 2,
        attackType: "light",
        knockback: { x: 0, y: 0 },
        impactPoint: { x: 100, y: 80 },
        isBlockable: true,
      });
      new DamageSystem(world).update();
      costs.push(100 - world.getComponent<StaminaComponent>(defender.id, "Stamina")!.current);
    }
    expect(costs[0] > costs[1] && costs[1] > 0, "Weapon stability did not affect guard cost");
  },
  async function testMirroredBoneHitboxMatchesItsVisibleDirection() {
    for (const facing of [1, -1] as const) {
      for (const angle of [-45, 45]) {
        const world = worldFixture(),
          source = actor(world, 100, 100);
        source.transform.facing = facing;
        source.transform.scale = { x: 2, y: 0.5 };
        const matrix = new Matrix2D(facing * 2, 0, 0, 0.5, 100, 100).rotate(Math.PI / 6);
        world
          .getComponent<SkeletonComponent>(source.id, "Skeleton")!
          .worldTransforms.set("audit-bone", matrix);
        const x = 24 * Math.cos((angle * Math.PI) / 180),
          y = 24 * Math.sin((angle * Math.PI) / 180);
        const target = createEnemy(
          world,
          matrix.a * x + matrix.c * y + 100,
          matrix.b * x + matrix.d * y + 100,
          "hollow",
        );
        const outside = createEnemy(
          world,
          matrix.a * x - matrix.c * y + 100,
          matrix.b * x - matrix.d * y + 100,
          "hollow",
        );
        world.getComponent<ColliderComponent>(target, "Collider")!.hurtboxes = [
          { x: -2, y: -2, width: 4, height: 4 },
        ];
        world.getComponent<ColliderComponent>(outside, "Collider")!.hurtboxes = [
          { x: -2, y: -2, width: 4, height: 4 },
        ];
        // These are point-like math targets, not posed character silhouettes.
        world.removeComponent(target, "Skeleton");
        world.removeComponent(outside, "Skeleton");
        world.addComponent(source.id, "ActiveHitbox", {
          ...hitData,
          offset: { x: 0, y: 0 },
          width: 80,
          height: 8,
          rotation: angle,
          attachedToBone: "audit-bone",
          alreadyHit: new Set(),
          sourceEntityId: source.id,
        } as ActiveHitboxComponent);
        new CollisionSystem(world).update(false);
        new HitDetectionSystem(world).update();
        expect(
          world
            .getResource<CombatEventQueue>(CombatEventQueue)
            .events.some((event) => event.targetId === target),
          "Mirrored hitbox rotated away from the target",
        );
        expect(
          !world
            .getResource<CombatEventQueue>(CombatEventQueue)
            .events.some((event) => event.targetId === outside),
          "Matrix transform caused a false hit",
        );
      }
    }
  },
  async function testFeintRestartsMatchingAnimationAndEvents() {
    const world = worldFixture(),
      player = actor(world, 100, 100),
      id = createEnemy(world, 130, 100, "duelist");
    const ai = world.getComponent<AIControllerComponent>(id, "AIController")!;
    const combat = world.getComponent<CombatComponent>(id, "Combat")!,
      animator = world.getComponent<AnimatorComponent>(id, "Animator")!;
    ai.target = player.id;
    ai.state = "combat";
    ai.wantsToFeint = true;
    combat.attackState = "windup";
    combat.attackType = "light";
    combat.attackZone = 2;
    combat.attackTimer = ai.behaviorParams.windupFrames * 16.66 * 0.5;
    animator.currentAnim = "duelist_light_attack_mid";
    animator.time = 100;
    animator.eventState.set("main_duelist_light_attack_mid", 3);
    new AISystem(world).update();
    expect(
      ai.feintTriggered &&
        (combat.attackZone as number) === 1 &&
        animator.currentAnim === "duelist_light_attack_high",
      "Feint kept the old-zone animation",
    );
    near(animator.time, 0);
    expect(animator.eventState.size === 0, "Feint retained old event state");
  },
  async function testHeavySlideAnimationAndDamage() {
    const world = worldFixture(),
      a = actor(world);
    a.movement.current = "slide";
    a.physics.grounded = true;
    world.getComponent<PlayerInputComponent>(a.id, "PlayerInput")!.buffer = {
      action: "heavyAttack",
      priority: 1,
      timestamp: 0,
    };
    const combat = new CombatSystem(world),
      animation = new AnimationSystem(world);
    combat.update();
    animation.update();
    expect(
      a.animator.currentAnim === "slide_attack_heavy" &&
        !!AssetLoader.getAnimation(a.animator.currentAnim),
      "Heavy slide clip is missing",
    );
    for (let i = 0; i < 20 && !world.hasComponent(a.id, "ActiveHitbox"); i++) {
      combat.update();
      animation.update();
    }
    const hitbox = world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
    expect(!!hitbox && hitbox.attackType === "heavy", "Heavy slide never produced a heavy hitbox");
    near(hitbox.poiseDamage, WEAPONS.longsword.poiseDamageHeavy);
  },
  async function testHazardDeathCancelsAttackExactlyOnce() {
    const world = worldFixture(),
      a = actor(world, 50, 100);
    a.combat.attackState = "windup";
    a.combat.isBlocking = true;
    world.addComponent(a.id, "ActiveHitbox", {
      ...hitData,
      alreadyHit: new Set(),
      sourceEntityId: a.id,
    } as ActiveHitboxComponent);
    createPlatform(world, 0, 100, 200, 32, "hazard", 100);
    new CollisionSystem(world).update();
    expect(
      world.getComponent<HealthComponent>(a.id, "Health")!.isDead,
      "Hazard failed to enter death",
    );
    expect(
      !world.hasComponent(a.id, "ActiveHitbox") &&
        !a.combat.isBlocking &&
        (a.combat.attackState as string) === "idle",
      "Dead actor retained combat",
    );
    near(a.animator.time, 0);
    expect(a.animator.currentAnim === "death", "Death animation did not start");
    applyHealthDamage(world, a.id, 100);
    expect(
      world.getComponent<{ requests: unknown[] }>(a.id, "SoundRequest")!.requests.length === 1,
      "Death was emitted twice",
    );
  },
  async function testHazardCooldownIsPerOccupant() {
    const world = worldFixture(),
      a = actor(world, 30, 100),
      b = actor(world, 150, 100);
    createPlatform(world, 0, 100, 200, 32, "hazard", 10);
    const collisions = new CollisionSystem(world);
    collisions.update();
    near(world.getComponent<HealthComponent>(a.id, "Health")!.current, 90);
    near(world.getComponent<HealthComponent>(b.id, "Health")!.current, 90);
    collisions.update();
    near(world.getComponent<HealthComponent>(a.id, "Health")!.current, 90);
  },
  async function testImpossibleAndObstructedJumpsAreRejected() {
    const world = worldFixture(),
      nav = world.getResource<NavigationGraph>(NavigationGraph);
    createPlatform(world, 0, 400, 200, 32, "solid");
    createPlatform(world, 180, 300, 200, 32, "solid");
    nav.build(world);
    expect(
      nav.findPath({ x: 100, y: 400 }, { x: 280, y: 300 }).length === 0,
      "Impossible 100px rise was connected",
    );
    for (const id of world.getAllEntities()) world.destroyEntity(id);
    createPlatform(world, 0, 400, 200, 32, "solid");
    createPlatform(world, 240, 400, 200, 32, "solid");
    createPlatform(world, 195, 200, 50, 200, "solid");
    nav.build(world);
    expect(
      nav.findPath({ x: 100, y: 400 }, { x: 340, y: 400 }).length === 0,
      "Jump crossed a wall",
    );
  },
  async function testFallPathRetainsDropThroughAction() {
    const world = worldFixture(),
      nav = world.getResource<NavigationGraph>(NavigationGraph);
    createPlatform(world, 0, 200, 200, 16, "semisolid");
    createPlatform(world, 0, 400, 200, 32, "solid");
    nav.build(world);
    const path = nav.findPath({ x: 100, y: 200 }, { x: 100, y: 400 });
    expect(
      path.some((step) => step.action === "fall" && step.dropThrough && !!step.takeoff),
      "Fall action was lost in path reconstruction",
    );
  },
  async function testEnemyExecutesReachableSolidLedgeDescent() {
    const world = worldFixture(),
      player = actor(world, 100, 400);
    createPlatform(world, 0, 200, 200, 16, "solid");
    createPlatform(world, -100, 400, 400, 32, "solid");
    const id = createEnemy(world, 100, 200, "hollow"),
      ai = world.getComponent<AIControllerComponent>(id, "AIController")!;
    ai.state = "combat";
    ai.target = player.id;
    ai.hasAttackToken = true;
    world.getComponent<PhysicsComponent>(id, "Physics")!.grounded = true;
    world.getResource<NavigationGraph>(NavigationGraph).build(world);
    const systems = [
      new AISystem(world),
      new CombatSystem(world),
      new MovementSystem(world),
      new PhysicsSystem(world),
      new CollisionSystem(world),
    ];
    for (let i = 0; i < 250; i++) {
      for (const system of systems) system.update();
      if (
        world.getComponent<PhysicsComponent>(id, "Physics")!.grounded &&
        world.getComponent<TransformComponent>(id, "Transform")!.position.y > 390
      )
        return;
    }
    throw new Error("Enemy stalled at a reachable solid ledge");
  },
  async function testEnemyExecutesFeasibleGapJump() {
    const world = worldFixture(),
      player = actor(world, 350, 400);
    createPlatform(world, 0, 400, 200, 32, "solid");
    createPlatform(world, 240, 400, 200, 32, "solid");
    const id = createEnemy(world, 100, 400, "hollow"),
      ai = world.getComponent<AIControllerComponent>(id, "AIController")!;
    ai.state = "combat";
    ai.target = player.id;
    ai.hasAttackToken = true;
    world.getComponent<PhysicsComponent>(id, "Physics")!.grounded = true;
    world.getResource<NavigationGraph>(NavigationGraph).build(world);
    const systems = [
      new AISystem(world),
      new CombatSystem(world),
      new MovementSystem(world),
      new PhysicsSystem(world),
      new CollisionSystem(world),
    ];
    for (let i = 0; i < 250; i++) {
      for (const system of systems) system.update();
      const transform = world.getComponent<TransformComponent>(id, "Transform")!;
      if (
        world.getComponent<PhysicsComponent>(id, "Physics")!.grounded &&
        transform.position.x > 247
      )
        return;
    }
    throw new Error("Enemy failed to execute a reachable gap jump");
  },
  async function testEnemyDoesNotAttackPlayerOnAnotherFloor() {
    const world = worldFixture(),
      player = actor(world, 100, 400);
    const enemyId = createEnemy(world, 100, 200, "hollow");
    const ai = world.getComponent<AIControllerComponent>(enemyId, "AIController")!;
    ai.state = "combat";
    ai.target = player.id;
    ai.hasAttackToken = true;
    ai.pathRecalculateTimer = 1000;
    new AISystem(world).update();
    expect(
      world.getComponent<CombatComponent>(enemyId, "Combat")!.attackState === "idle",
      "Enemy attacked through another floor",
    );
    const facing = world.getComponent<TransformComponent>(enemyId, "Transform")!.facing;
    expect(facing === 1 || facing === -1, "Zero direction collapsed facing");
  },
  async function testDamageRecordsVictimTimestamp() {
    const world = worldFixture(),
      enemyId = createEnemy(world, 100, 200, "hollow");
    world.getResource<TimeState>(TimeState).elapsed = 1234;
    applyHealthDamage(world, enemyId, 10);
    near(world.getComponent<AIControllerComponent>(enemyId, "AIController")!.lastDamageTime!, 1234);
  },
  async function testInventorySurvivesLoadAndRespawn(game: Game) {
    const inventory = game.world.getComponent<InventoryComponent>(game.playerId, "Inventory")!;
    inventory.currentWeapon = "dagger";
    inventory.unlockedWeapons = new Set(["dagger", "longsword"]);
    game.loadLevel("level2");
    game.respawn();
    const restored = game.world.getComponent<InventoryComponent>(game.playerId, "Inventory")!;
    expect(
      restored.currentWeapon === "dagger" && restored.unlockedWeapons.size === 2,
      "Inventory reset during load/respawn",
    );
    expect(
      game.world.getResource<PlayerProgress>(PlayerProgress).currentLevelId === "level2",
      "Level ID was not updated",
    );
  },
  async function testCheckpointIsScopedToLevelAndRestoresFacing(game: Game) {
    game.loadLevel("level2");
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);
    progress.lastCheckpointId = "cp_l2_mid";
    progress.lastCheckpointLevelId = "level2";
    game.loadLevel("level3");
    const position = game.world.getComponent<TransformComponent>(game.playerId, "Transform")!;
    near(position.position.x, LEVELS.level3.startPos.x);
    near(position.position.y, LEVELS.level3.startPos.y);
    const checkpoint = LEVELS.level3.checkpoints[0];
    progress.lastCheckpointId = checkpoint.id;
    progress.lastCheckpointLevelId = "level3";
    game.respawn();
    expect(
      game.world.getComponent<TransformComponent>(game.playerId, "Transform")!.facing ===
        checkpoint.facing,
      "Respawn ignored facing",
    );
  },
  async function testInvalidLevelLoadPreservesWorld(game: Game) {
    const id = game.playerId,
      count = game.world.getAllEntities().length;
    for (const bad of [
      { id: "bad", tiles: [], checkpoints: [] },
      { ...emptyLevel(), tiles: [{ x: 0, y: 0, width: -1, height: 10, type: "solid" }] },
    ]) {
      let rejected = false;
      try {
        game.loadLevelFromData(bad as LevelData);
      } catch {
        rejected = true;
      }
      expect(
        rejected && game.playerId === id && game.world.getAllEntities().length === count,
        "Invalid import destroyed the world",
      );
    }
    let rejected = false;
    try {
      game.loadLevel("missing-level");
    } catch {
      rejected = true;
    }
    expect(
      rejected && game.world.hasComponent(id, "PlayerInput"),
      "Unknown destination destroyed the player",
    );
  },
  async function testLevelSchemaRejectsNonfiniteAndInvalidReferences() {
    for (const data of [
      { ...emptyLevel(), startPos: { x: NaN, y: 0 } },
      { ...emptyLevel(), enemies: [{ x: 0, y: 0, type: "solid" }] },
      {
        ...emptyLevel(),
        triggers: [{ x: 0, y: 0, width: 10, height: 10, type: "transition", target: "missing" }],
      },
    ]) {
      let rejected = false;
      try {
        validateLevelData(data);
      } catch {
        rejected = true;
      }
      expect(rejected, "Invalid level field was accepted");
    }
  },
  async function testEditorPopulationAndIndexingDoNotSimulate(game: Game) {
    const data = emptyLevel();
    data.tiles.push({ x: 0, y: 400, width: 300, height: 32, type: "hazard", damage: 100 });
    data.interactables!.push({
      x: 100,
      y: 400,
      type: "chest",
      prompt: "Open",
      data: { weaponId: "dagger" },
    });
    game.loadLevelFromData(data);
    expect(game.world.hasComponent(game.playerId, "PlayerInput"), "Population left playerId stale");
    const transform = game.world.getComponent<TransformComponent>(game.playerId, "Transform")!;
    new CollisionSystem(game.world).update(false);
    near(transform.position.y, 400);
    near(game.world.getComponent<HealthComponent>(game.playerId, "Health")!.current, 100);
  },
  async function testInvalidEditorGridCannotCreateUnboundedDrawLoop(game: Game) {
    const previousMode = game.editorMode,
      editor = game.world.getResource<EditorState>(EditorState);
    const previousGrid = editor.gridSize,
      previousEnabled = editor.enabled;
    const context = game.canvas.getContext("2d")!,
      lineTo = context.lineTo;
    let lines = 0;
    try {
      game.editorMode = true;
      editor.enabled = true;
      context.lineTo = () => {
        if (++lines > 10000) throw new Error("Unbounded grid drawing");
      };
      for (const value of [-1, 0, NaN, 1e-9, Infinity]) {
        lines = 0;
        editor.gridSize = value;
        game.update(16);
      }
    } finally {
      context.lineTo = lineTo;
      game.editorMode = previousMode;
      editor.gridSize = previousGrid;
      editor.enabled = previousEnabled;
    }
  },
  async function testDirectPopulationResetsAudioAndBattleResources(game: Game) {
    const audio = game.systems.find((system) => system instanceof AudioSystem) as AudioSystem;
    audio.playSound("ui-menu");
    expect(audio.getPoolStats().active > 0, "Audio fixture did not start a voice");
    game.startBattle("hollow", "none", "soldier", "none");
    game.loadLevelFromData(emptyLevel());
    expect(
      !game.battleMode && audio.getPoolStats().active === 0,
      "Direct population retained old session resources",
    );
  },
  async function testChestStatePersistsWithoutBecomingSupport(game: Game) {
    const data = emptyLevel();
    data.interactables!.push({
      x: 100,
      y: 400,
      type: "chest",
      prompt: "Open",
      data: { weaponId: "dagger" },
    });
    game.loadLevelFromData(data);
    game.world.getResource<InputState>(InputState).keysPressed.add("KeyF");
    new InteractionSystem(game.world).update();
    game.loadLevelFromData(data);
    const chest = game.world.query("Interactable")[0];
    expect(
      (chest.components[0] as InteractableComponent).isInteracted,
      "Opened chest reset on reload",
    );
    expect(
      !game.world.getResource<NavigationGraph>(NavigationGraph).nodes.size,
      "Decorative chest became a navigation surface",
    );
  },
  async function testFinalGoalRequiresBossDeathAndDoesNotReload(game: Game) {
    game.loadLevel("level3");
    const goal = LEVELS.level3.triggers.find((t) => t.type === "victory")!;
    const player = game.world.getComponent<TransformComponent>(game.playerId, "Transform")!;
    player.position = { x: goal.x + goal.width / 2, y: goal.y + 70 };
    const trigger = new TriggerSystem(game.world),
      progress = game.world.getResource<PlayerProgress>(PlayerProgress);
    trigger.update();
    expect(!progress.isVictory, "Victory occurred with a living boss");
    for (const { id } of game.world.query("EnemyTag", "Health"))
      applyHealthDamage(game.world, id, 10000);
    trigger.update();
    expect(progress.isVictory, "Final exit did not complete the campaign");
    const id = game.playerId;
    game.update(100);
    expect(
      game.playerId === id && progress.transitionState === "none",
      "Victory reloaded its own level",
    );
  },
  async function testCrouchUsesRemappedBinding() {
    const saved = JSON.parse(JSON.stringify(ActiveKeybindings));
    try {
      saveKeybindings({ ...saved, [InputAction.CROUCH]: { keys: ["KeyC"] } });
      const world = worldFixture(),
        a = actor(world);
      a.physics.grounded = true;
      world.getResource<InputState>(InputState).keysDown.add("KeyC");
      new MovementSystem(world).update();
      expect(a.movement.current === "crouch", "Crouch ignored its own binding");
    } finally {
      saveKeybindings(saved);
    }
  },
  async function testMalformedSavedBindingsFallBack() {
    const stored = localStorage.getItem("edge_keybindings_v1"),
      saved = JSON.parse(JSON.stringify(ActiveKeybindings));
    try {
      localStorage.setItem(
        "edge_keybindings_v1",
        JSON.stringify({
          [InputAction.MOVE_LEFT]: { keys: null },
          [InputAction.BLOCK]: { keys: [], mouseButtons: ["bad"] },
        }),
      );
      loadKeybindings();
      const input = new InputState();
      input.keysDown.add("KeyA");
      expect(input.isActionDown(InputAction.MOVE_LEFT), "Invalid saved binding did not fall back");
      input.isActionDown(InputAction.BLOCK);
    } finally {
      saveKeybindings(saved);
      if (stored === null) localStorage.removeItem("edge_keybindings_v1");
      else localStorage.setItem("edge_keybindings_v1", stored);
    }
  },
  async function testFocusLossClearsHeldAndBufferedInput(game: Game) {
    const input = new InputState(),
      manager = new InputManager(input, game.canvas);
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
      window.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));
      window.dispatchEvent(new Event("blur"));
      manager.update();
      expect(
        input.keysDown.size +
          input.keysPressed.size +
          input.mouseButtons.size +
          input.mouseButtonsPressed.size ===
          0,
        "Blur retained input",
      );
    } finally {
      manager.dispose();
    }
  },
  async function testEffectRequestsDoNotLeaveEmptyEntities() {
    const world = worldFixture(),
      effect = new EffectSystem(world);
    for (let i = 0; i < 50; i++)
      world.addComponent(world.createEntity(), "SpawnEffect", {
        type: "motion_blur",
        position: { x: 0, y: 0 },
      });
    effect.update();
    world.getResource<TimeState>(TimeState).delta = 1000;
    effect.update();
    expect(world.getAllEntities().length === 0, "Consumed effect requests leaked entities");
  },
  async function testAudioWithoutWebAudioIsSafe() {
    const audioCtor = window.AudioContext,
      legacy = (window as any).webkitAudioContext;
    let audio: AudioSystem | undefined;
    try {
      (window as any).AudioContext = undefined;
      (window as any).webkitAudioContext = undefined;
      const world = worldFixture();
      audio = new AudioSystem(world);
      audio.playSound("ui-menu");
      audio.reset();
      world.addComponent(world.createEntity(), "SoundRequest", { requests: [{ id: "ui-menu" }] });
      audio.update();
      expect(audio.getPoolStats().total === 0, "Unavailable audio allocated voices");
      expect(
        world.query("SoundRequest").length === 0 && world.getAllEntities().length === 0,
        "Silent audio retained request entities",
      );
    } finally {
      audio?.dispose();
      (window as any).AudioContext = audioCtor;
      (window as any).webkitAudioContext = legacy;
    }
  },
  async function testAudioResetReusesBoundedPool() {
    const audio = new AudioSystem(worldFixture());
    try {
      const capacity = audio.getPoolStats().total;
      for (let round = 0; round < 10; round++) {
        for (let i = 0; i < 30; i++) audio.playSound("ui-menu");
        expect(audio.getPoolStats().total === capacity, "Audio voices grew beyond the pool");
        audio.reset();
        expect(audio.getPoolStats().active === 0, "Audio reset left active voices");
      }
    } finally {
      audio.dispose();
    }
  },
  async function testAudioTeardownDisconnectsNodesAndClosesContext() {
    const AudioCtor = window.AudioContext;
    let audio: AudioSystem | undefined,
      disconnects = 0,
      closes = 0;
    try {
      window.AudioContext = new Proxy(AudioCtor, {
        construct(target, args) {
          const context = Reflect.construct(target, args) as AudioContext;
          const close = context.close.bind(context);
          context.close = () => {
            closes++;
            return close();
          };
          for (const key of [
            "createGain",
            "createStereoPanner",
            "createOscillator",
            "createBufferSource",
            "createBiquadFilter",
          ] as const) {
            const create = context[key].bind(context);
            (context as any)[key] = () => {
              const node = create() as AudioNode,
                disconnect = node.disconnect.bind(node);
              node.disconnect = () => {
                disconnects++;
                disconnect();
              };
              return node;
            };
          }
          return context;
        },
      });
      audio = new AudioSystem(worldFixture());
      audio.playSound("ui-menu");
      audio.dispose();
      expect(
        disconnects >= 21 && closes === 1,
        "Audio teardown retained connected nodes or its context",
      );
    } finally {
      if (audio?.ctx) audio.dispose();
      window.AudioContext = AudioCtor;
    }
  },
  async function testTestRunnerRestoresRunningAfterResetFailure() {
    const fake = {
      running: true,
      lastTime: 0,
      loop() {},
      resetLevel() {
        throw new Error("expected fixture failure");
      },
    } as unknown as Game;
    let rejected = false;
    try {
      await new TestRunner(fake).runTests();
    } catch {
      rejected = true;
    }
    expect(rejected && fake.running, "Test infrastructure failure left the game stopped");
  },
];
