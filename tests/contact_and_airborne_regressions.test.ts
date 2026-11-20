import { World } from "../core/World";
import { Game } from "../core/Game";
import {
  TimeState,
  InputState,
  CameraState,
  SpatialGridState,
  CombatEventQueue,
  CombatDirectorState,
  BattleState,
} from "../core/Resources";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { AssetLoader } from "../assets/AssetLoader";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { CombatComponent } from "../features/combat/CombatComponent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { HitEvent } from "../features/combat/HitEvent";
import { HitDetectionSystem } from "../features/combat/HitDetectionSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { CombatSystem } from "../features/combat/CombatSystem";
import { actorContacts, updateActorContacts } from "../features/combat/ContactGeometry";
import { CollisionSystem } from "../systems/CollisionSystem";
import { MovementSystem } from "../features/movement/MovementSystem";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { BruteStrategy, BossStrategy, SoldierStrategy } from "../features/ai/EnemyStrategies";
import { animationCanReach, canAttackTarget } from "../features/ai/CombatReach";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { FactionComponent } from "../components/Faction";
import { TransformComponent } from "../components/Transform";
import { PlayerInputComponent } from "../components/PlayerInput";
import { Matrix2D } from "../utils/Matrix2D";
import { PLAYER_STATS } from "../core/Constants";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function fixture(
  type: "brute" | "boss" | "soldier" = "soldier",
  playerTarget = false,
  distance = 50,
) {
  const world = new World(),
    time = Object.assign(new TimeState(), { delta: 16, elapsed: 1000 });
  world.setResource(TimeState, time);
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  world.setResource(CombatDirectorState, new CombatDirectorState());
  world.setResource(BattleState, new BattleState());
  createPlatform(world, -500, 0, 1000, 40, "solid");
  const nav = new NavigationGraph();
  nav.build(world);
  world.setResource(NavigationGraph, nav);
  const id = createEnemy(world, 0, 0, type),
    target = playerTarget
      ? createPlayer(world, distance, 0)
      : createEnemy(world, distance, 0, "soldier");
  for (const [actor, facing, team] of [
    [id, 1, 3],
    [target, -1, 4],
  ]) {
    world.getComponent<TransformComponent>(actor, "Transform")!.facing = facing as 1 | -1;
    world.getComponent<FactionComponent>(actor, "Faction")!.team = team;
    world.getComponent<PhysicsComponent>(actor, "Physics")!.grounded = true;
  }
  const ai = world.getComponent<AIControllerComponent>(id, "AIController")!;
  Object.assign(ai, {
    target,
    state: "combat",
    attackCooldownTimer: 0,
    attackDecisionTimer: 0,
    hasAttackToken: true,
    flankTimer: 10000,
  });
  const animation = new AnimationSystem(world),
    bones = new SkeletonSystem(world),
    collision = new CollisionSystem(world),
    hits = new HitDetectionSystem(world),
    damage = new DamageSystem(world);
  animation.update();
  bones.update();
  collision.update(false);
  return {
    world,
    id,
    target,
    ai,
    time,
    animation,
    bones,
    collision,
    hits,
    damage,
    queue: world.getResource<CombatEventQueue>(CombatEventQueue),
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    targetCombat: world.getComponent<CombatComponent>(target, "Combat")!,
    transform: world.getComponent<TransformComponent>(id, "Transform")!,
    targetTransform: world.getComponent<TransformComponent>(target, "Transform")!,
    targetHealth: world.getComponent<HealthComponent>(target, "Health")!,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
  };
}
function attack(a: ReturnType<typeof fixture>, x: number, y = -30, width = 2) {
  const hb: ActiveHitboxComponent = {
    sourceEntityId: a.id,
    offset: { x, y },
    width,
    height: 2,
    rotation: 0,
    damage: 20,
    poiseDamage: 10,
    zone: 2,
    attackType: "light",
    knockback: { x: 100, y: 0 },
    alreadyHit: new Set(),
  };
  a.combat.attackState = "active";
  a.combat.attackType = "light";
  a.combat.attackSerial = 10;
  a.world.addComponent(a.id, "ActiveHitbox", hb);
  return hb;
}
function hit(a: ReturnType<typeof fixture>, target = a.target, time = 0.2): HitEvent {
  return {
    attackerId: a.id,
    targetId: target,
    damage: 20,
    poiseDamage: 10,
    zone: 2,
    attackType: "light",
    knockback: { x: 100, y: 0 },
    impactPoint: { x: 25, y: -30 },
    isBlockable: true,
    attackSerial: 10,
    contactTime: time,
  };
}

