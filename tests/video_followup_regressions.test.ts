import { World } from "../core/World";
import {
  TimeState,
  InputState,
  CameraState,
  SpatialGridState,
  CombatEventQueue,
  CombatDirectorState,
  BattleState,
  GlobalLight,
  EditorState,
} from "../core/Resources";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { HealthComponent } from "../components/Health";
import { FactionComponent } from "../components/Faction";
import { StaminaComponent } from "../components/Stamina";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { CombatComponent } from "../features/combat/CombatComponent";
import { DamageSystem } from "../features/combat/DamageSystem";
import { CombatSystem } from "../features/combat/CombatSystem";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { SoldierStrategy, BruteStrategy } from "../features/ai/EnemyStrategies";
import { HellhoundStrategy } from "../features/ai/HellhoundStrategy";
import { CombatDirectorSystem } from "../features/ai/CombatDirectorSystem";
import { animationAttackRange, animationCanReach, attackRange } from "../features/ai/CombatReach";
import { flankLanding } from "../features/ai/FlankPlanning";
import { bodyContactDistance } from "../features/combat/BodySeparation";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { AssetLoader } from "../assets/AssetLoader";
import { CollisionSystem } from "../systems/CollisionSystem";
import { RenderSystem } from "../systems/RenderSystem";
import { SpriteCache } from "../utils/SpriteCache";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";

type Skin = Parameters<typeof createEnemy>[3] | "player";
function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
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
function fixture(source: Skin = "soldier", victim: Skin = "soldier", distance = 80) {
  const world = new World(),
    time = Object.assign(new TimeState(), { elapsed: 1000, delta: 1000 / 60 });
  world.setResource(TimeState, time);
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  world.setResource(CombatDirectorState, new CombatDirectorState());
  world.setResource(BattleState, new BattleState());
  world.setResource(GlobalLight, new GlobalLight());
  world.setResource(EditorState, new EditorState());
  createPlatform(world, -1500, 0, 3000, 40, "solid");
  const nav = new NavigationGraph();
  nav.build(world);
  world.setResource(NavigationGraph, nav);
  const make = (skin: Skin, x: number) =>
    skin === "player" ? createPlayer(world, x, 0) : createEnemy(world, x, 0, skin);
  const id = make(source, 0),
    target = make(victim, distance);
  for (const [actor, facing, team] of [
    [id, 1, 3],
    [target, -1, 4],
  ]) {
    world.getComponent<TransformComponent>(actor, "Transform")!.facing = facing as 1 | -1;
    world.getComponent<FactionComponent>(actor, "Faction")!.team = team;
    world.getComponent<PhysicsComponent>(actor, "Physics")!.grounded = true;
    const ai = world.getComponent<AIControllerComponent>(actor, "AIController");
    if (ai)
      Object.assign(ai, {
        target: actor === id ? target : id,
        state: "combat",
        attackCooldownTimer: 0,
        attackDecisionTimer: 0,
        hellhoundDecisionTimer: 0,
        decisionTimer: 10000,
        flankTimer: 10000,
        hasAttackToken: true,
      });
  }
  const animation = new AnimationSystem(world),
    bones = new SkeletonSystem(world),
    collision = new CollisionSystem(world);
  animation.update();
  bones.update();
  collision.update(false);
  return {
    world,
    time,
    id,
    target,
    animation,
    bones,
    collision,
    ai: world.getComponent<AIControllerComponent>(id, "AIController")!,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    targetCombat: world.getComponent<CombatComponent>(target, "Combat")!,
    transform: world.getComponent<TransformComponent>(id, "Transform")!,
    targetTransform: world.getComponent<TransformComponent>(target, "Transform")!,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
    stamina: world.getComponent<StaminaComponent>(id, "Stamina")!,
  };
}
function ally(a: ReturnType<typeof fixture>, x: number) {
  const id = createEnemy(a.world, x, 0, "soldier");
  a.world.getComponent<FactionComponent>(id, "Faction")!.team = 3;
  a.world.getComponent<PhysicsComponent>(id, "Physics")!.grounded = true;
  Object.assign(a.world.getComponent<AIControllerComponent>(id, "AIController")!, {
    target: a.target,
    state: "combat",
    hasAttackToken: false,
  });
  return id;
}
function special(a: ReturnType<typeof fixture>, cooldown = 100) {
  const animator = a.world.getComponent<AnimatorComponent>(a.target, "Animator")!;
  beginAnimation(animator, "alpha_hellhound_special_attack_slam");
  Object.assign(a.targetCombat, {
    attackState: "windup",
    attackSerial: 20,
    attackTimer: 1000,
    attackZone: 3,
  });
  a.ai.attackCooldownTimer = cooldown;
  a.ai.consecutiveHits = 2;
  a.ai.bossSpecialReadyAt = 0;
}
function observeSpecial(a: ReturnType<typeof fixture>, strategy: HellhoundStrategy) {
  random(0, () => strategy.update(0, a.id, a.world));
  a.time.elapsed += 110;
  a.ai.attackCooldownTimer = 0;
  random(0, () => strategy.update(0, a.id, a.world));
}

