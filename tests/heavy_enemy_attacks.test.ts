import { World } from "../core/World";
import {
  TimeState,
  InputState,
  CameraState,
  SpatialGridState,
  CombatEventQueue,
} from "../core/Resources";
import { AssetLoader } from "../assets/AssetLoader";
import { createEnemy, createPlayer } from "../entities/Archetypes";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { CombatComponent } from "../features/combat/CombatComponent";
import { CombatSystem } from "../features/combat/CombatSystem";
import { TransformComponent } from "../components/Transform";
import { StaminaComponent } from "../components/Stamina";
import { HealthComponent } from "../components/Health";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { BossStrategy } from "../features/ai/EnemyStrategies";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";
import { WeaponTrailSystem } from "../systems/WeaponTrailSystem";
import { AnimationViewer, getAnimationGroups } from "../tools/AnimationViewer";
import { Matrix2D } from "../utils/Matrix2D";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";

const specials = ["boss_special_attack_reap", "boss_special_attack_skewer"];
function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function near(actual: number, expected: number, label: string) {
  expect(Math.abs(actual - expected) < 0.02, `${label}: ${actual} != ${expected}`);
}
function point(m: Matrix2D, x: number, y = 0) {
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty };
}
function fixture(skin: "brute" | "boss" = "boss") {
  const world = new World();
  world.setResource(TimeState, Object.assign(new TimeState(), { delta: 10, elapsed: 1000 }));
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  const id = createEnemy(world, 0, 0, skin);
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  transform.facing = 1;
  return {
    world,
    id,
    transform,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
    skeleton: world.getComponent<SkeletonComponent>(id, "Skeleton")!,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    time: world.getResource<TimeState>(TimeState),
    animation: new AnimationSystem(world),
    bones: new SkeletonSystem(world),
  };
}
function ownedGrips(skin: string) {
  return [...AssetLoader.animations.values()]
    .filter((clip) => clip.name.startsWith(skin + "_") && clip.offHandGrip)
    .map((clip) => clip.name)
    .concat("idle", "run");
}
function preview(a: ReturnType<typeof fixture>, name: string, fraction: number) {
  a.world.removeComponent(a.id, "MovementState");
  a.world.removeComponent(a.id, "Combat");
  a.animator.currentAnim = name;
  a.animation.preview = {
    time: fraction * AssetLoader.getAnimation(name)!.duration,
    delta: 0,
    loop: false,
    emitEvents: false,
  };
  a.animation.update();
  a.bones.update();
}
function assertGrip(a: ReturnType<typeof fixture>, label: string) {
  const m = a.skeleton.worldTransforms,
    blade = m.get("weapon")!,
    back = m.get("hand-back")!;
  const support = point(blade, -3),
    primary = point(blade, 6),
    wrist = point(m.get("hand-front")!, 0, 2);
  near(back.tx, support.x, label + " support x");
  near(back.ty, support.y, label + " support y");
  near(primary.x, wrist.x, label + " primary x");
  near(primary.y, wrist.y, label + " primary y");
  expect(a.skeleton.offHandGripActive === true, label + " lost visible grip");
}
function bossFixture() {
  const a = fixture();
  const target = createPlayer(a.world, 70, 0);
  const ai = a.world.getComponent<AIControllerComponent>(a.id, "AIController")!;
  Object.assign(ai, {
    state: "combat",
    target,
    hasAttackToken: true,
    attackDecisionTimer: 0,
    decisionTimer: 10000,
    flankTimer: 10000,
  });
  a.world.getComponent<PhysicsComponent>(a.id, "Physics")!.grounded = true;
  return {
    ...a,
    ai,
    stamina: a.world.getComponent<StaminaComponent>(a.id, "Stamina")!,
    strategy: new BossStrategy(),
  };
}
function choose(a: ReturnType<typeof bossFixture>, random: number, second = random) {
  a.combat.attackState = "idle";
  a.combat.attackTiming = undefined;
  a.ai.attackCooldownTimer = 0;
  a.ai.attackDecisionTimer = 0;
  const previous = Math.random;
  let calls = 0;
  Math.random = () => (calls++ === 0 ? random : second);
  try {
    a.strategy.update(0, a.id, a.world);
  } finally {
    Math.random = previous;
  }
}

