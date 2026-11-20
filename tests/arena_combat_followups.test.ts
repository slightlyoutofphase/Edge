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
import { TransformComponent } from "../components/Transform";
import { FactionComponent } from "../components/Faction";
import { HealthComponent } from "../components/Health";
import { PlatformComponent } from "../components/Platform";
import { StaminaComponent } from "../components/Stamina";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { CombatComponent } from "../features/combat/CombatComponent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { HitDetectionSystem } from "../features/combat/HitDetectionSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { hitboxShape, sweptContact, HitboxShape } from "../features/combat/HitboxGeometry";
import { CollisionSystem } from "../systems/CollisionSystem";
import { PhysicsSystem } from "../features/movement/PhysicsSystem";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import {
  SoldierStrategy,
  RogueStrategy,
  DuelistStrategy,
  BruteStrategy,
} from "../features/ai/EnemyStrategies";
import { CombatDirectorSystem } from "../features/ai/CombatDirectorSystem";
import {
  attackRange,
  animationAttackRange,
  actorBounds,
  nearbyThreat,
} from "../features/ai/CombatReach";
import { flankLanding } from "../features/ai/FlankPlanning";
import { bodySeparationBounds } from "../features/combat/BodySeparation";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { AssetLoader } from "../assets/AssetLoader";
import { Matrix2D } from "../utils/Matrix2D";
import { aabbIntersects } from "../utils/AABB";
import { SpawnEffectComponent } from "../components/SpawnEffect";

type Enemy = Parameters<typeof createEnemy>[3];
function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function close(a: number, b: number, message: string) {
  expect(Math.abs(a - b) < 1e-5, `${message}: ${a} != ${b}`);
}
function random<T>(value: number, run: () => T): T {
  const previous = Math.random;
  try {
    Math.random = () => value;
    return run();
  } finally {
    Math.random = previous;
  }
}
function fixture(type: Enemy = "soldier", opponent: Enemy = "soldier", distance = 30) {
  const world = new World(),
    time = Object.assign(new TimeState(), { delta: 1000 / 60, elapsed: 1000 });
  world.setResource(TimeState, time);
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  world.setResource(CombatDirectorState, new CombatDirectorState());
  world.setResource(BattleState, new BattleState());
  createPlatform(world, -1500, 0, 3000, 40, "solid");
  const nav = new NavigationGraph();
  nav.build(world);
  world.setResource(NavigationGraph, nav);
  const id = createEnemy(world, 0, 0, type),
    target = createEnemy(world, distance, 0, opponent);
  for (const [actor, team, facing] of [
    [id, 3, 1],
    [target, 4, -1],
  ]) {
    world.getComponent<FactionComponent>(actor, "Faction")!.team = team;
    world.getComponent<TransformComponent>(actor, "Transform")!.facing = facing as 1 | -1;
    world.getComponent<PhysicsComponent>(actor, "Physics")!.grounded = true;
    Object.assign(world.getComponent<AIControllerComponent>(actor, "AIController")!, {
      state: "combat",
      target: actor === id ? target : id,
      attackCooldownTimer: 10000,
      flankTimer: 10000,
      decisionTimer: 10000,
      attackDecisionTimer: 0,
      hasAttackToken: true,
    });
  }
  return {
    world,
    time,
    id,
    target,
    ai: world.getComponent<AIControllerComponent>(id, "AIController")!,
    transform: world.getComponent<TransformComponent>(id, "Transform")!,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    targetCombat: world.getComponent<CombatComponent>(target, "Combat")!,
    targetTransform: world.getComponent<TransformComponent>(target, "Transform")!,
    movement: world.getComponent<MovementStateComponent>(id, "MovementState")!,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
    collision: new CollisionSystem(world),
    hits: new HitDetectionSystem(world),
    damage: new DamageSystem(world),
    queue: world.getResource<CombatEventQueue>(CombatEventQueue),
  };
}
function swing(a: ReturnType<typeof fixture>, x = 0, width = 4): ActiveHitboxComponent {
  const box: ActiveHitboxComponent = {
    offset: { x, y: -30 },
    width,
    height: 8,
    rotation: 0,
    damage: 20,
    poiseDamage: 10,
    zone: 2,
    attackType: "light",
    knockback: { x: 100, y: 0 },
    alreadyHit: new Set(),
    sourceEntityId: a.id,
    attachedToBone: "weapon",
  };
  a.combat.attackState = "active";
  a.world.addComponent(a.id, "ActiveHitbox", box);
  a.collision.update(false);
  return box;
}
function incoming(a: ReturnType<typeof fixture>, timer = 100) {
  a.targetCombat.attackState = "windup";
  a.targetCombat.attackTimer = timer;
  a.targetCombat.attackZone = 3;
  a.targetCombat.attackSerial = (a.targetCombat.attackSerial ?? 0) + 1;
}
function think(
  a: ReturnType<typeof fixture>,
  strategy: SoldierStrategy | RogueStrategy | DuelistStrategy,
  frames: number,
  dt = 16,
) {
  for (let i = 0; i < frames; i++) {
    a.time.elapsed += dt;
    strategy.update(dt, a.id, a.world);
  }
}
function event(a: ReturnType<typeof fixture>, target = a.id, attacker = a.target) {
  a.queue.events.push({
    attackerId: attacker,
    targetId: target,
    damage: 20,
    poiseDamage: 10,
    zone: 2,
    attackType: "light",
    knockback: { x: 100, y: 0 },
    impactPoint: { x: 3, y: -30 },
    isBlockable: true,
  });
}