function campaignReplay(
  game: Game,
  type: "brute" | "boss" | "soldier",
  mode: "crowd" | "low_cover" | "jump",
) {
  const systems = game.systems,
    battleMode = game.battleMode;
  game.systems = systems.filter(
    (s) => !["RenderSystem", "UISystem", "AudioSystem"].includes(s.constructor.name),
  );
  try {
    game.startBattle(type, "none", "soldier", "none");
    game.battleMode = false;
    const world = game.world,
      enemy = world
        .query("EnemyTag", "Faction")
        .find((e) => (e.components[1] as FactionComponent).team === 3)!.id;
    for (const actor of world.query("Health"))
      if (actor.id !== enemy) world.destroyEntity(actor.id);
    world.getResource<BattleState>(BattleState).isActive = false;
    const player = createPlayer(world, 550, 704);
    game.playerId = player;
    world.getComponent<FactionComponent>(enemy, "Faction")!.team = 2;
    Object.assign(world.getComponent<TransformComponent>(enemy, "Transform")!, {
      position: { x: 500, y: 704 },
      facing: 1,
    });
    const health = world.getComponent<HealthComponent>(player, "Health")!;
    health.current = health.max = 2000;
    const combat = world.getComponent<CombatComponent>(player, "Combat")!;
    combat.poise = combat.maxPoise = 100000;
    Object.assign(world.getComponent<AIControllerComponent>(enemy, "AIController")!, {
      target: player,
      state: "combat",
      attackCooldownTimer: 0,
      attackDecisionTimer: 0,
    });
    if (mode === "low_cover") {
      createPlatform(world, 521, 674, 12, 30, "solid");
      world.getResource<NavigationGraph>(NavigationGraph).build(world);
    }
    const input = world.getResource<InputState>(InputState);
    let jumps = 0,
      rises = 0,
      serial = 0,
      halfwayHealth = health.current;
    for (let frame = 0; frame < 720; frame++) {
      const physics = world.getComponent<PhysicsComponent>(player, "Physics")!,
        transform = world.getComponent<TransformComponent>(player, "Transform")!;
      input.keysDown.delete("KeyA");
      input.keysDown.delete("KeyD");
      if (mode === "crowd")
        input.keysDown.add(
          world.getComponent<TransformComponent>(enemy, "Transform")!.position.x <
            transform.position.x
            ? "KeyA"
            : "KeyD",
        );
      if (mode === "jump" && physics.grounded) {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
      }
      const grounded = physics.grounded;
      game.update(1000 / 60);
      if (grounded && !physics.grounded && physics.velocity.y < -100) jumps++;
      const attack = world.getComponent<CombatComponent>(enemy, "Combat")!;
      if (attack.attackSerial !== serial) {
        serial = attack.attackSerial ?? 0;
        if (
          world.getComponent<AnimatorComponent>(enemy, "Animator")!.currentAnim ===
          "brute_heavy_attack_high"
        )
          rises++;
      }
      if (frame === 359) halfwayHealth = health.current;
      expect(
        Number.isFinite(transform.position.x + transform.position.y + health.current),
        "Campaign replay produced invalid state",
      );
    }
    return {
      damage: 2000 - health.current,
      laterDamage: halfwayHealth - health.current,
      jumps,
      rises,
    };
  } finally {
    game.inputManager.reset();
    game.systems = systems;
    game.battleMode = battleMode;
  }
}