export const tests = [
  async function testHeavyGripsStayAttachedBetweenKeysBothFacingsAndScales() {
    for (const skin of ["brute", "boss"] as const)
      for (const facing of [1, -1] as const)
        for (const scale of [1, 1.5]) {
          const a = fixture(skin);
          a.transform.facing = facing;
          a.transform.scale = { x: scale, y: scale * 0.9 };
          for (const name of ownedGrips(skin)) {
            const clip = AssetLoader.getAnimation(name)!;
            const times = new Set([
              ...clip.keyframes.map((key) => key.time),
              ...Array.from({ length: 241 }, (_, i) => i / 240),
            ]);
            for (const time of times) {
              preview(a, name, time);
              assertGrip(a, skin + "/" + name + "/" + time);
            }
          }
        }
  },
  async function testTwoHandedAttackEntryAndExitBlendsKeepGrip() {
    for (const skin of ["brute", "boss"] as const)
      for (const name of ownedGrips(skin).filter((name) => name.includes("attack"))) {
        const a = fixture(skin);
        a.world.removeComponent(a.id, "MovementState");
        a.world.removeComponent(a.id, "Combat");
        a.animation.update();
        a.bones.update();
        beginAnimation(a.animator, name);
        for (let i = 0; i < 15; i++) {
          a.animation.update();
          a.bones.update();
          assertGrip(a, name + " entry");
        }
        beginAnimation(a.animator, "idle");
        for (let i = 0; i < 20; i++) {
          a.animation.update();
          a.bones.update();
          assertGrip(a, name + " exit");
        }
      }
  },
  async function testHeavyGripFreezesWithHitstopAndReleasesOnDeath() {
    const a = fixture();
    preview(a, specials[0], 0.64);
    const pose = JSON.stringify(a.skeleton.currentPose),
      time = a.animator.time;
    a.world.addComponent(a.id, "HitStop", { frames: 5 });
    a.animation.update();
    a.bones.update();
    expect(
      JSON.stringify(a.skeleton.currentPose) === pose && a.animator.time === time,
      "hitstop moved heavy grip",
    );
    assertGrip(a, "hitstop");
    a.world.removeComponent(a.id, "HitStop");
    a.animation.preview = null;
    beginAnimation(a.animator, "death");
    for (let i = 0; i < 10; i++) a.animation.update();
    expect(!a.skeleton.offHandGripActive, "death retained attack draw order or grip");
    near(a.skeleton.currentPose.weapon?.scale?.x ?? 1, 1, "death blade projection");
  },
  async function testReleasedGripTransitionsAndRuntimeGuardsKeepBothHandsReachable() {
    for (const skin of ["brute", "boss"] as const)
      for (const from of ["jump", "fall", "stagger_light", "stagger_heavy"])
        for (const to of [
          "idle",
          skin + "_walk",
          ...ownedGrips(skin).filter((name) => name.includes("attack")),
        ]) {
          const a = fixture(skin);
          preview(a, from, 0.3);
          a.animation.preview = null;
          beginAnimation(a.animator, to);
          for (let i = 0; i < 20; i++) {
            a.animation.update();
            a.bones.update();
            assertGrip(a, from + " -> " + to);
          }
        }
    for (const skin of ["brute", "boss"] as const)
      for (const blocking of [true, false])
        for (const zone of [0, 1, 2, 3] as const) {
          const a = fixture(skin);
          a.combat.isBlocking = blocking;
          a.combat.attackZone = zone;
          a.combat.blockZone = zone;
          for (let i = 0; i < 30; i++) {
            a.animation.update();
            a.bones.update();
            assertGrip(a, skin + " guard " + zone);
          }
          const blade = a.skeleton.worldTransforms.get("weapon")!;
          const vertices = EnemyBonePaths[skin].weapon.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
          for (let i = 0; i < vertices.length; i += 2) {
            expect(
              point(blade, vertices[i], vertices[i + 1]).y <= 0.02,
              skin + " guard " + zone + " blade entered floor",
            );
          }
        }
  },
  async function testHeavyMidsStayHorizontalAndBossHighLoadsOverhead() {
    const a = fixture();
    a.transform.scale = { x: 1, y: 1 };
    preview(a, "boss_heavy_attack_mid", 0.6);
    const mid = a.skeleton.worldTransforms.get("weapon")!,
      midTip = point(mid, 45);
    expect(
      Math.abs(mid.b) / Math.hypot(mid.a, mid.b) < 0.25 && midTip.y > -40,
      "boss mid became overhead",
    );
    preview(a, "boss_heavy_attack_high", 0.5);
    const high = a.skeleton.worldTransforms.get("weapon")!,
      highTip = point(high, 45);
    expect(
      Math.abs(high.b) / Math.hypot(high.a, high.b) > 0.95 && highTip.y < midTip.y - 35,
      "high and mid loads look alike",
    );
    const b = fixture("brute");
    preview(b, "brute_heavy_attack_mid", 0.6);
    const club = b.skeleton.worldTransforms.get("weapon")!;
    expect(
      Math.abs(club.b) / Math.hypot(club.a, club.b) < 0.25 && point(club, 45).y > -40,
      "brute mid became overhead",
    );
  },
  async function testLowSweepsTravelAcrossTheActorAtLegHeight() {
    for (const [skin, name, start, contact] of [
      ["brute", "brute_heavy_attack_sweep", 0.5, 0.57],
      ["boss", "boss_heavy_attack_low", 0.5, 0.57],
    ] as const) {
      const a = fixture(skin);
      a.transform.scale = { x: 1, y: 1 };
      preview(a, name, start);
      const from = point(a.skeleton.worldTransforms.get("weapon")!, 45);
      preview(a, name, contact);
      const to = point(a.skeleton.worldTransforms.get("weapon")!, 45);
      expect(to.x - from.x > 65, name + " does not sweep across the actor");
      expect(from.y > -22 && to.y > -22 && from.y < -5 && to.y < -5, name + " left leg height");
    }
  },
  async function testBossSpecialsHaveSeparateStrikesAndViewerGrouping() {
    const group = getAnimationGroups("boss").find((group) => group.label === "BOSS")!;
    for (const name of specials) {
      const clip = AssetLoader.getAnimation(name)!;
      const starts = clip.events!.filter((event) => event.type === "hitbox-start"),
        ends = clip.events!.filter((event) => event.type === "hitbox-end");
      expect(
        group.names.includes(name) && starts.length === 2 && ends.length === 2,
        name + " missing special strikes",
      );
      expect(ends[0].time < starts[1].time && ends[1].time < 1, name + " has no reset/recovery");
      expect(
        starts.every(
          (event) => event.data.attackType === "heavy" && event.data.attachedToBone === "weapon",
        ),
        name + " lost heavy blade attachment",
      );
    }
    const reap = AssetLoader.getAnimation(specials[0])!.events!.filter(
      (event) => event.type === "hitbox-start",
    );
    expect(
      reap[0].data.zone === 3 && reap[1].data.zone === 1,
      "reap must switch from low to overhead",
    );
  },
  async function testBossAlternatesSpecialsWithAffordableCostAndReadableWindups() {
    const a = bossFixture();
    for (let i = 0; i < 3; i++) {
      a.stamina.current = 100;
      a.time.elapsed = 1000 + i * 6000;
      choose(a, 0);
      const name = specials[i % 2];
      expect(a.animator.currentAnim === name, "boss did not alternate specials");
      near(a.stamina.current, 70, "special cost");
      near(a.combat.attackTimer, AssetLoader.getAnimation(name)!.windupMs!, "special windup");
      expect(
        a.combat.isHeavyAttack === true && a.combat.attackZone === (i % 2 === 0 ? 3 : 2),
        "special lost heavy/first-zone metadata",
      );
    }
  },
  async function testBossSpecialCooldownCannotBeBypassedByHitReaction() {
    const a = bossFixture();
    choose(a, 0);
    const readyAt = a.ai.bossSpecialReadyAt!;
    a.time.elapsed = readyAt - 1;
    a.ai.consecutiveHits = 2;
    a.ai.lastHitTime = a.time.elapsed;
    a.stamina.current = 100;
    choose(a, 0);
    expect(!a.animator.currentAnim.includes("special"), "hit reaction bypassed special cooldown");
    near(a.ai.bossSpecialReadyAt!, readyAt, "cooldown changed during ordinary attack");
    a.time.elapsed = readyAt;
    a.ai.lastHitTime = readyAt;
    a.stamina.current = 100;
    choose(a, 0.9);
    expect(a.animator.currentAnim === specials[1], "ready hit reaction did not use next special");
  },
  async function testBossSpecialStaminaGateAndPhaseTransitionRemainIndependent() {
    const a = bossFixture();
    a.stamina.current = 29;
    choose(a, 0);
    expect(!a.animator.currentAnim.includes("special"), "unaffordable special selected");
    a.stamina.current = 100;
    const health = a.world.getComponent<HealthComponent>(a.id, "Health")!;
    health.current = health.max * 0.4;
    choose(a, 0);
    expect(
      a.ai.currentPhase === 1 && a.combat.attackState === "stagger",
      "phase transition interrupted by special",
    );
    a.time.elapsed += 1000;
    a.ai.state = "combat";
    choose(a, 0.3);
    expect(a.animator.currentAnim === specials[0], "phase two special chance was not applied");
  },
  async function testBossSpecialPreviewTimingMatchesGameplay() {
    const viewer = new AnimationViewer(document.createElement("canvas"));
    try {
      await viewer.init();
      viewer.spawnEntity("boss");
      viewer.setPlaybackMode("combat");
      const a = bossFixture();
      for (let i = 0; i < specials.length; i++) {
        a.time.elapsed = 1000 + i * 6000;
        a.stamina.current = 100;
        choose(a, 0);
        viewer.setAnimation(specials[i]);
        near(viewer.hitWindows[0].start, a.combat.attackTimer, "viewer first strike");
        expect(
          viewer.hitWindows[0].end < viewer.hitWindows[1].start &&
            viewer.duration > viewer.hitWindows[1].end,
          "viewer lost combo reset/recovery",
        );
      }
    } finally {
      viewer.game.destroy();
    }
  },
  async function testBossSpecialHitboxesAndTrailsClearBetweenStrikesAndOnInterrupt() {
    for (const name of specials) {
      const a = fixture();
      a.world.removeComponent(a.id, "MovementState");
      beginAnimation(a.animator, name);
      a.combat.attackState = "windup";
      a.combat.attackType = "heavy";
      a.combat.isHeavyAttack = true;
      a.combat.attackTimer = AssetLoader.getAnimation(name)!.windupMs!;
      const combat = new CombatSystem(a.world),
        trails = new WeaponTrailSystem(a.world);
      let sawFirst = false,
        sawGap = false,
        sawSecond = false;
      for (let i = 0; i < 400; i++) {
        combat.update();
        a.animation.update();
        a.bones.update();
        trails.update();
        const hit = a.world.hasComponent(a.id, "ActiveHitbox"),
          trail = a.world.getComponent<WeaponTrailComponent>(a.id, "WeaponTrail");
        if (hit && !sawGap) sawFirst = true;
        if (sawFirst && !hit) {
          sawGap = true;
          expect(!trail || trail.history.length === 0, name + " trails bridged strike reset");
        }
        if (hit && sawGap) {
          sawSecond = true;
          break;
        }
      }
      expect(sawFirst && sawGap && sawSecond, name + " did not traverse two distinct strikes");
      a.combat.attackState = "stagger";
      a.combat.attackTiming = undefined;
      a.combat.staggerType = "heavy";
      a.animation.update();
      a.bones.update();
      trails.update();
      expect(
        !a.world.hasComponent(a.id, "ActiveHitbox") && !a.skeleton.offHandGripActive,
        name + " survived interruption",
      );
    }
  },
];