function linearWindows(a: ReturnType<typeof fixture>, name: string, windows: [number, number][]) {
  a.world.removeComponent(a.id, "AIController");
  const root = { id: "tip", pivot: { x: 0, y: 0 }, children: [], renderOrder: 0 };
  const skeleton = a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!;
  skeleton.definition = {
    id: "arena-window-rig",
    root,
    bones: new Map([["tip", root]]),
    bindPose: {},
  };
  skeleton.currentPose = {};
  skeleton.worldTransforms.clear();
  AssetLoader.animations.set(name, {
    name,
    duration: 1000,
    loop: false,
    keyframes: [
      { time: 0, bones: { tip: { translate: { x: 0, y: -30 } } } },
      { time: 1, bones: { tip: { translate: { x: 200, y: -30 } } } },
    ],
    events: windows.flatMap(([start, end]) => [
      {
        time: start,
        type: "hitbox-start" as const,
        data: {
          attachedToBone: "tip",
          offset: { x: 0, y: 0 },
          width: 2,
          height: 6,
          damage: 20,
          poiseDamage: 10,
          zone: 2,
          attackType: "light",
        },
      },
      { time: end, type: "hitbox-end" as const },
    ]),
  });
  beginAnimation(a.animator, name);
  a.animator.blendFrom = null;
  a.animator.blendFromPose = undefined;
  a.animator.transitionPending = false;
  a.animator.sampledAnimation = name;
  a.combat.attackState = "windup";
  const animation = new AnimationSystem(a.world),
    bones = new SkeletonSystem(a.world);
  a.time.delta = 0;
  animation.update();
  bones.update();
  return { animation, bones };
}