export const tests = [
  async function testDamageBodyEndsAtTheVisibleHelmet() {
    const a = fixture();
    expect(
      actorContacts(a.world, a.target).bounds.y > -56,
      "Standing hurt geometry still extends into air above the helmet",
    );
    attack(a, 50, -60, 4);
    a.hits.update();
    expect(!a.queue.events.length, "A strike entirely above the helmet damaged the Soldier");
  },
  async function testDamageGeometryFollowsALeaningTorso() {
    const a = fixture(),
      s = a.world.getComponent<SkeletonComponent>(a.target, "Skeleton")!;
    const before = actorContacts(a.world, a.target).bodies[0].center.x;
    s.currentPose.torso = { rotate: 30 };
    a.bones.updateEntity(a.target);
    expect(
      Math.abs(actorContacts(a.world, a.target).bodies[0].center.x - before) > 4,
      "Head damage geometry stayed fixed as its torso leaned",
    );
  },
  async function testOrdinaryLegContactsStillDamage() {
    const a = fixture();
    attack(a, 50, -12, 8);
    a.hits.update();
    expect(
      a.queue.events.some((e) => e.targetId === a.target && e.contactType === "body"),
      "Leg shapes left a damaging swing unregistered",
    );
  },
  async function testRaisedGuardInterceptsBeforeTheBody() {
    const a = fixture();
    Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
    a.time.delta = 100;
    a.animation.update();
    a.bones.update();
    a.collision.update(false);
    const hb = attack(a, 10, -34);
    a.hits.update();
    a.queue.events.length = 0;
    hb.offset.x = 60;
    a.hits.update();
    const e = a.queue.events.find((e) => e.targetId === a.target);
    expect(
      e?.contactType === "guard" && e.impactPoint.x < 42,
      "The raised sword did not catch the strike ahead of the body",
    );
  },
  async function testAWeaponThatMissesTheGuardCanHitTheLegs() {
    const a = fixture();
    Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
    a.time.delta = 100;
    a.animation.update();
    a.bones.update();
    attack(a, 50, -12, 8);
    a.hits.update();
    a.damage.update();
    expect(
      a.targetHealth.current === 60,
      "A high guard blocked a physical strike that bypassed its blade",
    );
  },
  async function testHeavyGuardContactRecoversTheAttackingBlade() {
    const a = fixture("boss");
    attack(a, 50);
    a.combat.attackType = "heavy";
    a.combat.isHeavyAttack = true;
    Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
    a.queue.events.push({ ...hit(a), contactType: "guard", attackType: "heavy" });
    a.damage.update();
    expect(
      a.combat.attackState === "recovery" && !a.world.hasComponent(a.id, "ActiveHitbox"),
      "A held guard allowed the heavy blade to keep dealing damage",
    );
    expect(a.targetCombat.impact?.guard, "The defender did not receive a guard-load response");
  },
  async function testBreakingAGuardPreservesHeavyFollowThrough() {
    const a = fixture("boss");
    attack(a, 50);
    a.combat.attackType = "heavy";
    Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
    a.world.getComponent<StaminaComponent>(a.target, "Stamina")!.current = 1;
    a.queue.events.push({ ...hit(a), contactType: "guard", attackType: "heavy" });
    a.damage.update();
    expect(
      a.combat.attackState === "active" && a.world.hasComponent(a.id, "ActiveHitbox"),
      "A broken guard stopped a heavy follow-through",
    );
  },
  async function testDirectFleshHitsPreserveFollowThroughAndArmor() {
    const a = fixture("boss");
    attack(a, 50);
    a.queue.events.push({ ...hit(a), contactType: "body" });
    a.damage.update();
    expect(
      a.combat.attackState === "active" && a.world.hasComponent(a.id, "ActiveHitbox"),
      "An ordinary flesh hit turned into a solid-weapon recoil",
    );
    expect(
      a.targetCombat.impact && a.targetHealth.current === 60,
      "A damage contact lost its physical response",
    );
  },
  async function testDeflectionDiscardsLaterDamageFromTheSameSwing() {
    const a = fixture();
    attack(a, 50);
    Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
    const other = createEnemy(a.world, 80, 0, "soldier"),
      health = a.world.getComponent<HealthComponent>(other, "Health")!;
    a.queue.events.push(hit(a, other, 0.8), { ...hit(a), contactType: "guard" });
    a.damage.update();
    expect(
      health.current === health.max,
      "A canceled swing retained its later queued body contact",
    );
  },
  async function testDeflectionClearsTheTrailBeforeContactHitstop() {
    const a = fixture("boss");
    attack(a, 50);
    const trail: WeaponTrailComponent = {
      boneId: "weapon",
      baseOffset: { x: 0, y: 0 },
      tipOffset: { x: 40, y: 0 },
      history: [{ base: { x: 20, y: -30 }, tip: { x: 60, y: -30 } }],
      maxLength: 6,
      active: true,
      color: "white",
    };
    a.world.addComponent(a.id, "WeaponTrail", trail);
    Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
    a.queue.events.push({ ...hit(a), contactType: "guard" });
    a.damage.update();
    expect(
      !trail.active && !trail.history.length && a.world.hasComponent(a.id, "HitStop"),
      "A canceled trail still drew through the guard during the impact freeze",
    );
  },
  async function testSimultaneousFleshTradesRemainValid() {
    const a = fixture();
    a.combat.poise = a.targetCombat.poise = 1;
    a.combat.attackSerial = 10;
    a.targetCombat.attackSerial = 11;
    const first = hit(a);
    a.queue.events.push(
      { ...first, contactType: "body" },
      { ...first, attackerId: a.target, targetId: a.id, attackSerial: 11, contactType: "body" },
    );
    a.damage.update();
    expect(
      a.targetHealth.current === 60 &&
        a.world.getComponent<HealthComponent>(a.id, "Health")!.current === 60,
      "Contact ordering removed a valid simultaneous trade",
    );
  },
  async function testDeathCancelsLaterContactsEvenWhenArmorPreventedStagger() {
    const a = fixture();
    a.targetHealth.current = 10;
    a.targetCombat.poise = 1000;
    a.targetCombat.attackSerial = 11;
    const bystander = createPlayer(a.world, 80, 0),
      health = a.world.getComponent<HealthComponent>(bystander, "Health")!;
    a.queue.events.push(hit(a), {
      ...hit(a, bystander, 0.8),
      attackerId: a.target,
      attackSerial: 11,
    });
    a.damage.update();
    expect(
      a.targetHealth.isDead && health.current === health.max,
      "An actor killed earlier in the step retained its later swing contacts",
    );
  },
  async function testSimultaneousLethalTradesRemainValid() {
    const a = fixture();
    const health = a.world.getComponent<HealthComponent>(a.id, "Health")!;
    a.targetHealth.current = health.current = 10;
    a.combat.attackSerial = 10;
    a.targetCombat.attackSerial = 11;
    a.queue.events.push(hit(a), {
      ...hit(a),
      attackerId: a.target,
      targetId: a.id,
      attackSerial: 11,
    });
    a.damage.update();
    expect(
      a.targetHealth.isDead && health.isDead,
      "Death ordering removed a valid simultaneous lethal trade",
    );
  },
  async function testHeavyClashOverpowersALightSwing() {
    const a = fixture("boss");
    attack(a, 50);
    a.combat.attackType = "heavy";
    a.combat.isHeavyAttack = true;
    Object.assign(a.targetCombat, { attackState: "active", attackType: "light", attackSerial: 11 });
    a.queue.events.push(
      { ...hit(a), contactType: "clash", damage: 0, targetAttackSerial: 11 },
      { ...hit(a), attackerId: a.target, targetId: a.id, attackSerial: 11, contactTime: 0.8 },
    );
    a.damage.update();
    expect(
      a.combat.attackState === "active" && a.targetCombat.attackState === "recovery",
      "A greatsword clash did not overpower the light sword",
    );
    expect(
      a.world.getComponent<HealthComponent>(a.id, "Health")!.current === 500,
      "The deflected light swing still damaged the Boss",
    );
  },
  async function testEqualClashesRecoilBothWithoutHealthDamage() {
    const a = fixture();
    attack(a, 50);
    Object.assign(a.targetCombat, { attackState: "active", attackType: "light", attackSerial: 11 });
    a.queue.events.push({ ...hit(a), contactType: "clash", damage: 0, targetAttackSerial: 11 });
    a.damage.update();
    expect(
      a.combat.attackState === "recovery" &&
        a.targetCombat.attackState === "recovery" &&
        a.targetHealth.current === 80,
      "Equal blades did not recoil cleanly",
    );
  },
  async function testRestingWeaponOverlapDoesNotGenerateDamageOrClashes() {
    const a = fixture("brute", true, 18);
    a.hits.update();
    expect(!a.queue.events.length, "A resting club became a permanent contact hazard");
  },
  async function testTwoCommittedBladeWindowsCanClashOnlyOnce() {
    const a = fixture(),
      hb = attack(a, 15);
    hb.attachedToBone = "weapon";
    hb.width = 30;
    a.world.addComponent(a.target, "ActiveHitbox", {
      ...hb,
      sourceEntityId: a.target,
      alreadyHit: new Set(),
      clashedWith: undefined,
    });
    a.targetCombat.attackState = "active";
    a.targetCombat.attackSerial = 11;
    for (const [id, x, facing] of [
      [a.id, 0, 1],
      [a.target, 20, -1],
    ]) {
      a.world
        .getComponent<SkeletonComponent>(id, "Skeleton")!
        .worldTransforms.set("weapon", new Matrix2D(facing, 0, 0, 1, x, -30));
      updateActorContacts(a.world, id);
    }
    a.hits.update();
    expect(
      a.queue.events.filter((e) => e.contactType === "clash").length === 1,
      "The overlapping active blades did not register a clash",
    );
    a.queue.events.length = 0;
    a.hits.update();
    expect(
      !a.queue.events.some((e) => e.contactType === "clash"),
      "The same pair clashed again every update",
    );
  },
  async function testGuardPoseEntersAndLeavesThroughABlend() {
    const a = fixture(),
      s = a.world.getComponent<SkeletonComponent>(a.target, "Skeleton")!;
    const original = s.currentPose["shoulder-front"].rotate ?? 0;
    a.targetCombat.isBlocking = true;
    a.targetCombat.blockZone = 2;
    a.animation.update();
    const first = s.currentPose["shoulder-front"].rotate!;
    expect(first !== original && first !== -90, "The arm snapped immediately into a guard");
    for (let n = 0; n < 6; n++) a.animation.update();
    expect(
      Math.abs(s.currentPose["shoulder-front"].rotate! + 90) < 0.01,
      "The guard blend never reached its pose",
    );
    a.targetCombat.isBlocking = false;
    a.animation.update();
    expect(s.currentPose["shoulder-front"].rotate !== original, "The arm snapped out of its guard");
  },
  async function testLightHitsProduceAVisualResponseWithoutBreakingBossArmor() {
    const a = fixture("boss");
    a.queue.events.push({ ...hit(a), attackerId: a.target, targetId: a.id, contactType: "body" });
    a.damage.update();
    expect(
      a.combat.attackState !== "stagger" && a.combat.impact,
      "The Boss's light-hit response broke its armor rule",
    );
  },
  async function testActualHighArcCanReachAnAirbornePlayerBeyondTheOldCutoff() {
    const a = fixture("boss", true, 20);
    a.targetTransform.position.y = -45;
    a.world.getComponent<PhysicsComponent>(a.target, "Physics")!.grounded = false;
    a.bones.update();
    expect(
      animationCanReach(a.world, a.id, a.target, "boss_heavy_attack_high"),
      "The authored overhead path could not reach the airborne player",
    );
    expect(
      canAttackTarget(a.world, a.transform, a.targetTransform, a.id, a.target),
      "The fixed foot-height cutoff still disabled reachable attacks",
    );
  },
  async function testBruteChoosesItsTelegraphedRisingAttackForAJumpIn() {
    const a = fixture("brute", true, 25);
    a.targetTransform.position.y = -50;
    Object.assign(a.world.getComponent<PhysicsComponent>(a.target, "Physics")!, {
      grounded: false,
      velocity: { x: 0, y: 200 },
    });
    a.bones.update();
    new BruteStrategy().update(16, a.id, a.world);
    expect(
      a.world.getComponent<AnimatorComponent>(a.id, "Animator")!.currentAnim ===
        "brute_heavy_attack_high" && a.combat.attackTimer === 500,
      "The Brute lacked a committed, readable response to a descending player",
    );
  },
  async function testJumpingOpponentDoesNotBecomeAPlatformPath() {
    const a = fixture("brute", true, 40);
    a.targetTransform.position.y = -170;
    Object.assign(a.world.getComponent<PhysicsComponent>(a.target, "Physics")!, {
      grounded: false,
      velocity: { x: 0, y: -300 },
    });
    a.ai.currentPath = [{ x: 40, y: -170, action: "jump" }];
    a.bones.update();
    new BruteStrategy().update(16, a.id, a.world);
    expect(
      !a.ai.currentPath.length && a.physics.grounded,
      "The Brute tried to navigate to a transient airborne position",
    );
  },
  async function testCloseRangeSpacingUsesAnAvailableRetreat() {
    const a = fixture("brute", true, 18);
    a.ai.attackCooldownTimer = 1000;
    new BruteStrategy().update(16, a.id, a.world);
    expect(
      a.physics.velocity.x < 0,
      "A crowded Brute did not create any space during its cooldown",
    );
  },
  async function testBodySeparationStopsClosingVelocityInBothDirections() {
    for (const direction of [1, -1]) {
      const a = fixture("soldier", true, direction * 10),
        other = a.world.getComponent<PhysicsComponent>(a.target, "Physics")!;
      a.physics.velocity.x = direction * 100;
      other.velocity.x = -direction * 100;
      a.collision.update();
      expect(
        Math.abs(a.physics.velocity.x) < 0.01 && Math.abs(other.velocity.x) < 0.01,
        "Separation retained the velocity driving two bodies into each other",
      );
    }
  },
  async function testBodySeparationPreservesOutgoingKnockback() {
    const a = fixture("soldier", true, 10),
      other = a.world.getComponent<PhysicsComponent>(a.target, "Physics")!;
    a.physics.velocity.x = -100;
    other.velocity.x = 100;
    a.collision.update();
    expect(
      a.physics.velocity.x === -100 && other.velocity.x === 100,
      "Separation canceled legitimate outgoing knockback",
    );
  },
  async function testCrowdedBruteSelectsItsCompactRisingStrike() {
    const a = fixture("brute", true, 18);
    a.ai.pendingAttack = {
      target: a.target,
      animation: "brute_heavy_attack_mid",
      zone: 2,
      range: 70,
    };
    new BruteStrategy().update(16, a.id, a.world);
    expect(
      a.world.getComponent<AnimatorComponent>(a.id, "Animator")!.currentAnim ===
        "brute_heavy_attack_high",
      "The crowded Brute repeated its long swing's blind spot",
    );
  },
  async function testAnOpponentPushingAtBodyContactCannotPermanentlyPreventWindup() {
    const a = fixture("brute", true, 14.01);
    a.physics.velocity.x = -80;
    new BruteStrategy().update(16, a.id, a.world);
    expect(
      a.combat.attackState === "windup",
      "Externally imposed contact velocity permanently bypassed attack readiness",
    );
  },
  async function testWallPinnedBossUsesItsExistingCompactThrust() {
    const a = fixture("boss", true, 25);
    createPlatform(a.world, -20, -100, 8, 100, "solid");
    a.collision.update(false);
    a.ai.pendingAttack = {
      target: a.target,
      animation: "boss_heavy_attack_mid",
      zone: 2,
      range: 70,
    };
    new BossStrategy().update(16, a.id, a.world);
    expect(
      a.world.getComponent<AnimatorComponent>(a.id, "Animator")!.currentAnim ===
        "boss_heavy_attack_thrust",
      "The pinned Boss retained a long lateral swing instead of its compact thrust",
    );
  },
  async function testWallPinnedSoldierUsesItsExistingCompactThrust() {
    const a = fixture("soldier", true, 25);
    createPlatform(a.world, -20, -100, 8, 100, "solid");
    a.collision.update(false);
    new SoldierStrategy().update(16, a.id, a.world);
    expect(
      a.world.getComponent<AnimatorComponent>(a.id, "Animator")!.currentAnim ===
        "soldier_light_attack_thrust",
      "The pinned Soldier repeatedly swept its blade into the wall behind it",
    );
  },
  async function testContactGeometryProjectsAMovedAndReflectedActorBeforeNextFK() {
    const a = fixture();
    const before = actorContacts(a.world, a.target),
      center = { ...before.bodies[0].center };
    a.targetTransform.position.x += 70;
    a.targetTransform.facing *= -1;
    const after = actorContacts(a.world, a.target);
    expect(
      Math.abs(after.bodies[0].center.x - (a.targetTransform.position.x - (center.x - 50))) < 0.01,
      "A relocated and turned actor retained stale combat geometry",
    );
    expect(
      !after.previousWeapon,
      "A teleport or facing flip bridged its old weapon with a false sweep",
    );
  },
  async function testCrowdedCarryRetractsWithoutChangingTheAssets() {
    const a = fixture("brute", true, 30),
      animator = a.world.getComponent<AnimatorComponent>(a.id, "Animator")!;
    a.collision.update(false);
    a.time.delta = 100;
    a.animation.update();
    a.bones.update();
    const m = a.world
      .getComponent<SkeletonComponent>(a.id, "Skeleton")!
      .worldTransforms.get("weapon")!;
    expect(
      (Math.atan2(m.b, m.a) * 180) / Math.PI < -70 && animator.currentAnim === "idle",
      "The resting club did not retract away from the player's body",
    );
  },
  async function testLowSolidCoverIsCheckedAtTheRealWeaponHeight() {
    const a = fixture("brute", true, 50);
    createPlatform(a.world, 24, -30, 14, 30, "solid");
    a.collision.update(false);
    expect(
      !animationCanReach(a.world, a.id, a.target, "brute_heavy_attack_mid"),
      "The old high probe permitted a club swing through low cover",
    );
  },
  async function testLocalPillarRouteUsesAClearHopRatherThanAnImpossibleWalk() {
    const a = fixture("brute", true, 50);
    createPlatform(a.world, 24, -30, 14, 30, "solid");
    const nav = a.world.getResource<NavigationGraph>(NavigationGraph);
    nav.build(a.world);
    const path = nav.findPath(a.transform.position, a.targetTransform.position, {
      width: 14,
      height: 64,
    });
    expect(
      path[0]?.action === "jump" && path[0].takeoff?.x === 0,
      "Points on the same floor bypassed local pillar clearance",
    );
    createPlatform(a.world, -20, -80, 100, 10, "solid");
    nav.build(a.world);
    expect(
      !nav.findPath(a.transform.position, a.targetTransform.position, { width: 14, height: 64 })
        .length,
      "A low ceiling permitted a pillar hop without body clearance",
    );
  },
  async function testNormalJumpKeepsItsHeightCostAndImmediateLandingFreedom() {
    const a = fixture("brute", true);
    const p = a.world.getComponent<PlayerInputComponent>(a.target, "PlayerInput")!,
      physics = a.world.getComponent<PhysicsComponent>(a.target, "Physics")!;
    p.buffer = { action: "jump", timestamp: 1000, priority: 1 };
    new MovementSystem(a.world).update();
    expect(
      physics.velocity.y === -PLAYER_STATS.jumpForce &&
        a.world.getComponent<StaminaComponent>(a.target, "Stamina")!.current === 100,
      "Ordinary platforming jumps changed height or stamina cost",
    );
  },
  async function testAerialAttackLandingCommitsBrieflyBeforeAnotherJump() {
    const a = fixture("brute", true),
      movement = a.world.getComponent<MovementStateComponent>(a.target, "MovementState")!,
      physics = a.world.getComponent<PhysicsComponent>(a.target, "Physics")!,
      combat = a.targetCombat,
      input = a.world.getComponent<PlayerInputComponent>(a.target, "PlayerInput")!;
    Object.assign(physics, { grounded: false, velocity: { x: 0, y: 0 } });
    Object.assign(combat, { attackState: "active", attackType: "jump", isHeavyAttack: true });
    const moves = new MovementSystem(a.world);
    moves.update();
    combat.attackState = "idle";
    physics.grounded = true;
    movement.previousGrounded = false;
    input.buffer = { action: "jump", timestamp: 1000, priority: 1 };
    moves.update();
    expect(
      physics.grounded && movement.aerialLandingRecovery === 160,
      "A heavy aerial attack could immediately bounce into another jump",
    );
    for (let n = 0; n < 11; n++) moves.update();
    expect(!physics.grounded, "Combat landing recovery never released a buffered jump");
  },
  async function testAerialAttackLandingCannotStartAnotherAttackDuringRecovery() {
    const a = fixture("brute", true),
      movement = a.world.getComponent<MovementStateComponent>(a.target, "MovementState")!,
      input = a.world.getComponent<PlayerInputComponent>(a.target, "PlayerInput")!;
    movement.aerialLandingRecovery = 90;
    input.buffer = { action: "lightAttack", timestamp: 1000, priority: 1 };
    new CombatSystem(a.world).update();
    expect(a.targetCombat.attackState === "idle", "Landing commitment allowed an immediate attack");
  },
  async function testJumpAttackDamageFollowsTheBladeWithoutAnExtraDiagonal() {
    const clip = AssetLoader.getAnimation("jump_attack")!,
      hb = clip.events!.find((e) => e.type === "hitbox-start")!.data;
    expect(
      hb.rotation === 0 && hb.width === 30 && hb.offset.x === 15,
      "The aerial attack retained its independent oversized diagonal damage shape",
    );
  },
  async function testCampaignBodyPressureAndPillarDoNotCreateNoAttackLoops(game: Game) {
    for (const type of ["brute", "soldier", "boss"] as const)
      for (const mode of ["crowd", "low_cover"] as const) {
        const replay = campaignReplay(game, type, mode);
        expect(
          replay.laterDamage > 0,
          `${type}/${mode} stopped making contact after the initial exchange`,
        );
      }
  },
  async function testRepeatedCampaignJumpsDoNotDisableBruteCombat(game: Game) {
    const replay = campaignReplay(game, "brute", "jump");
    expect(
      replay.jumps > 4 && replay.rises > 0 && replay.damage > 0,
      "Repeated real jump input disabled the Brute's normal combat loop",
    );
  },
  async function testBlockedPendingAttackClearsAndSelectsClearStrikeBehindLowCover() {
    const a = fixture("boss", true, 77);
    a.transform.position.x = -17.5;
    a.targetTransform.position.x = 59.8;
    createPlatform(a.world, 21, -30, 12, 30, "solid");
    a.collision.update(false);
    a.animation.update();
    a.bones.update();
    expect(
      !animationCanReach(a.world, a.id, a.target, "boss_heavy_attack_mid", 0, true, true) &&
        !animationCanReach(a.world, a.id, a.target, "boss_heavy_attack_thrust", 0, true, true) &&
        animationCanReach(a.world, a.id, a.target, "boss_heavy_attack_high", 0, true, true),
      "Low-cover terrain clearance did not match actual weapon blade trajectory",
    );
    a.ai.pendingAttack = {
      target: a.target,
      animation: "boss_heavy_attack_low",
      zone: 3,
      range: 80,
    };
    new BossStrategy().update(16, a.id, a.world);
    expect(
      a.combat.attackState === "windup" &&
        a.world.getComponent<AnimatorComponent>(a.id, "Animator")!.currentAnim ===
          "boss_heavy_attack_high",
      "Terrain-blocked pendingAttack deadlocked instead of switching to a clear overhead strike",
    );
  },
];