// Record the real renderer's per-bone paint order/opacity, with a small canvas
// state implementation. Pixel QA is separate; this checks the rendering rules.
function paints(a: ReturnType<typeof fixture>) {
  const records: { id: number; alpha: number; color: string }[] = [];
  let owner: number | undefined;
  const stack: { alpha: number; owner?: number; color: string }[] = [];
  const state: any = {
    canvas: { width: 1000, height: 800 },
    globalAlpha: 1,
    fillStyle: "black",
    save() {
      stack.push({ alpha: state.globalAlpha, owner, color: state.fillStyle });
    },
    restore() {
      const old = stack.pop()!;
      state.globalAlpha = old.alpha;
      owner = old.owner;
      state.fillStyle = old.color;
    },
    transform(...args: number[]) {
      owner = undefined;
      for (const {
        id,
        components: [s],
      } of a.world.query("Skeleton")) {
        if (
          [...(s as SkeletonComponent).worldTransforms.values()].some((m) =>
            [m.a, m.b, m.c, m.d, m.tx, m.ty].every((v, i) => Math.abs(v - args[i]) < 1e-7),
          )
        ) {
          owner = id;
          break;
        }
      }
    },
    fill() {
      if (owner !== undefined)
        records.push({ id: owner, alpha: state.globalAlpha, color: state.fillStyle });
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 10 }),
  };
  const ctx = new Proxy(state, { get: (target, key) => (key in target ? target[key] : () => {}) });
  const canvas = {
    width: 1000,
    height: 800,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  a.world.getResource<CameraState>(CameraState).position = { x: 0, y: -50 };
  a.collision.update(false);
  new RenderSystem(a.world, canvas, true).update();
  return records;
}
function deathPose(a: ReturnType<typeof fixture>, time: number) {
  a.world.removeComponent(a.id, "MovementState");
  a.world.removeComponent(a.id, "Combat");
  a.animator.currentAnim = "alpha_hellhound_death";
  a.animation.preview = { time, delta: 0, loop: false, emitEvents: false };
  a.animation.update();
  a.bones.update();
  const skeleton = a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!;
  let top = Infinity,
    bottom = -Infinity;
  for (const [bone, drawing] of Object.entries(EnemyBonePaths.alpha_hellhound)) {
    const m = skeleton.worldTransforms.get(bone);
    if (!m) continue;
    const coords = SpriteCache.getCoordinates(drawing.path);
    for (let i = 0; i < coords.length; i += 2) {
      const y = m.b * coords[i] + m.d * coords[i + 1] + m.ty;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { top, bottom, height: bottom - top, pose: structuredClone(skeleton.currentPose) };
}

export const tests = [
  async function testSampledUnreachableMoveHasNoNominalRangeFallback() {
    const a = fixture("brute", "player", 20);
    a.targetTransform.position.y = -300;
    a.bones.update();
    expect(
      !animationCanReach(a.world, a.id, a.target, "brute_heavy_attack_mid"),
      "Fixture was reachable",
    );
    expect(
      animationAttackRange(a.world, a.id, a.target, "brute_heavy_attack_mid") === 0,
      "Impossible posed contact retained nominal reach",
    );
  },
  async function testUnreachablePendingMoveCannotTrapAnOrdinaryAttack() {
    const a = fixture("brute", "soldier", 45);
    a.ai.pendingAttack = {
      target: a.target,
      animation: "brute_heavy_attack_mid",
      zone: 2,
      range: 0,
    };
    random(0.9, () => new BruteStrategy().update(0, a.id, a.world));
    expect(
      a.combat.attackState === "windup" && a.stamina.current === 70,
      "Zero-range pending selection stranded a reachable opponent",
    );
  },
  async function testImpossibleHighStrikeReselectsExistingLowMoveAgainstSmallCreature() {
    const a = fixture("soldier", "hellhound", 40);
    a.ai.currentComboIndex = 2; // Next ordinary choice is high; it cannot reach this body.
    const skeleton = a.world.getComponent<SkeletonComponent>(a.target, "Skeleton")!;
    skeleton.currentPose = structuredClone(
      AssetLoader.getAnimation("hellhound_idle")!.keyframes[0].bones,
    );
    a.bones.updateEntity(a.target);
    expect(
      animationAttackRange(a.world, a.id, a.target, "soldier_light_attack_high") === 0,
      "Fixture's high swing was reachable",
    );
    a.ai.pendingAttack = {
      target: a.target,
      animation: "soldier_light_attack_high",
      zone: 1,
      range: 40,
    };
    random(0.2, () => new SoldierStrategy().update(0, a.id, a.world));
    expect(
      a.combat.attackState === "windup",
      "No usable move was selected against a knee-height enemy",
    );
    expect(
      a.animator.currentAnim === "soldier_light_attack_low",
      "Impossible high swing did not switch to the usable existing low move",
    );
    expect(
      animationAttackRange(a.world, a.id, a.target, a.animator.currentAnim) > 0,
      "Fallback still could not reach the target",
    );
  },
  async function testNoViableAttackDoesNotSpendStaminaOrCreateZeroRangePendingMove() {
    const a = fixture("brute", "player", 20);
    a.targetTransform.position.y = -300;
    a.bones.update();
    random(0.5, () => new BruteStrategy().update(0, a.id, a.world));
    expect(
      a.combat.attackState === "idle" && a.stamina.current === 100 && !a.ai.pendingAttack,
      "Unreachable target caused a paid or permanently pending attack",
    );
  },
  async function testTransientTargetPoseCannotStretchAnAlreadySelectedBite() {
    const a = fixture("hellhound", "soldier", 32);
    const initial = animationAttackRange(a.world, a.id, a.target, "hellhound_light_attack_low");
    a.ai.pendingAttack = {
      target: a.target,
      animation: "hellhound_light_attack_low",
      zone: 3,
      range: initial,
    };
    const s = a.world.getComponent<SkeletonComponent>(a.target, "Skeleton")!;
    s.currentPose["leg-front-upper"] = { rotate: -90 };
    a.bones.updateEntity(a.target);
    new HellhoundStrategy(false).update(0, a.id, a.world);
    expect(
      !a.ai.pendingAttack || a.ai.pendingAttack.range <= initial,
      "A temporary outstretched limb expanded the pending bite's engagement distance",
    );
  },
  async function testShortWeaponEngagementIncludesLargeMuzzleClearance() {
    const a = fixture("rogue", "alpha_hellhound", 80);
    expect(
      attackRange(a.world, a.id, a.target) >= bodyContactDistance(a.world, a.id, a.target),
      "Short weapon engagement ended inside the large animal's solid body",
    );
    const player = createPlayer(a.world, 20, 0);
    expect(attackRange(a.world, a.id, player) === 25, "Player engagement baseline changed");
  },
  async function testOpposingSameUpdateFlanksYieldInsteadOfCrossingInMidair() {
    for (const first of [true, false]) {
      const a = fixture("soldier", "soldier", 130),
        front = ally(a, 45),
        rear = createEnemy(a.world, 175, 0, "soldier");
      a.world.getComponent<FactionComponent>(rear, "Faction")!.team = 4;
      a.world.getComponent<TransformComponent>(rear, "Transform")!.facing = -1;
      a.world.getComponent<PhysicsComponent>(rear, "Physics")!.grounded = true;
      const rearAI = a.world.getComponent<AIControllerComponent>(rear, "AIController")!;
      Object.assign(rearAI, {
        state: "combat",
        target: front,
        hasAttackToken: false,
        flankTimer: 0,
      });
      Object.assign(a.ai, { hasAttackToken: false, flankTimer: 0 });
      const strategy = new SoldierStrategy();
      random(0, () => {
        for (const id of first ? [a.id, rear] : [rear, a.id]) strategy.update(16, id, a.world);
      });
      expect(
        Number(a.ai.isFlanking) + Number(rearAI.isFlanking) === 1,
        "Opposing flank trajectories were both rejected or both committed",
      );
      const waiting = a.ai.isFlanking ? rear : a.id;
      expect(
        a.world.getComponent<PhysicsComponent>(waiting, "Physics")!.grounded &&
          a.world.getComponent<StaminaComponent>(waiting, "Stamina")!.current === 100,
        "Yielding flanker still spent a jump",
      );
    }
  },
  async function testFlankReservationExpiresWithCancelledFlight() {
    const a = fixture("soldier", "soldier", 90),
      airborne = createEnemy(a.world, 145, -60, "soldier");
    const brain = a.world.getComponent<AIControllerComponent>(airborne, "AIController")!;
    Object.assign(brain, { isFlanking: true, flankLanding: { x: -20, y: 0 } });
    Object.assign(a.world.getComponent<PhysicsComponent>(airborne, "Physics")!, {
      grounded: false,
      velocity: { x: -180, y: -400 },
    });
    expect(
      !flankLanding(a.world, a.id, a.target, 650),
      "Crossing airborne reservation was ignored",
    );
    a.world.getComponent<HealthComponent>(airborne, "Health")!.isDead = true;
    expect(
      !!flankLanding(a.world, a.id, a.target, 650),
      "Dead actor left a permanent flank reservation",
    );
  },
  async function testLandingIsCheckedAgainstFutureAirborneArrival() {
    const a = fixture("soldier", "soldier", 90),
      goal = flankLanding(a.world, a.id, a.target, 650)!;
    const other = createEnemy(a.world, goal.x + 150, -40, "soldier");
    Object.assign(a.world.getComponent<AIControllerComponent>(other, "AIController")!, {
      isFlanking: true,
      flankLanding: goal,
    });
    Object.assign(a.world.getComponent<PhysicsComponent>(other, "Physics")!, {
      grounded: false,
      velocity: { x: -280, y: -300 },
    });
    expect(
      !flankLanding(a.world, a.id, a.target, 650),
      "Currently empty landing ignored another actor's committed arrival",
    );
  },
  async function testNewlySpawnedActorOnFloorDoesNotFallThroughPredictedLanding() {
    const a = fixture("soldier", "soldier", 90),
      goal = flankLanding(a.world, a.id, a.target, 650)!;
    createEnemy(a.world, goal.x, 0, "alpha_hellhound"); // Physics has not marked grounded yet.
    expect(
      !flankLanding(a.world, a.id, a.target, 650),
      "Spawn-frame grounded flag made an occupied landing appear empty",
    );
  },
  async function testWaitingFighterOpensReadableSpaceBehindAlly() {
    const a = fixture("soldier", "soldier", 110),
      front = ally(a, 28);
    a.ai.hasAttackToken = false;
    new SoldierStrategy().update(16, a.id, a.world);
    expect(
      a.physics.velocity.x < 0 && a.combat.attackState === "idle",
      "Waiting fighter remained pressed against an ally",
    );
    a.world.getComponent<TransformComponent>(front, "Transform")!.position.x = 60;
    a.physics.velocity.x = 0;
    new SoldierStrategy().update(16, a.id, a.world);
    expect(a.physics.velocity.x === 0, "Waiting fighter marched back into its useful spacing");
  },
  async function testWaitingGuardLowersWhenReadyForTokensAndRecovery() {
    const a = fixture("soldier", "soldier", 35);
    ally(a, 22);
    Object.assign(a.ai, { hasAttackToken: false, attackCooldownTimer: 500 });
    new SoldierStrategy().update(16, a.id, a.world);
    expect(a.combat.isBlocking, "Cooling-down Soldier did not cover the waiting line");
    a.ai.attackCooldownTimer = 0;
    new SoldierStrategy().update(16, a.id, a.world);
    expect(!a.combat.isBlocking, "Waiting guard prevented future token access");
    new CombatSystem(a.world).update();
    expect(!a.stamina.regenPaused, "Waiting permanently paused stamina recovery");
    new CombatDirectorSystem(a.world).update();
    expect(a.ai.hasAttackToken, "Ready waiting actor could not regain a token");
  },
  async function testFailedFlankReevaluatesWhenItsObstructionMoves() {
    const a = fixture("soldier", "soldier", 90),
      front = ally(a, 45);
    Object.assign(a.ai, {
      hasAttackToken: false,
      flankTimer: 4500,
      flankObstruction: { blocker: front, blockerX: 10, target: a.target, targetX: 90, targetY: 0 },
    });
    random(0, () => new SoldierStrategy().update(16, a.id, a.world));
    expect(
      a.ai.isFlanking && !a.ai.flankObstruction,
      "Meaningful blocker movement retained a stale failed-flank cooldown",
    );
  },
  async function testWaitingAnimalNeverAcquiresHumanoidGuard() {
    const a = fixture("alpha_hellhound", "soldier", 170);
    ally(a, 90);
    Object.assign(a.ai, { hasAttackToken: false, attackCooldownTimer: 500 });
    new HellhoundStrategy(true).update(16, a.id, a.world);
    expect(!a.combat.isBlocking, "An animal adopted a humanoid waiting guard");
  },
  async function testAlphaUsesQuickPunishRatherThanCopyingSpecialTelegraph() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    special(a);
    const strategy = new HellhoundStrategy(true);
    observeSpecial(a, strategy);
    expect(
      a.ai.hellhoundSpecialResponse?.mode === "punish" &&
        a.combat.attackState === "windup" &&
        !a.animator.currentAnim.includes("special"),
      "Alpha copied a major special despite a reachable quick punish",
    );
    expect(
      a.ai.lastHellhoundAttackZone === a.combat.attackZone && a.ai.bossSpecialReadyAt === 0,
      "Ordinary counter consumed special cooldown or recorded a stale zone",
    );
  },
  async function testSpecialReactionWaitsForPerceptionDelay() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    special(a);
    random(0, () => new HellhoundStrategy(true).update(0, a.id, a.world));
    expect(
      !a.ai.hellhoundSpecialResponse && a.combat.attackState === "idle",
      "An unseen special caused an instantaneous reaction",
    );
  },
  async function testAnimalDisengagesWithoutHumanEvasionOrFreeInvulnerability() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    special(a);
    a.ai.hasAttackToken = false;
    const strategy = new HellhoundStrategy(true);
    observeSpecial(a, strategy);
    strategy.update(16, a.id, a.world);
    expect(
      a.ai.hellhoundSpecialResponse?.mode === "withdraw" && a.physics.velocity.x < 0,
      "Available safe ground did not produce a natural withdrawal",
    );
    const move = a.world.getComponent<MovementStateComponent>(a.id, "MovementState")!;
    expect(
      move.current !== "roll" &&
        move.current !== "backstep" &&
        a.world.getComponent<HealthComponent>(a.id, "Health")!.invulnTimer === 0 &&
        !a.combat.isBlocking,
      "Natural special response granted humanoid evasion/guard/protection",
    );
  },
  async function testBlockedSpecialResponseHoldsInsteadOfWalkingIntoWall() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    createPlatform(a.world, -90, -180, 35, 180, "solid");
    special(a);
    a.ai.hasAttackToken = false;
    observeSpecial(a, new HellhoundStrategy(true));
    expect(
      a.ai.hellhoundSpecialResponse?.mode === "wait" && a.physics.velocity.x === 0,
      "Caged animal attempted an unsafe withdrawal or matching special",
    );
  },
  async function testSpecialResponseIsChosenOncePerCommittedAttack() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    special(a);
    a.ai.hasAttackToken = false;
    const strategy = new HellhoundStrategy(true);
    observeSpecial(a, strategy);
    const response = a.ai.hellhoundSpecialResponse;
    const previous = Math.random;
    let draws = 0;
    try {
      Math.random = () => {
        draws++;
        return 0.99;
      };
      for (let i = 0; i < 6; i++) strategy.update(16, a.id, a.world);
    } finally {
      Math.random = previous;
    }
    expect(
      a.ai.hellhoundSpecialResponse === response && draws === 0,
      "Special response was rerolled every frame",
    );
  },
  async function testCommittedAnimalWindupRemainsCommittedDuringEnemySpecial() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    special(a);
    a.combat.attackState = "windup";
    a.combat.attackTimer = 500;
    beginAnimation(a.animator, "alpha_hellhound_special_attack_maul");
    observeSpecial(a, new HellhoundStrategy(true));
    expect(
      a.animator.currentAnim === "alpha_hellhound_special_attack_maul" &&
        !a.ai.hellhoundSpecialResponse,
      "Reaction cancelled an already committed windup",
    );
  },
  async function testEnemySpecialRecoveryAllowsOrdinaryCounter() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 150);
    special(a);
    a.ai.hasAttackToken = false;
    const strategy = new HellhoundStrategy(true);
    observeSpecial(a, strategy);
    a.targetCombat.attackState = "recovery";
    a.ai.hasAttackToken = true;
    a.ai.hellhoundDecisionTimer = 0;
    strategy.update(0, a.id, a.world);
    expect(
      a.combat.attackState === "windup" && !a.animator.currentAnim.includes("special"),
      "Completed threat left the animal stuck disengaging",
    );
  },
  async function testWholeNPCOpacityStaysReadableDuringDamageProtection() {
    const a = fixture();
    const h = a.world.getComponent<HealthComponent>(a.id, "Health")!;
    h.invulnTimer = 384;
    a.world.addComponent(a.id, "HitFlash", {
      bone: "head",
      frames: 4,
      color: "#ffd0ac",
      opacity: 0.4,
      remainingMs: 80,
      durationMs: 80,
    });
    const records = paints(a).filter((p) => p.id === a.id);
    expect(
      records.length > 5 &&
        records.filter((p) => p.color !== "#ffd0ac").every((p) => p.alpha === 1),
      "Damage protection faded the NPC's entire artwork",
    );
    expect(
      records.some((p) => p.color === "#ffd0ac" && p.alpha === 0.4),
      "Readable local contact flash disappeared",
    );
    a.world.getResource<CombatEventQueue>(CombatEventQueue).events.push({
      attackerId: a.target,
      targetId: a.id,
      damage: 10,
      poiseDamage: 0,
      zone: 2,
      attackType: "light",
      knockback: { x: 100, y: 0 },
      impactPoint: { x: 0, y: -30 },
      isBlockable: true,
      contactType: "body",
    });
    new DamageSystem(a.world).update();
    expect(h.current === h.max, "Removing opacity also removed damage protection");
  },
  async function testPlayerProtectionBlinkIsPreserved() {
    const a = fixture("player");
    a.world.getComponent<HealthComponent>(a.id, "Health")!.invulnTimer = 384;
    const records = paints(a).filter((p) => p.id === a.id);
    expect(
      records.length > 5 && records.every((p) => p.alpha === 0.3),
      "Player evasion/protection feedback was removed",
    );
  },
  async function testCorpsePaintsBehindLiveActorOnSameFloorRegardlessOfCreationOrder() {
    for (const later of [true, false]) {
      const a = fixture("soldier", "alpha_hellhound", 20),
        corpse = later ? a.target : a.id,
        live = later ? a.id : a.target;
      a.world.getComponent<HealthComponent>(corpse, "Health")!.isDead = true;
      const records = paints(a);
      expect(
        records.findIndex((p) => p.id === corpse) >= 0 &&
          records.findIndex((p) => p.id === corpse) < records.findIndex((p) => p.id === live),
        "Corpse obscured a living actor because of its entity ID",
      );
    }
  },
  async function testCorpseLayeringPreservesDepthAcrossDifferentFloors() {
    const a = fixture("soldier", "alpha_hellhound", 20);
    a.world.getComponent<HealthComponent>(a.target, "Health")!.isDead = true;
    a.targetTransform.position.y = 100;
    a.bones.update();
    const records = paints(a);
    expect(
      records.findIndex((p) => p.id === a.id) < records.findIndex((p) => p.id === a.target),
      "Dead/live preference overrode vertical platform depth",
    );
  },
  async function testSettledAlphaCorpseIsLowAndRestsOnFloorInBothFacings() {
    for (const facing of [1, -1] as const) {
      const a = fixture("alpha_hellhound");
      a.transform.facing = facing;
      const start = deathPose(a, 0),
        settled = deathPose(a, 900);
      expect(
        settled.height < start.height * 0.65,
        "Dead Alpha retained its standing/crouching silhouette",
      );
      expect(
        settled.bottom <= 0.1 && settled.bottom > -3,
        "Settled Alpha floated above or clipped through the floor",
      );
    }
  },
  async function testAlphaCorpseStopsMovingAfterSettle() {
    const a = fixture("alpha_hellhound");
    const settled = deathPose(a, 900),
      later = deathPose(a, 1800);
    expect(
      JSON.stringify(settled.pose) === JSON.stringify(later.pose),
      "Corpse resumed breathing or changed after death settled",
    );
    expect(
      AssetLoader.getAnimation("alpha_hellhound_death")!.duration === 900 &&
        !AssetLoader.getAnimation("alpha_hellhound_death")!.loop,
      "Presentation fix changed death timing/state semantics",
    );
  },
];
