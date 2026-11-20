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
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { AISystem } from "../features/ai/AISystem";
import { CombatDirectorSystem } from "../features/ai/CombatDirectorSystem";
import {
  HollowStrategy,
  SoldierStrategy,
  DuelistStrategy,
  RogueStrategy,
  BruteStrategy,
  BossStrategy,
} from "../features/ai/EnemyStrategies";
import { canAttackTarget, getIncomingAttack } from "../features/ai/CombatReach";
import { flankLanding, flankLandingHazard } from "../features/ai/FlankPlanning";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { CombatComponent } from "../features/combat/CombatComponent";
import { CombatSystem } from "../features/combat/CombatSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { MovementSystem } from "../features/movement/MovementSystem";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { TransformComponent } from "../components/Transform";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { FactionComponent } from "../components/Faction";
import { PlatformComponent } from "../components/Platform";
import { ColliderComponent } from "../components/Collider";

type EnemyType = Exclude<Parameters<typeof createEnemy>[3], "hellhound" | "alpha_hellhound">;
const types: EnemyType[] = ["hollow", "soldier", "duelist", "brute", "rogue", "boss"];
const strategies = {
  hollow: new HollowStrategy(),
  soldier: new SoldierStrategy(),
  duelist: new DuelistStrategy(),
  brute: new BruteStrategy(),
  rogue: new RogueStrategy(),
  boss: new BossStrategy(),
};
function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function withRandom<T>(value: number, run: () => T): T {
  const original = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = original;
  }
}
function actor(world: World, x: number, type: EnemyType) {
  const id = createEnemy(world, x, 0, type);
  const ai = world.getComponent<AIControllerComponent>(id, "AIController")!;
  Object.assign(ai, {
    state: "combat",
    attackDecisionTimer: 0,
    decisionTimer: 10000,
    flankTimer: 10000,
  });
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  transform.facing = 1;
  const physics = world.getComponent<PhysicsComponent>(id, "Physics")!;
  physics.grounded = true;
  return {
    id,
    ai,
    transform,
    physics,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    stamina: world.getComponent<StaminaComponent>(id, "Stamina")!,
    health: world.getComponent<HealthComponent>(id, "Health")!,
    movement: world.getComponent<MovementStateComponent>(id, "MovementState")!,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
  };
}
function fixture(type: EnemyType = "soldier", distance = 20) {
  const world = new World();
  const time = Object.assign(new TimeState(), { delta: 1000 / 60, elapsed: 1000 });
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
  const a = actor(world, 0, type);
  const target = createPlayer(world, distance, 0);
  world.getComponent<PhysicsComponent>(target, "Physics")!.grounded = true;
  a.ai.target = target;
  const targetTransform = world.getComponent<TransformComponent>(target, "Transform")!;
  targetTransform.facing = -1;
  const targetCombat = world.getComponent<CombatComponent>(target, "Combat")!;
  return { ...a, world, time, target, targetTransform, targetCombat, strategy: strategies[type] };
}
function windup(a: ReturnType<typeof fixture>, remaining = 60) {
  a.targetCombat.attackState = "windup";
  a.targetCombat.attackTimer = remaining;
  a.targetCombat.attackZone = 3;
}