export const tests = [
  async function testMixedHeightBodiesSeparateAtTheFeet() {
    for (const type of ["soldier", "boss", "alpha_hellhound"] as const) {
      const a = fixture("hellhound", type, 0);
      a.collision.update();
      expect(
        !aabbIntersects(actorBounds(a.world, a.id)!, actorBounds(a.world, a.target)!),
        `${type} retained a low creature inside its body`,
      );
    }
  },
  async function testLargeBodiesResistSmallBodiesWithoutAnEndlessPushImpulse() {
    const a = fixture("hellhound", "alpha_hellhound", 5);
    a.physics.velocity.x = 195;
    a.world.getComponent<PhysicsComponent>(a.target, "Physics")!.velocity.x = -145;
    a.collision.update();
    expect(
      Math.abs(a.transform.position.x) > Math.abs(a.targetTransform.position.x - 5),
      "Small actor displaced the Alpha more than itself",
    );
    expect(
      a.physics.velocity.x <=
        a.world.getComponent<PhysicsComponent>(a.target, "Physics")!.velocity.x,
      "Actors kept an inward relative velocity after contact",
    );
  },
  async function testAJumpAboveAnotherBodyDoesNotSeparateHorizontally() {
    const a = fixture("hellhound", "boss", 0);
    a.transform.position.y = -110;
    a.physics.grounded = false;
    a.collision.update();
    close(a.transform.position.x, 0, "Airborne actor was pushed above a clear body");
  },
  async function testDeadBodiesDoNotBlockLivingActors() {
    const a = fixture("hellhound", "boss", 0);
    a.world.getComponent<HealthComponent>(a.target, "Health")!.isDead = true;
    a.collision.update();
    close(a.transform.position.x, 0, "Corpse separated a living actor");
  },
  async function testSeparationIsDeterministicAtIdenticalPositions() {
    const positions = Array.from({ length: 3 }, () => {
      const a = fixture("soldier", "soldier", 0);
      a.collision.update();
      return [a.transform.position.x, a.targetTransform.position.x];
    });
    expect(
      positions.every((p) => JSON.stringify(p) === JSON.stringify(positions[0])) &&
        positions[0][0] < positions[0][1],
      "Coincident actors separated inconsistently",
    );
  },
  async function testDynamicGridUsesResolvedBodyPositions() {
    const a = fixture("soldier", "alpha_hellhound", 0);
    a.collision.update();
    const ids = a.world
      .getResource<SpatialGridState>(SpatialGridState)
      .dynamicGrid.query(actorBounds(a.world, a.id)!, []);
    expect(ids.includes(a.id), "Separated actor was absent from its corrected grid cell");
  },
  async function testBodyAwareRangePreservesPlayerBaselineAndReachesLargeTargets() {
    const a = fixture("rogue", "alpha_hellhound", 65),
      range = attackRange(a.world, a.id, a.target);
    const body = bodySeparationBounds(a.world, a.target);
    close(
      range,
      25 + a.targetTransform.position.x - body.x - 7,
      "Rogue range did not include the Alpha's near solid body edge",
    );
    const player = createPlayer(a.world, 20, 0);
    close(attackRange(a.world, a.id, player), 25, "Player engagement cap changed");
    a.ai.attackCooldownTimer = 0;
    new CombatDirectorSystem(a.world).update();
    random(0.5, () => new RogueStrategy().update(0, a.id, a.world));
    expect(
      a.combat.attackState === "windup",
      "Rogue could not attack a large target outside its body",
    );
  },
  async function testDirectorUsesTheSameBodyAwareRangeAsTheStrategy() {
    const a = fixture("soldier", "alpha_hellhound", 75);
    a.ai.hasAttackToken = false;
    a.ai.attackCooldownTimer = 0;
    new CombatDirectorSystem(a.world).update();
    expect(a.ai.hasAttackToken, "Director denied a reachable large target");
  },
  async function testFastApproachBrakesBeforeContactAndTheAttackStart() {
    const a = fixture("rogue", "soldier", 70);
    a.ai.attackCooldownTimer = 0;
    a.physics.velocity.x = 275;
    const strategy = new RogueStrategy(),
      physics = new PhysicsSystem(a.world);
    for (let frame = 0; frame < 60 && a.combat.attackState === "idle"; frame++) {
      strategy.update(a.time.delta, a.id, a.world);
      physics.update();
      a.collision.update();
      a.time.elapsed += a.time.delta;
    }
    expect(
      a.combat.attackState === "windup" && Math.abs(a.physics.velocity.x) <= 35,
      "Rogue began its attack while still rushing forward",
    );
    expect(
      a.transform.position.x < a.targetTransform.position.x - 14,
      "Approach drove through the target",
    );
  },
  async function testSelectedAttackWaitsForItsOwnReachWithoutSpendingStamina() {
    const a = fixture("brute", "soldier", 65);
    a.ai.attackCooldownTimer = 0;
    // A temporarily high forward velocity must finish braking before commitment.
    a.physics.velocity.x = 200;
    const strategy = new BruteStrategy();
    random(0.4, () => strategy.update(0, a.id, a.world));
    const name = a.ai.pendingAttack?.animation;
    expect(
      !!name &&
        a.combat.attackState === "idle" &&
        a.world.getComponent<StaminaComponent>(a.id, "Stamina")!.current === 100 &&
        a.ai.attackCooldownTimer === 0,
      "Positioning spent attack stamina or cooldown",
    );
    a.physics.velocity.x = 0;
    random(0.9, () => strategy.update(0, a.id, a.world));
    expect(
      a.combat.attackState === "windup" && a.animator.currentAnim === name,
      "Positioning rerolled the chosen move",
    );
  },
  async function testPendingMoveIsCancelledWhenThePursuitTargetChanges() {
    const a = fixture("brute", "soldier", 65);
    a.ai.attackCooldownTimer = 0;
    a.physics.velocity.x = 200;
    new BruteStrategy().update(0, a.id, a.world);
    expect(!!a.ai.pendingAttack, "Fixture never selected a move");
    a.ai.target = null;
    new BruteStrategy().update(0, a.id, a.world);
    expect(!a.ai.pendingAttack, "Old target retained a pending swing");
  },
  async function testHumanoidDecisionAndCooldownVariationLeaveAuthoredWindupIntact() {
    const starts: number[] = [],
      cooldowns: number[] = [];
    for (const value of [0, 0.99]) {
      const a = fixture();
      a.ai.attackCooldownTimer = 0;
      a.ai.attackDecisionTimer = undefined;
      const strategy = new SoldierStrategy();
      random(value, () => strategy.update(0, a.id, a.world));
      expect(
        a.combat.attackState === "idle" &&
          a.ai.attackDecisionTimer! >= 30 &&
          a.ai.attackDecisionTimer! <= 110,
        "Decision offset was skipped or out of bounds",
      );
      let frame = 0;
      while (a.combat.attackState === "idle" && frame++ < 12)
        random(value, () => think(a, strategy, 1));
      expect(a.combat.attackState === "windup", "Decision delay never expired");
      starts.push(frame);
      cooldowns.push(a.ai.attackCooldownTimer);
      const clip = AssetLoader.getAnimation(a.animator.currentAnim)!;
      close(
        a.combat.attackTimer,
        clip.windupMs ?? a.ai.behaviorParams.windupFrames * 16.66,
        "Authored windup was randomized",
      );
      expect(
        a.ai.attackCooldownTimer >= a.ai.behaviorParams.attackCooldown * 0.75 &&
          a.ai.attackCooldownTimer <= a.ai.behaviorParams.attackCooldown * 1.25,
        "Cooldown variation was unbounded",
      );
    }
    expect(
      starts[0] !== starts[1] && cooldowns[0] !== cooldowns[1],
      "Separate actors kept identical decision schedules",
    );
  },
  async function testCachedReachUsesTheExistingCreatureAttackGeometry() {
    const a = fixture("hellhound", "soldier", 30);
    const bite = animationAttackRange(a.world, a.id, a.target, "hellhound_light_attack_low");
    const pounce = animationAttackRange(a.world, a.id, a.target, "hellhound_light_attack_high");
    expect(
      bite < 34 && pounce > 55,
      "Standing bite and moving pounce share an arbitrary engagement gap",
    );
    close(
      animationAttackRange(a.world, a.id, a.target, "hellhound_light_attack_low"),
      bite,
      "Cached reach drifted",
    );
  },
  async function testFlankRequiresSupportedReachableSpaceBeyondTheTarget() {
    const a = fixture("soldier", "soldier", 90);
    const landing = flankLanding(a.world, a.id, a.target, 650);
    expect(
      !!landing && landing.x > a.targetTransform.position.x,
      "Clear supported flank was rejected",
    );
    createPlatform(a.world, 110, -140, 35, 140, "solid");
    expect(!flankLanding(a.world, a.id, a.target, 650), "Wall-filled landing was accepted");
  },
  async function testFlankRejectsCeilingsAndCrowdedLandings() {
    for (const ceiling of [true, false]) {
      const a = fixture("soldier", "soldier", 90);
      if (ceiling) createPlatform(a.world, -30, -110, 240, 20, "solid");
      else createEnemy(a.world, 116, 0, "alpha_hellhound");
      expect(
        !flankLanding(a.world, a.id, a.target, 650),
        ceiling ? "Arc passed through a ceiling" : "Landing ignored a large actor",
      );
    }
  },
  async function testFailedFlanksHoldUsefulSpacingAndRememberTheFailure() {
    const a = fixture("soldier", "boss", 120);
    a.ai.hasAttackToken = false;
    a.ai.flankTimer = 0;
    const ally = createEnemy(a.world, 60, 0, "soldier");
    a.world.getComponent<FactionComponent>(ally, "Faction")!.team = 3;
    createPlatform(a.world, 140, -180, 30, 180, "solid");
    const strategy = new SoldierStrategy();
    strategy.update(16, a.id, a.world);
    expect(
      !a.ai.isFlanking && a.ai.flankTimer >= 4000 && a.physics.grounded,
      "Impossible flank spent a jump",
    );
    const stamina = a.world.getComponent<StaminaComponent>(a.id, "Stamina")!.current;
    strategy.update(16, a.id, a.world);
    expect(
      !!a.ai.approachBlocked && a.physics.velocity.x === 0,
      "Blocked actor resumed marching into its ally",
    );
    close(
      a.world.getComponent<StaminaComponent>(a.id, "Stamina")!.current,
      stamina,
      "Failed flank repeatedly spent stamina",
    );
  },
  async function testRearNPCBlocksAndParriesDoNotStopHits() {
    for (const parry of [true, false]) {
      const a = fixture();
      a.targetTransform.position.x = -30;
      if (parry) {
        a.combat.attackState = "parry";
        a.combat.attackZone = 2;
      } else {
        a.combat.isBlocking = true;
        a.combat.blockZone = 2;
      }
      event(a);
      a.damage.update();
      close(
        a.world.getComponent<HealthComponent>(a.id, "Health")!.current,
        60,
        "Rear defense stopped damage",
      );
      expect(!a.combat.counterWindowActive, "Rear parry enabled a counter");
    }
  },
  async function testFrontNPCBlocksAndParriesRemainEffective() {
    for (const parry of [true, false]) {
      const a = fixture();
      if (parry) {
        a.combat.attackState = "parry";
        a.combat.attackZone = 2;
      } else {
        a.combat.isBlocking = true;
        a.combat.blockZone = 2;
      }
      event(a);
      a.damage.update();
      close(
        a.world.getComponent<HealthComponent>(a.id, "Health")!.current,
        parry ? 80 : 78,
        "Front defense lost its damage reduction",
      );
      if (parry)
        expect(
          a.combat.counterWindowActive && a.targetCombat.attackState === "stagger",
          "Front parry lost stagger/counter feedback",
        );
    }
  },
  async function testPlayerOmnidirectionalParryIsPreserved() {
    const a = fixture();
    const player = createPlayer(a.world, 60, 0);
    const c = a.world.getComponent<CombatComponent>(player, "Combat")!;
    a.world.getComponent<TransformComponent>(player, "Transform")!.facing = 1;
    c.attackState = "parry";
    c.attackZone = 1;
    event(a, player, a.id);
    a.damage.update();
    expect(c.counterWindowActive, "Player's intentional rear/zone-independent parry changed");
  },
  async function testDefenseNoticesAnUnassignedHostileAndKeepsItsPursuitTarget() {
    const a = fixture();
    const other = createEnemy(a.world, 20, 0, "brute");
    a.world.getComponent<FactionComponent>(other, "Faction")!.team = 4;
    a.world.getComponent<TransformComponent>(other, "Transform")!.facing = -1;
    Object.assign(a.world.getComponent<CombatComponent>(other, "Combat")!, {
      attackState: "windup",
      attackTimer: 100,
      attackZone: 1,
    });
    expect(
      nearbyThreat(a.world, a.id)?.attackerId === other,
      "NPC watched only its assigned target",
    );
    random(0, () => think(a, new SoldierStrategy(), 6));
    expect(
      a.combat.isBlocking && a.combat.blockZone === 1 && a.ai.target === a.target,
      "Defense replaced pursuit or ignored the extra attacker",
    );
  },
  async function testDefenseChoosesTheImminentHostileAndIgnoresFriendlySwings() {
    const a = fixture();
    incoming(a, 400);
    const other = createEnemy(a.world, 20, 0, "brute");
    a.world.getComponent<TransformComponent>(other, "Transform")!.facing = -1;
    Object.assign(a.world.getComponent<CombatComponent>(other, "Combat")!, {
      attackState: "windup",
      attackTimer: 60,
    });
    a.world.getComponent<FactionComponent>(other, "Faction")!.team = 3;
    expect(
      nearbyThreat(a.world, a.id)?.attackerId === a.target,
      "Friendly swing took defensive priority",
    );
    a.world.getComponent<FactionComponent>(other, "Faction")!.team = 4;
    expect(
      nearbyThreat(a.world, a.id)?.attackerId === other,
      "Slow assigned swing took priority over imminent contact",
    );
  },
  async function testDodgeProbabilityIsRolledOncePerIncomingSwing() {
    for (const rogue of [true, false]) {
      const a = fixture(rogue ? "rogue" : "duelist");
      incoming(a);
      a.ai.behaviorParams.canParry = false;
      const strategy = rogue ? new RogueStrategy() : new DuelistStrategy();
      let calls = 0;
      const previous = Math.random;
      try {
        Math.random = () => {
          calls++;
          return 0.99;
        };
        think(a, strategy, 30);
        expect(
          calls === 2 && a.movement.current !== "roll" && a.movement.current !== "backstep",
          `Failed dodge rerolled ${calls} times`,
        );
        incoming(a);
        think(a, strategy, 10);
        expect(calls === 4, "A fresh swing did not receive its own decision");
      } finally {
        Math.random = previous;
      }
    }
  },
  async function testDodgeWaitsForObservationAndAnImminentStrike() {
    const a = fixture("rogue");
    incoming(a, 600);
    const strategy = new RogueStrategy();
    random(0, () => think(a, strategy, 10));
    expect(a.movement.current !== "roll", "Long windup caused a premature dodge");
    a.targetCombat.attackTimer = 150;
    random(0, () => think(a, strategy, 1));
    expect(
      a.movement.current === "roll",
      "Observed imminent swing never triggered a permitted dodge",
    );
  },
  async function testDodgeRejectsAStoneWallInTheEscapeDirection() {
    for (const rogue of [true, false]) {
      const a = fixture(rogue ? "rogue" : "duelist");
      incoming(a);
      createPlatform(a.world, -80, -80, 20, 80, "solid");
      random(0, () => think(a, rogue ? new RogueStrategy() : new DuelistStrategy(), 10));
      expect(
        a.movement.current !== "roll" && a.movement.current !== "backstep",
        "NPC committed a dodge directly into stone",
      );
    }
  },
  async function testBlockSparksUseTheActualContactWithoutAnExtraOffset() {
    const a = fixture();
    a.combat.isBlocking = true;
    a.combat.blockZone = 2;
    event(a);
    a.damage.update();
    const spark = a.world
      .query("SpawnEffect")
      .map((e) => e.components[0] as SpawnEffectComponent)
      .find((e) => e.type === "block_spark")!;
    close(spark.position.x, 3, "Block spark floated ahead of the contact");
    close(spark.position.y, -30, "Block spark changed height");
    expect(
      a.world.hasComponent(a.id, "HitStop") && a.world.hasComponent(a.target, "HitStop"),
      "Block lost its existing recoil/hitstop feedback",
    );
  },
  async function testContactPointLiesInsideTheVictimsActualOverlap() {
    const a = fixture("soldier", "soldier", 40);
    swing(a, 40, 60);
    a.hits.update();
    const point = a.queue.events[0].impactPoint;
    const box = actorBounds(a.world, a.target)!;
    expect(
      point.x >= box.x &&
        point.x <= box.x + box.width &&
        point.y >= box.y &&
        point.y <= box.y + box.height,
      "Impact point was the distant attack-box center",
    );
  },
  async function testSweptWeaponCatchesAThinVictimBetweenDisjointPoses() {
    const a = fixture("soldier", "soldier", 50),
      box = swing(a);
    a.hits.update();
    expect(a.queue.events.length === 0, "Initial blade unexpectedly hit");
    box.offset.x = 100;
    a.hits.update();
    expect(
      a.queue.events.length === 1 && a.queue.events[0].targetId === a.target,
      "Fast blade tunneled through the victim",
    );
    a.hits.update();
    expect(a.queue.events.length === 1, "Sweep hit the same victim twice");
  },
  async function testSweptGeometryRetainsReflectionShearAndRotation() {
    const from: HitboxShape = { center: { x: 0, y: -30 }, u: { x: -12, y: 5 }, v: { x: 3, y: 4 } };
    const to: HitboxShape = { center: { x: 90, y: -30 }, u: { x: -5, y: -12 }, v: { x: -4, y: 3 } };
    const contact = sweptContact(from, to, { x: 40, y: -35, width: 4, height: 10 });
    expect(
      !!contact &&
        contact.point.x >= 40 &&
        contact.point.x <= 44 &&
        contact.point.y >= -35 &&
        contact.point.y <= -25,
      "Sheared/reflected swing missed or produced an off-body effect",
    );
  },
  async function testSweepsResetForNewSwingsTeleportsFacingChangesAndHitstop() {
    for (const reset of ["new", "teleport", "facing", "hitstop"]) {
      const a = fixture("soldier", "soldier", reset === "facing" ? 0 : 50);
      const box = swing(a, reset === "facing" ? 60 : 0);
      a.hits.update();
      if (reset === "new") swing(a, 100);
      if (reset === "teleport") a.transform.position.x = 200;
      if (reset === "facing") a.transform.facing = -1;
      if (reset === "hitstop") {
        a.world.addComponent(a.id, "HitStop", { frames: 4 });
        box.offset.x = 100;
        a.hits.update();
        a.world.removeComponent(a.id, "HitStop");
      }
      a.hits.update();
      expect(
        a.queue.events.length === 0,
        `${reset} bridged an unrelated pose with damaging geometry`,
      );
    }
  },
  async function testStaggeredAttackCannotLeaveASweptDamageVolume() {
    const a = fixture("soldier", "soldier", 50),
      box = swing(a);
    a.hits.update();
    box.offset.x = 100;
    a.combat.attackState = "stagger";
    a.hits.update();
    expect(
      a.queue.events.length === 0 && !a.world.hasComponent(a.id, "ActiveHitbox"),
      "Staggered attack still swept damage",
    );
  },
  async function testActiveWindowClampsTheFirstAndLastPartialStep() {
    const a = fixture("soldier", "soldier", 95);
    a.world.removeComponent(a.id, "AIController");
    const root = { id: "tip", pivot: { x: 0, y: 0 }, children: [], renderOrder: 0 };
    const skeleton = a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!;
    skeleton.definition = {
      id: "arena-contact-rig",
      root,
      bones: new Map([["tip", root]]),
      bindPose: {},
    };
    skeleton.currentPose = {};
    a.animator.blendFrom = null;
    a.animator.blendFromPose = undefined;
    const name = "arena_partial_step_test",
      previous = AssetLoader.animations.get(name);
    AssetLoader.animations.set(name, {
      name,
      duration: 1000,
      loop: false,
      keyframes: [
        { time: 0, bones: { tip: { translate: { x: 0, y: -30 } } } },
        { time: 1, bones: { tip: { translate: { x: 200, y: -30 } } } },
      ],
      events: [
        {
          time: 0.4,
          type: "hitbox-start",
          data: {
            attachedToBone: "tip",
            offset: { x: 0, y: 0 },
            width: 2,
            height: 6,
            damage: 20,
            poiseDamage: 10,
            zone: 2,
            attackType: "light",
          },
        },
        { time: 0.6, type: "hitbox-end" },
      ],
    });
    try {
      beginAnimation(a.animator, name);
      a.animator.time = 300;
      a.animator.blendFrom = null;
      a.animator.blendFromPose = undefined;
      a.animator.transitionPending = false;
      a.animator.sampledAnimation = name;
      a.combat.attackState = "windup";
      a.time.delta = 0;
      const animation = new AnimationSystem(a.world),
        bones = new SkeletonSystem(a.world);
      animation.update();
      bones.update();
      for (const x of [65, 135]) {
        const id = createEnemy(a.world, x, 0, "soldier");
        a.world.getComponent<FactionComponent>(id, "Faction")!.team = 4;
      }
      a.time.delta = 400;
      animation.update();
      bones.update();
      a.collision.update(false);
      a.hits.update();
      expect(
        a.queue.events.length === 1 && a.queue.events[0].targetId === a.target,
        "Sweep included windup/recovery or missed the complete active interval",
      );
      expect(
        !a.world.hasComponent(a.id, "ActiveHitbox") && !a.world.hasComponent(a.id, "HitboxSweep"),
        "Boundary left a live damage component",
      );
    } finally {
      if (previous) AssetLoader.animations.set(name, previous);
      else AssetLoader.animations.delete(name);
    }
  },
  async function testNPCWeaponRecoilStopsVictimsBehindTheFirstSolidWall() {
    const a = fixture("soldier", "soldier", 80);
    createPlatform(a.world, 40, -90, 8, 90, "solid");
    const box = swing(a);
    a.hits.update();
    box.offset.x = 100;
    a.hits.update();
    expect(
      a.queue.events.length === 1 && a.queue.events[0].targetId === -1,
      "Weapon damaged an actor beyond the wall",
    );
    a.damage.update();
    expect(
      a.combat.attackState === "recovery" &&
        a.combat.attackTimer === 200 &&
        a.world.hasComponent(a.id, "HitStop"),
      "NPC wall contact did not recoil",
    );
    expect(!a.world.hasComponent(a.id, "ActiveHitbox"), "Recoil left the weapon active");
  },
  async function testSweptWeaponCanHitInFrontOfAWallBeforeRecoiling() {
    const a = fixture("soldier", "soldier", 30);
    createPlatform(a.world, 60, -90, 8, 90, "solid");
    const box = swing(a);
    a.hits.update();
    box.offset.x = 100;
    a.hits.update();
    expect(
      a.queue.events.length === 2 &&
        a.queue.events[0].targetId === a.target &&
        a.queue.events[1].targetId === -1,
      "Wall suppressed an earlier valid victim contact",
    );
  },
  async function testDecorativeAndSemisolidTerrainDoNotRecoilWeapons() {
    for (const decorative of [true, false]) {
      const a = fixture("soldier", "soldier", 80);
      const wall = createPlatform(a.world, 40, -90, 8, 90, decorative ? "solid" : "semisolid");
      if (decorative) a.world.getComponent<PlatformComponent>(wall, "Platform")!.collidable = false;
      const box = swing(a);
      a.hits.update();
      box.offset.x = 100;
      a.hits.update();
      expect(
        a.queue.events.length === 1 && a.queue.events[0].targetId === a.target,
        "Passable terrain recoiled the weapon",
      );
    }
  },
  async function testWideRaisedPlatformsStillStopWeaponsAndGroundSlamsRemainIntact() {
    const a = fixture("soldier", "soldier", 80);
    createPlatform(a.world, 40, -35, 200, 10, "solid");
    const box = swing(a);
    a.hits.update();
    box.offset.x = 100;
    a.hits.update();
    expect(
      a.queue.events.some((e) => e.targetId === -1),
      "Wide raised platform was ignored as a floor",
    );
    const b = fixture("alpha_hellhound", "soldier", 80);
    createPlatform(b.world, 40, -90, 8, 90, "solid");
    const slam = swing(b, 0, 116);
    slam.attachedToBone = undefined;
    slam.offset.y = -4;
    slam.height = 14;
    b.hits.update();
    expect(
      b.queue.events.some((e) => e.targetId === b.target) &&
        !b.queue.events.some((e) => e.targetId === -1),
      "Ground-area slam was turned into a weapon recoil",
    );
  },
  async function testRecoilCannotSpawnLaterDamageFromTheInterruptedAnimation() {
    const a = fixture();
    const name = "soldier_special_attack",
      clip = AssetLoader.getAnimation(name)!;
    beginAnimation(a.animator, name);
    a.combat.attackState = "recovery";
    a.combat.attackTiming = undefined;
    const start = clip.events!.find((e) => e.type === "hitbox-start")!;
    a.animator.time = start.time * clip.duration - 5;
    a.time.delta = 20;
    new AnimationSystem(a.world).update();
    expect(
      !a.world.hasComponent(a.id, "ActiveHitbox"),
      "Interrupted recovery spawned a later attack event",
    );
  },
  async function testAnimationAndRenderedRigDefinitionsRemainTheReachSource() {
    const a = fixture();
    a.world
      .getComponent<SkeletonComponent>(a.id, "Skeleton")!
      .worldTransforms.set("weapon", new Matrix2D(1, 0.3, 0.2, 1, 20, -30));
    const box = swing(a, 10);
    const shape = hitboxShape(a.world, box, a.transform);
    close(shape.center.x, 24, "Bone attachment was replaced by an actor-centered range box");
    close(shape.center.y, -57, "Bone geometry did not preserve shear");
  },
  async function testAllSoldierArenaStillUsesSharedAIAndCompletesCombat(game: Game) {
    game.startBattle("soldier", "soldier", "soldier", "soldier");
    const battle = game.world.getResource<BattleState>(BattleState);
    const assigned = game.world
      .query("AIController")
      .map((e) => (e.components[0] as AIControllerComponent).target);
    expect(
      assigned.every((id) => id !== null && game.world.hasComponent(id!, "AIController")),
      "Arena no longer assigns normal NPC opponents",
    );
    for (let frame = 0; frame < 5400 && !battle.winner; frame++) game.update(1000 / 60);
    expect(!!battle.winner, "All-Soldier battle stalled after contact/defense changes");
  },
  async function testTwoCompletedHitWindowsInOneStepKeepSeparateSweeps() {
    const a = fixture("soldier", "soldier", 50),
      name = "arena_two_window_test";
    const systems = linearWindows(a, name, [
      [0.2, 0.3],
      [0.7, 0.8],
    ]);
    try {
      const second = createEnemy(a.world, 150, 0, "soldier"),
        gap = createEnemy(a.world, 100, 0, "soldier");
      for (const id of [second, gap])
        a.world.getComponent<FactionComponent>(id, "Faction")!.team = 4;
      a.time.delta = 900;
      systems.animation.update();
      systems.bones.update();
      a.collision.update(false);
      a.hits.update();
      expect(
        a.queue.events.length === 2 &&
          a.queue.events[0].targetId === a.target &&
          a.queue.events[1].targetId === second,
        "A finished window was lost or the inactive gap dealt damage",
      );
      expect(!a.world.hasComponent(a.id, "HitboxSweep"), "Consumed windows were retained");
    } finally {
      AssetLoader.animations.delete(name);
    }
  },
  async function testFirstActiveBoneSweepDoesNotBridgeATeleport() {
    const a = fixture("soldier", "soldier", 100),
      name = "arena_first_window_teleport_test";
    const systems = linearWindows(a, name, [[0.2, 0.4]]);
    try {
      a.transform.position.x = 200;
      a.time.delta = 300;
      systems.animation.update();
      systems.bones.update();
      a.collision.update(false);
      a.hits.update();
      expect(
        a.queue.events.length === 0,
        "First active sample bridged the old rig position after teleportation",
      );
    } finally {
      AssetLoader.animations.delete(name);
    }
  },
  async function testEvasionRejectsUnsupportedLedgesAndLivingBodies() {
    for (const ledge of [true, false]) {
      const a = fixture("duelist");
      incoming(a);
      if (ledge) {
        const platform = a.world.query("Platform", "Collider", "Transform")[0];
        platform.components[1].hurtboxes[0].width = 100;
        platform.components[2].position.x = -50;
      } else createEnemy(a.world, -50, 0, "soldier");
      random(0, () => think(a, new DuelistStrategy(), 10));
      expect(
        a.movement.current !== "backstep",
        ledge
          ? "NPC backstepped off an unsupported edge"
          : "NPC backstepped into another living body",
      );
    }
  },
  async function testDefensiveTurnCanFaceAnUnassignedRearAttacker() {
    const a = fixture("duelist"),
      other = createEnemy(a.world, -20, 0, "brute");
    a.world.getComponent<FactionComponent>(other, "Faction")!.team = 4;
    a.world.getComponent<TransformComponent>(other, "Transform")!.facing = 1;
    const attack = a.world.getComponent<CombatComponent>(other, "Combat")!;
    Object.assign(attack, { attackState: "windup", attackTimer: 400, attackZone: 1 });
    a.ai.behaviorParams.parryChance = 1;
    a.ai.decisionTimer = 0;
    a.ai.dodgeCooldownTimer = 10000;
    random(0, () => think(a, new DuelistStrategy(), 6));
    attack.attackTimer = 60;
    random(0, () => think(a, new DuelistStrategy(), 1));
    expect(
      a.transform.facing === -1 &&
        a.combat.attackState === "parry" &&
        a.combat.attackZone === 1 &&
        a.ai.target === a.target,
      "Assigned-target turning prevented a rear-threat defensive response",
    );
  },
  async function testWallPinnedBodyGivesItsSeparationShareToTheFreeActor() {
    const a = fixture("hellhound", "boss", 8);
    createPlatform(a.world, 18.5, -130, 20, 130, "solid");
    a.collision.update();
    expect(
      !aabbIntersects(actorBounds(a.world, a.id)!, actorBounds(a.world, a.target)!),
      "Wall-pinned pair retained a body overlap",
    );
    expect(
      actorBounds(a.world, a.target)!.x + actorBounds(a.world, a.target)!.width <= 18.5001,
      "Separation pushed the Boss into its wall",
    );
  },
  async function testDownwardWeaponContactDoesNotRecoilFromTheGround() {
    const a = fixture("brute", "soldier", 80),
      box = swing(a, 20, 45);
    box.offset.y = -3;
    box.height = 20;
    a.hits.update();
    expect(
      a.queue.events.length === 0 && a.world.hasComponent(a.id, "ActiveHitbox"),
      "Downward strike recoiled from the supporting floor",
    );
  },
  async function testLowFlankJumpCannotClearATallBodyDespiteAnEmptyLanding() {
    const a = fixture("hellhound", "boss", 30);
    // Preserve the normal regular-creature jump rather than assuming a human jump.
    expect(
      !flankLanding(a.world, a.id, a.target, a.ai.behaviorParams.flankJumpSpeed ?? 360),
      "Low jump accepted a route through a tall opponent",
    );
  },
  async function testFeintsDoNotResampleTheDodgeChanceForTheSameCommittedSwing() {
    const a = fixture("rogue");
    incoming(a);
    const strategy = new RogueStrategy();
    let calls = 0;
    const original = Math.random;
    try {
      Math.random = () => {
        calls++;
        return 0.99;
      };
      think(a, strategy, 10);
      a.targetCombat.attackTiming = {
        animation: "feint-test",
        elapsed: 0,
        windup: 100,
        active: 100,
        recovery: 100,
        hitStart: 100,
        hitEnd: 200,
        duration: 300,
        phase: "windup",
        baseHitDamage: 20,
      };
      think(a, strategy, 10);
      a.targetCombat.attackTiming = undefined;
      think(a, strategy, 10);
      expect(
        calls === 2 && a.movement.current !== "roll",
        "Feint timing resets rerolled a failed dodge",
      );
    } finally {
      Math.random = original;
    }
  },
  async function testRecoilRetractsThroughExistingRecoveryKeysAfterHitstop() {
    const a = fixture("brute"),
      name = "brute_heavy_attack_mid",
      clip = AssetLoader.getAnimation(name)!;
    const animation = new AnimationSystem(a.world),
      bones = new SkeletonSystem(a.world);
    beginAnimation(a.animator, name);
    a.combat.attackState = "active";
    animation.preview = { time: clip.duration * 0.65, delta: 0, loop: false, emitEvents: false };
    animation.update();
    bones.update();
    animation.preview = null;
    const displayed = JSON.stringify(
      a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!.currentPose,
    );
    a.queue.events.push({
      attackerId: a.id,
      targetId: -1,
      damage: 0,
      poiseDamage: 0,
      zone: 2,
      attackType: "heavy",
      knockback: { x: 0, y: 0 },
      impactPoint: { x: 40, y: -30 },
      isBlockable: false,
    });
    a.damage.update();
    animation.update();
    bones.update();
    expect(
      JSON.stringify(a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!.currentPose) ===
        displayed,
      "Weapon popped to a new pose during impact hitstop",
    );
    const end =
      Math.max(...clip.events!.filter((e) => e.type === "hitbox-end").map((e) => e.time)) *
      clip.duration;
    expect(
      a.animator.time >= end && a.combat.attackTimer === 200,
      "Recoil continued the active swing or changed recovery duration",
    );
    a.world.removeComponent(a.id, "HitStop");
    for (let frame = 0; frame < 8; frame++) animation.update();
    expect(!a.world.hasComponent(a.id, "ActiveHitbox"), "Recovery reactivated a canceled weapon");
  },
  async function testCombatDirectorBreaksEqualReadinessTiesWithoutEntityIdBias() {
    const picked = new Set<number>();
    for (const roll of [0, 0.99]) {
      const a = fixture("soldier", "soldier", 20);
      a.ai.hasAttackToken = false;
      a.ai.attackCooldownTimer = 0;
      const ally = createEnemy(a.world, -10, 0, "soldier");
      a.world.getComponent<FactionComponent>(ally, "Faction")!.team = 3;
      a.world.getComponent<TransformComponent>(ally, "Transform")!.facing = 1;
      a.world.getComponent<PhysicsComponent>(ally, "Physics")!.grounded = true;
      Object.assign(a.world.getComponent<AIControllerComponent>(ally, "AIController")!, {
        state: "combat",
        target: a.target,
        attackCooldownTimer: 0,
        hasAttackToken: false,
      });
      a.world.getResource<CombatDirectorState>(CombatDirectorState).maxTokens = 1;
      random(roll, () => new CombatDirectorSystem(a.world).update());
      const tokenOwner = a.ai.hasAttackToken ? a.id : ally;
      picked.add(tokenOwner);
    }
    expect(picked.size === 2, "Co-ready attackers always awarded first token to the same EntityId");
  },
  async function testMixedSkirmisherVsHeavyArenaShowsVariedOpeningsAndCompletes(game: Game) {
    const previous = Math.random;
    const traces: string[] = [];
    try {
      for (const seed of [11, 29, 53, 89]) {
        let state = seed;
        Math.random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
        game.startBattle("hellhound", "rogue", "brute", "duelist");
        const battle = game.world.getResource<BattleState>(BattleState);
        const rogue = game.world
          .query("EnemyTag")
          .find((e) => (e.components[0] as any).enemyType === "rogue")!.id;
        let firstFlankFrame = -1;
        let firstAttackFrame = -1;
        for (let frame = 0; frame < 5400 && !battle.winner; frame++) {
          game.update(1000 / 60);
          const rAi = game.world.getComponent<AIControllerComponent>(rogue, "AIController");
          const rCombat = game.world.getComponent<CombatComponent>(rogue, "Combat");
          if (firstFlankFrame < 0 && rAi?.isFlanking) firstFlankFrame = frame;
          if (firstAttackFrame < 0 && rCombat?.attackState === "windup") firstAttackFrame = frame;
        }
        expect(!!battle.winner, `Hellhound/Rogue vs Brute/Duelist stalled on seed ${seed}`);
        traces.push(`${firstFlankFrame}:${firstAttackFrame}`);
      }
      expect(
        new Set(traces).size > 1,
        `Arena opening script stayed identical across all seeds (${traces.join(", ")})`,
      );
    } finally {
      Math.random = previous;
    }
  },
];