export const tests = [
  async function testPinnedRetreatLowersGuardAndRecoversForEveryRetreatingNPC() {
    for (const type of types.filter((t) => t !== "boss")) {
      const a = fixture(type);
      a.ai.state = "retreat";
      a.ai.stateTimer = 2000;
      a.stamina.current = 15;
      a.combat.isBlocking = true;
      const movement = new MovementSystem(a.world);
      a.strategy.update(a.time.delta, a.id, a.world);
      expect(!a.combat.isBlocking, `${type} kept guarding below its recovery reserve`);
      for (let frame = 0; frame < 150 && a.ai.state === "retreat"; frame++) {
        movement.update();
        a.strategy.update(a.time.delta, a.id, a.world);
        // Positions stay pinned by the crowd; recovery must not depend on escaping it.
      }
      expect(
        (a.ai.state as string) === "combat" && a.stamina.current > 20,
        `${type} never recovered from a pinned retreat`,
      );
    }
  },
  async function testLowStaminaDoesNotRetreatDuringCommittedAttackOrParry() {
    for (const state of ["windup", "active", "recovery", "parry"] as const) {
      const a = fixture();
      a.stamina.current = 5;
      a.ai.hasAttackToken = true;
      a.combat.attackState = state;
      a.strategy.update(16, a.id, a.world);
      expect(
        a.ai.state === "combat" && a.combat.attackState === state,
        `Recovery interrupted ${state}`,
      );
    }
  },
  async function testCorneredNPCsCannotOverdrawAttackStamina() {
    for (const type of types) {
      const a = fixture(type, 10);
      a.ai.staminaRetreatThreshold = -1;
      createPlatform(a.world, -25, -70, 10, 70, "solid");
      const cost = a.ai.behaviorParams.hyperArmor ? 30 : 15;
      a.stamina.current = cost - 1;
      withRandom(0.8, () => a.strategy.update(0, a.id, a.world));
      expect(
        a.combat.attackState === "idle" &&
          a.stamina.current === cost - 1 &&
          a.ai.attackCooldownTimer === 0,
        `${type} started an unaffordable cornered attack`,
      );
      a.stamina.current = cost;
      a.combat.isBlocking = true;
      withRandom(0.8, () => a.strategy.update(0, a.id, a.world));
      expect(
        a.combat.attackState === "windup" && a.stamina.current === 0 && !a.combat.isBlocking,
        `${type} failed to spend an affordable attack cost or retained its guard`,
      );
    }
  },
  async function testExhaustedNPCsCannotAttackEvenWithAFullReserve() {
    for (const type of types) {
      const a = fixture(type, 10);
      a.ai.hasAttackToken = true;
      a.stamina.isExhausted = true;
      withRandom(0.8, () => a.strategy.update(0, a.id, a.world));
      expect(
        a.combat.attackState === "idle" && a.stamina.current === 100,
        `${type} attacked while exhausted`,
      );
    }
  },
  async function testHollowCorneredGuardStillReconsidersAndAllowsRecovery() {
    const a = fixture("hollow", 10);
    a.stamina.current = 14;
    a.ai.decisionTimer = 0;
    createPlatform(a.world, -25, -70, 10, 70, "solid");
    withRandom(0, () => a.strategy.update(16, a.id, a.world));
    expect(
      a.combat.isBlocking && a.combat.attackState === "idle",
      "Hollow lost its existing occasional cornered guard",
    );
    withRandom(0.8, () => a.strategy.update(500, a.id, a.world));
    expect(!a.combat.isBlocking, "Hollow did not reconsider its brief cornered guard");
    for (let frame = 0; frame < 4; frame++) {
      a.ai.attackDecisionTimer = 0;
      new MovementSystem(a.world).update();
      withRandom(0.8, () => a.strategy.update(16, a.id, a.world));
    }
    expect(
      a.combat.attackState === "windup" && a.stamina.current >= 0,
      "Hollow could not recover into an affordable cornered attack",
    );
  },
  async function testBossUsesDirectorPermissionWithoutBlockingPhaseChanges() {
    const a = fixture("boss");
    withRandom(0, () => a.strategy.update(0, a.id, a.world));
    expect(
      a.combat.attackState === "idle",
      "Boss bypassed the director without a cornered exception",
    );
    a.health.current = 200;
    a.strategy.update(0, a.id, a.world);
    expect(
      a.ai.currentPhase === 1 && a.combat.attackState === "stagger",
      "Token availability delayed the Boss phase",
    );
    a.combat.attackState = "idle";
    a.ai.attackCooldownTimer = 0;
    a.ai.hasAttackToken = true;
    withRandom(0, () => a.strategy.update(0, a.id, a.world));
    expect(
      (a.combat.attackState as string) === "windup" && a.animator.currentAnim.includes("special"),
      "Boss lost its permitted special attack",
    );
  },
  async function testDirectorAcceptsExactCostsAndRejectsExhaustedRequests() {
    for (const type of ["soldier", "boss"] as const) {
      const a = fixture(type);
      const director = new CombatDirectorSystem(a.world);
      a.stamina.current = type === "boss" ? 30 : 15;
      director.update();
      expect(a.ai.hasAttackToken, `${type} could not reserve an affordable attack`);
      a.stamina.isExhausted = true;
      director.update();
      expect(
        !a.ai.hasAttackToken &&
          a.world.getResource<CombatDirectorState>(CombatDirectorState).activeTokens.size === 0,
        "Director retained an exhausted idle reservation",
      );
    }
  },
  async function testNPCDefensesIgnoreDistantAndMisdirectedSwings() {
    for (const type of ["soldier", "duelist", "rogue"] as const)
      for (const far of [true, false]) {
        const a = fixture(type, far ? 200 : 20);
        windup(a);
        a.ai.decisionTimer = 0;
        a.ai.dodgeCooldownTimer = 0;
        if (!far) a.targetTransform.facing = 1;
        withRandom(0, () => a.strategy.update(16, a.id, a.world));
        expect(
          a.combat.attackState === "idle" &&
            !a.combat.isBlocking &&
            a.movement.rollTimer === 0 &&
            a.movement.backstepTimer === 0,
          `${type} defended against a swing that could not reach it`,
        );
        expect(a.stamina.current === 100, `${type} spent stamina on a harmless swing`);
      }
  },
  async function testIncomingAttackRespectsWallsHeightAndScaledTerrain() {
    const a = fixture();
    windup(a);
    expect(
      !!getIncomingAttack(a.world, a.transform, a.target),
      "Valid incoming attack was rejected",
    );
    a.targetTransform.position.y = -80;
    expect(
      !getIncomingAttack(a.world, a.transform, a.target),
      "Defense reacted across different platforms",
    );
    a.targetTransform.position.y = 0;
    const wall = createPlatform(a.world, 10, 0, 5, 20, "solid");
    a.world.getComponent<ColliderComponent>(wall, "Collider")!.hurtboxes[0].y = -20;
    a.world.getComponent<TransformComponent>(wall, "Transform")!.scale.y = 3;
    expect(
      !canAttackTarget(a.world, a.transform, a.targetTransform) &&
        !getIncomingAttack(a.world, a.transform, a.target),
      "Scaled solid terrain did not block attacks and reactions",
    );
    a.world.getComponent<PlatformComponent>(wall, "Platform")!.collidable = false;
    expect(
      !!getIncomingAttack(a.world, a.transform, a.target),
      "Decorative terrain blocked defensive reactions",
    );
  },
  async function testSoldierWaitsForImminentImpactAndTracksParryZone() {
    const a = fixture();
    windup(a, 400);
    a.ai.decisionTimer = 0;
    a.ai.behaviorParams.parryChance = 1;
    withRandom(0, () => a.strategy.update(16, a.id, a.world));
    expect(
      a.combat.attackState === "idle" && a.ai.decisionTimer === 0,
      "Soldier burned its parry during early windup",
    );
    a.time.elapsed += 100;
    a.targetCombat.attackTimer = 60;
    withRandom(0, () => a.strategy.update(16, a.id, a.world));
    expect(
      a.combat.attackState === "parry" && a.combat.attackZone === 3 && !a.combat.isBlocking,
      "Soldier parry did not match the imminent strike",
    );
  },
  async function testParryWindowSurvivesCombatClockAndResolvesHighAndLowHits() {
    for (const type of ["soldier", "duelist"] as const)
      for (const zone of [1, 3] as const) {
        const a = fixture(type);
        a.ai.decisionTimer = 0;
        a.ai.dodgeCooldownTimer = 10000;
        a.ai.behaviorParams.parryChance = 1;
        a.targetCombat.attackState = "windup";
        a.targetCombat.attackTimer = 400;
        a.targetCombat.attackZone = zone;
        a.targetCombat.attackType = "light";
        beginAnimation(
          a.world.getComponent<AnimatorComponent>(a.target, "Animator")!,
          `light_attack_${zone === 1 ? "high" : "low"}`,
        );
        const combat = new CombatSystem(a.world),
          animation = new AnimationSystem(a.world),
          bones = new SkeletonSystem(a.world);
        let connected = false;
        for (let frame = 0; frame < 40; frame++) {
          withRandom(0, () => a.strategy.update(a.time.delta, a.id, a.world));
          combat.update();
          animation.update();
          bones.update();
          a.time.elapsed += a.time.delta;
          if ((a.targetCombat.attackState as string) === "active") {
            expect(
              a.combat.attackState === "parry" && a.combat.attackTimer > 0,
              `${type}'s parry expired before impact`,
            );
            a.world.getResource<CombatEventQueue>(CombatEventQueue).events.push({
              attackerId: a.target,
              targetId: a.id,
              damage: 20,
              poiseDamage: 20,
              zone,
              attackType: "light",
              knockback: { x: 100, y: 0 },
              impactPoint: { x: 0, y: -30 },
              isBlockable: true,
            });
            new DamageSystem(a.world).update();
            connected = true;
            break;
          }
        }
        expect(
          connected &&
            a.combat.counterWindowActive &&
            a.health.current === a.health.max &&
            (a.targetCombat.attackState as string) === "stagger",
          `${type} failed to parry zone ${zone} through the damage system`,
        );
      }
  },
  async function testParryProbabilityIsSampledOncePerImminentDecision() {
    const a = fixture();
    windup(a);
    a.ai.decisionTimer = 0;
    a.ai.behaviorParams.parryChance = 0.5;
    withRandom(0.9, () => a.strategy.update(16, a.id, a.world));
    a.time.elapsed += 100;
    withRandom(0.9, () => a.strategy.update(16, a.id, a.world));
    withRandom(0, () => a.strategy.update(16, a.id, a.world));
    expect(
      a.combat.attackState === "idle" && a.ai.decisionTimer > 0,
      "Failed parry rerolled on every frame",
    );
  },
  async function testSoldierGuardTracksTheCurrentMultiStrikeHitbox() {
    const a = fixture();
    a.targetCombat.attackState = "active";
    a.targetCombat.attackZone = 3;
    a.world.addComponent<ActiveHitboxComponent>(a.target, "ActiveHitbox", {
      offset: { x: 10, y: -30 },
      width: 20,
      height: 10,
      rotation: 0,
      damage: 10,
      poiseDamage: 10,
      knockback: { x: 0, y: 0 },
      zone: 1,
      attackType: "light",
      alreadyHit: new Set(),
      sourceEntityId: a.target,
    });
    a.strategy.update(16, a.id, a.world);
    a.time.elapsed += 100;
    a.strategy.update(16, a.id, a.world);
    expect(
      a.combat.isBlocking && a.combat.blockZone === 1,
      "Soldier guarded the previous strike's zone",
    );
  },
  async function testEvasionRequiresGroundAndPreservesLockedMovementState() {
    for (const type of ["duelist", "rogue"] as const)
      for (const grounded of [false, true]) {
        const a = fixture(type, 30);
        windup(a);
        a.ai.dodgeCooldownTimer = 0;
        a.physics.grounded = grounded;
        for (let frame = 0; frame < 6; frame++) {
          a.time.elapsed += 16;
          withRandom(0, () => new AISystem(a.world).update());
        }
        const timer = type === "rogue" ? a.movement.rollTimer : a.movement.backstepTimer;
        expect(
          grounded
            ? timer > 0 && a.movement.current === (type === "rogue" ? "roll" : "backstep")
            : timer === 0,
          `${type} evaded in midair or lost its locked movement state`,
        );
      }
  },
  async function testExhaustedNPCsCannotParryOrEvade() {
    for (const type of ["soldier", "duelist", "rogue"] as const) {
      const a = fixture(type);
      windup(a);
      a.ai.decisionTimer = 0;
      a.ai.dodgeCooldownTimer = 0;
      a.stamina.isExhausted = true;
      withRandom(0, () => a.strategy.update(16, a.id, a.world));
      expect(
        a.combat.attackState === "idle" &&
          !a.combat.isBlocking &&
          a.movement.rollTimer === 0 &&
          a.movement.backstepTimer === 0,
        `${type} defended while exhausted`,
      );
    }
  },
  async function testFeintsRespectCapabilityAndAvailableStamina() {
    for (const enabled of [false, true])
      for (const reserve of [4, 5]) {
        const a = fixture("duelist");
        a.ai.behaviorParams.canFeint = enabled;
        a.ai.wantsToFeint = true;
        a.combat.attackState = "windup";
        a.combat.attackZone = 2;
        a.combat.attackTimer = a.ai.behaviorParams.windupFrames * 16.66 * 0.5;
        a.stamina.current = reserve;
        new AISystem(a.world).update();
        const permitted = enabled && reserve >= 5;
        expect(
          a.ai.feintTriggered === permitted && a.stamina.current === reserve - (permitted ? 5 : 0),
          "Feint ignored its capability or cost",
        );
        expect(a.ai.state === "combat", "Feint stamina spending interrupted its own windup");
      }
  },
  async function testFlankRecognizesAlliesWithDifferentTargetsAndCommitsTheJump() {
    const a = fixture("hollow", 100);
    a.ai.flankTimer = 0;
    const ally = actor(a.world, 50, "soldier");
    ally.ai.target = createPlayer(a.world, 150, 0);
    withRandom(0, () => a.strategy.update(16, a.id, a.world));
    expect(
      a.ai.isFlanking &&
        !a.physics.grounded &&
        a.physics.velocity.y < 0 &&
        a.physics.velocity.x > 0,
      "Flanker ignored an obstructing ally assigned to another opponent",
    );
    expect(
      a.combat.attackState === "idle" && !a.combat.isBlocking && a.stamina.current === 90,
      "Flank also attacked or guarded on its launch frame",
    );
  },
  async function testFlankIgnoresDeadHostileAndOtherPlatformActors() {
    for (const invalid of ["dead", "hostile", "above"] as const) {
      const a = fixture("hollow", 100);
      a.ai.flankTimer = 0;
      const ally = actor(a.world, 50, "soldier");
      ally.ai.target = a.target;
      if (invalid === "dead") ally.health.current = 0;
      if (invalid === "hostile")
        a.world.getComponent<FactionComponent>(ally.id, "Faction")!.team = 3;
      if (invalid === "above") ally.transform.position.y = -100;
      a.strategy.update(16, a.id, a.world);
      expect(
        !a.ai.isFlanking && a.stamina.current === 100,
        `Flank considered a ${invalid} actor an obstructing ally`,
      );
    }
  },
  async function testNonCollidableWallDoesNotTriggerCorneredAttackExceptions() {
    const a = fixture("hollow");
    const wall = createPlatform(a.world, -25, -70, 10, 70, "solid");
    a.world.getComponent<PlatformComponent>(wall, "Platform")!.collidable = false;
    a.strategy.update(0, a.id, a.world);
    expect(
      a.combat.attackState === "idle",
      "Decorative wall allowed a cornered attack without permission",
    );
  },
  async function testInvalidTargetsReleaseTokensGuardAndNavigation() {
    for (const invalid of [
      "dead",
      "zeroHealth",
      "friendly",
      "noTransform",
      "noHealth",
      "noFaction",
    ] as const) {
      const a = fixture();
      a.combat.isBlocking = true;
      a.ai.currentPath = [{ x: 100, y: 0 }];
      a.ai.lastPathTarget = { x: 100, y: 0 };
      a.ai.hasAttackToken = true;
      a.world.getResource<CombatDirectorState>(CombatDirectorState).requestToken(a.id);
      const health = a.world.getComponent<HealthComponent>(a.target, "Health")!;
      if (invalid === "dead") health.isDead = true;
      if (invalid === "zeroHealth") health.current = 0;
      if (invalid === "friendly")
        a.world.getComponent<FactionComponent>(a.target, "Faction")!.team = 2;
      if (invalid === "noTransform") a.world.removeComponent(a.target, "Transform");
      if (invalid === "noHealth") a.world.removeComponent(a.target, "Health");
      if (invalid === "noFaction") a.world.removeComponent(a.target, "Faction");
      new CombatDirectorSystem(a.world).update();
      new AISystem(a.world).update();
      expect(
        a.ai.target === null &&
          !a.ai.hasAttackToken &&
          !a.combat.isBlocking &&
          a.ai.currentPath.length === 0 &&
          !a.ai.lastPathTarget,
        `Invalid ${invalid} target retained combat state`,
      );
    }
  },
  async function testValidAssignedTargetsArePreservedAndNonCombatTargetsAreSafe() {
    for (const type of ["soldier", "duelist", "rogue"] as const) {
      const a = fixture(type, 150);
      createPlayer(a.world, 10, 0);
      a.world.removeComponent(a.target, "Combat");
      new AISystem(a.world).update();
      expect(a.ai.target === a.target, `${type} abandoned its valid assigned target`);
    }
  },
  async function testSharedNPCBehaviorDoesNotChangeWithSimulatorFlag() {
    for (const type of types) {
      const snapshots = [false, true].map((active) => {
        const a = fixture(type);
        a.world.getResource<BattleState>(BattleState).isActive = active;
        a.ai.hasAttackToken = true;
        windup(a);
        a.ai.dodgeCooldownTimer = 0;
        withRandom(0.8, () => new AISystem(a.world).update());
        return JSON.stringify({
          state: a.ai.state,
          attack: a.combat.attackState,
          guard: a.combat.isBlocking,
          zone: a.combat.blockZone,
          stamina: a.stamina.current,
          vx: a.physics.velocity.x,
          anim: a.animator.currentAnim,
        });
      });
      expect(snapshots[0] === snapshots[1], `${type} has a simulator-only strategy`);
    }
  },
  async function testArenaReplacementTargetsIgnoreAggroWhileCampaignDetectionKeepsItsRange() {
    for (const arena of [false, true]) {
      const a = fixture("soldier", 700);
      a.ai.target = null;
      a.ai.state = "idle";
      a.world.getResource<BattleState>(BattleState).isActive = arena;
      new AISystem(a.world).update();
      expect(
        arena
          ? a.ai.target === a.target && (a.ai.state as string) === "combat"
          : a.ai.target === null && a.ai.state === "idle",
        "Arena survivors lost their opponent assignment or campaign aggro became unlimited",
      );
    }
  },
  async function testMixedSoldierRogueSurvivorsReengageAfterAssignedOpponentsDie(game: Game) {
    const original = Math.random;
    let randomState = 3;
    Math.random = () =>
      (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296;
    try {
      game.startBattle("soldier", "rogue", "rogue", "soldier");
      const battle = game.world.getResource<BattleState>(BattleState);
      for (let frame = 0; frame < 7200 && !battle.winner; frame++) game.update(1000 / 60);
      expect(
        !!battle.winner,
        "Mixed arena survivors patrolled indefinitely after their original targets died",
      );
    } finally {
      Math.random = original;
    }
  },
  async function testAllSoldierArenaFinishesPreviouslyStalledSeeds(game: Game) {
    const original = Math.random;
    try {
      for (const seed of [3, 20261010, 99]) {
        let randomState = seed;
        Math.random = () =>
          (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296;
        game.startBattle("soldier", "soldier", "soldier", "soldier");
        const battle = game.world.getResource<BattleState>(BattleState);
        for (let frame = 0; frame < 7200 && !battle.winner; frame++) game.update(1000 / 60);
        expect(!!battle.winner, `All-Soldier battle remained stuck for seed ${seed}`);
      }
    } finally {
      Math.random = original;
    }
  },
  async function testBlockedFlankProbabilisticallyDefersAndDetectsMultiEnemyLandingDanger() {
    const a = fixture("rogue", 100);
    a.ai.flankTimer = 0;
    const ally = actor(a.world, 50, "hollow");
    ally.ai.target = a.target;
    withRandom(0.9, () => a.strategy.update(16, a.id, a.world));
    expect(
      !a.ai.isFlanking && a.ai.flankTimer >= 350 && a.physics.grounded,
      "Deferred flank still launched unconditionally",
    );

    const extraHostile = createEnemy(a.world, 145, 0, "brute");
    a.world.getComponent<PhysicsComponent>(extraHostile, "Physics")!.grounded = true;
    a.world.getComponent<FactionComponent>(extraHostile, "Faction")!.team =
      a.world.getComponent<FactionComponent>(a.target, "Faction")!.team;
    a.world.getComponent<TransformComponent>(extraHostile, "Transform")!.facing = -1;
    a.world.getComponent<CombatComponent>(extraHostile, "Combat")!.attackState = "windup";
    const landing = flankLanding(a.world, a.id, a.target, 650)!;
    const hazard = flankLandingHazard(a.world, a.id, a.target, landing);
    expect(
      hazard.enemiesNearLanding >= 2 && hazard.activeThreatOnLanding,
      "Flank hazard detection missed crowded or actively swinging landing",
    );
  },
  async function testDuelistAndBruteUseConfiguredBlockChanceOnObservedFrontThreats() {
    for (const type of ["duelist", "brute"] as const) {
      const a = fixture(type, 25);
      a.ai.decisionTimer = 0;
      a.ai.dodgeCooldownTimer = 10000;
      a.ai.attackCooldownTimer = 1000;
      a.ai.behaviorParams.canParry = false;
      windup(a, 150);
      a.targetCombat.attackZone = 1;
      withRandom(0, () => {
        for (let i = 0; i < 6; i++) {
          a.time.elapsed += 16;
          a.strategy.update(16, a.id, a.world);
        }
      });
      expect(
        a.combat.isBlocking && a.combat.blockZone === 1,
        `${type} did not raise guard for an observed front threat`,
      );
      a.targetCombat.attackState = "idle";
      a.strategy.update(16, a.id, a.world);
      expect(!a.combat.isBlocking, `${type} held guard after incoming threat ended`);
    }
  },
  async function testRogueVaultsOverAttackerWhenBackwardRollIsBlocked() {
    const a = fixture("rogue", 25);
    a.ai.flankTimer = 0;
    a.ai.dodgeCooldownTimer = 0;
    createPlatform(a.world, -80, -80, 20, 80, "solid");
    windup(a, 150);
    withRandom(0, () => {
      for (let i = 0; i < 6; i++) {
        a.time.elapsed += 16;
        a.strategy.update(16, a.id, a.world);
      }
    });
    expect(
      a.ai.isFlanking && !a.physics.grounded && a.physics.velocity.y < 0,
      "Trap-cornered Rogue failed to escape-vault over the attacker",
    );
  },
];
