import { World } from "../core/World";
import {
  TimeState,
  InputState,
  CameraState,
  SpatialGridState,
  CombatEventQueue,
} from "../core/Resources";
import { createPlayer, createEnemy } from "../entities/Archetypes";
import { AssetLoader } from "../assets/AssetLoader";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { Animation } from "../features/animation/AnimationTypes";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementSystem } from "../features/movement/MovementSystem";
import { CombatComponent } from "../features/combat/CombatComponent";
import { CombatSystem } from "../features/combat/CombatSystem";
import { HitDetectionSystem } from "../features/combat/HitDetectionSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { CollisionSystem } from "../systems/CollisionSystem";
import { TransformComponent } from "../components/Transform";
import { PlayerInputComponent } from "../components/PlayerInput";
import { InventoryComponent } from "../components/Inventory";
import { SoundRequestComponent } from "../components/SoundRequest";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";
import { WeaponTrailSystem } from "../systems/WeaponTrailSystem";
import { PlayerBonePaths } from "../assets/svg/PlayerSVG";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";
import { WeaponPaths } from "../assets/svg/WeaponSVGs";
import { WEAPONS } from "../data/WeaponDefinitions";
import { ENEMY_STATS } from "../data/EnemyStats";
import { PLAYER_STATS } from "../core/Constants";
import { animationAttackRange } from "../features/ai/CombatReach";
import { resolveAttackHitbox } from "../features/combat/HitboxGeometry";
import { drawingBounds } from "../features/combat/ContactGeometry";
import { AnimationViewer } from "../tools/AnimationViewer";

const skins = ["player", "hollow", "soldier", "duelist", "rogue", "brute", "boss"] as const;
function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function near(actual: number, expected: number, label = "value") {
  expect(Math.abs(actual - expected) < 0.02, `${label}: ${actual} != ${expected}`);
}
function fixture(
  skin: (typeof skins)[number] = "player",
  weapon = "longsword",
  facing: 1 | -1 = 1,
) {
  const world = new World();
  world.setResource(TimeState, Object.assign(new TimeState(), { delta: 16 }));
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  const id = skin === "player" ? createPlayer(world, 0, 0) : createEnemy(world, 0, 0, skin);
  const inventory = world.getComponent<InventoryComponent>(id, "Inventory");
  if (inventory) inventory.currentWeapon = weapon;
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  transform.facing = facing;
  return {
    world,
    id,
    transform,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
    skeleton: world.getComponent<SkeletonComponent>(id, "Skeleton")!,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
    movement: world.getComponent<MovementStateComponent>(id, "MovementState")!,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    animation: new AnimationSystem(world),
    bones: new SkeletonSystem(world),
  };
}
function vertices(path: string) {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return numbers.filter((_, i) => i % 2 === 0).map((x, i) => ({ x, y: numbers[i * 2 + 1] }));
}
function maxY(skeleton: SkeletonComponent, bone: string, path: string) {
  const m = skeleton.worldTransforms.get(bone)!;
  return Math.max(...vertices(path).map((p) => m.b * p.x + m.d * p.y + m.ty));
}
function preview(a: ReturnType<typeof fixture>, name: string, time: number) {
  a.world.removeComponent(a.id, "MovementState");
  a.world.removeComponent(a.id, "Combat");
  a.animator.currentAnim = name;
  a.animation.preview = { time, delta: 0, loop: false, emitEvents: false };
  a.animation.update();
  a.bones.update();
}
function hitWindows(clip: Animation) {
  const windows: { start: number; end: number; data: any }[] = [];
  let start: any;
  for (const event of clip.events ?? []) {
    if (event.type === "hitbox-start") start = event;
    if (event.type === "hitbox-end" && start) {
      windows.push({ start: start.time, end: event.time, data: start.data });
      start = undefined;
    }
  }
  return windows;
}
function contactCases() {
  const cases: { skin: (typeof skins)[number]; weapon: string; clip: Animation }[] = [];
  for (const clip of AssetLoader.animations.values()) {
    if (clip.skeletonId === "quadruped-skeleton") continue; // Physical quadruped attacks have their own contact suite.
    if (!clip.grounded || !clip.name.includes("attack") || !hitWindows(clip).length) continue;
    const skin = skins.slice(1).find((type) => clip.name.startsWith(type + "_")) ?? "player";
    for (const weapon of skin === "player" ? Object.keys(WEAPONS) : ["longsword"])
      cases.push({ skin, weapon, clip });
  }
  return cases;
}
async function contactsAt(fps: number) {
  for (const { skin, weapon, clip } of contactCases())
    for (const facing of [1, -1] as const) {
      const a = fixture(skin, weapon, facing),
        windows = hitWindows(clip);
      a.world.removeComponent(a.id, "PlayerInput");
      a.animator.currentAnim = clip.name;
      a.combat.attackState = "windup";
      a.combat.attackType = clip.name.includes("heavy") ? "heavy" : "light";
      a.combat.isHeavyAttack = clip.name.includes("heavy");
      a.combat.attackTimer =
        skin === "player"
          ? ((clip.name.startsWith("slide")
              ? a.combat.isHeavyAttack
                ? 6
                : 4
              : a.combat.isHeavyAttack
                ? WEAPONS[weapon].heavyAttack.anticipation
                : WEAPONS[weapon].lightAttack.anticipation) /
              60) *
            1000
          : (clip.windupMs ??
            (clip.name.includes("special") ? 200 : ENEMY_STATS[skin].windupFrames * 16.66));
      let range = skin === "player" ? WEAPONS[weapon].reach : ENEMY_STATS[skin].attackRange;
      const target =
        skin === "player"
          ? createEnemy(a.world, facing * range, 0, "soldier")
          : createPlayer(a.world, facing * range, 0);
      if (skin !== "player") {
        // Each selected attack must hit at its usable range against the visible
        // body, rather than relying on the old rectangle's invisible head cap.
        range = Math.min(range, animationAttackRange(a.world, a.id, target, clip.name));
        a.world.getComponent<TransformComponent>(target, "Transform")!.position.x = facing * range;
      }
      const combat = new CombatSystem(a.world),
        collisions = new CollisionSystem(a.world),
        hits = new HitDetectionSystem(a.world);
      const time = a.world.getResource<TimeState>(TimeState);
      time.delta = 1000 / fps;
      for (let frame = 0; frame < fps * 5; frame++) {
        combat.update();
        a.animation.update();
        a.bones.update();
        collisions.update(false);
        hits.update();
        if ((a.combat.attackState as string) === "idle") break;
      }
      const count = a.world
        .getResource<CombatEventQueue>(CombatEventQueue)
        .events.filter((event) => event.attackerId === a.id && event.targetId === target).length;
      expect(
        count === windows.length,
        `${fps}fps ${facing} ${weapon} ${clip.name}: ${count}/${windows.length} strikes reached target at ${range}`,
      );
    }
}

const authoredAttackTiming: Record<string, { duration: number; windows: number[][] }> = {
  light_attack_mid: { duration: 400, windows: [[0.33, 0.75]] },
  light_attack_high: { duration: 400, windows: [[0.33, 0.5]] },
  light_attack_low: { duration: 400, windows: [[0.33, 0.75]] },
  heavy_attack_mid: { duration: 733, windows: [[0.41, 0.8]] },
  heavy_attack_high: { duration: 733, windows: [[0.41, 0.54]] },
  heavy_attack_low: { duration: 733, windows: [[0.45, 0.8]] },
  slide_attack: { duration: 367, windows: [[0.18, 0.36]] },
  slide_attack_heavy: { duration: 367, windows: [[0.18, 0.36]] },
  jump_attack: { duration: 467, windows: [[0.13, 0.34]] },
  hollow_light_attack_mid: { duration: 1000, windows: [[0.5, 0.65]] },
  hollow_light_attack_low: { duration: 1000, windows: [[0.5, 0.65]] },
  hollow_special_attack: {
    duration: 1500,
    windows: [
      [0.2, 0.4],
      [0.6, 0.8],
    ],
  },
  soldier_light_attack_mid: { duration: 800, windows: [[0.4, 0.55]] },
  soldier_light_attack_thrust: { duration: 800, windows: [[0.4, 0.55]] },
  soldier_light_attack_high: { duration: 800, windows: [[0.4, 0.55]] },
  soldier_light_attack_low: { duration: 800, windows: [[0.4, 0.55]] },
  soldier_special_attack: {
    duration: 1200,
    windows: [
      [0.2, 0.35],
      [0.5, 0.7],
    ],
  },
  duelist_light_attack_mid: { duration: 700, windows: [[0.3, 0.45]] },
  duelist_light_attack_high: { duration: 700, windows: [[0.3, 0.45]] },
  duelist_light_attack_low: { duration: 700, windows: [[0.3, 0.45]] },
  duelist_special_attack: {
    duration: 1200,
    windows: [
      [0.2, 0.3],
      [0.45, 0.55],
      [0.75, 0.9],
    ],
  },
  brute_heavy_attack_mid: { duration: 1500, windows: [[0.6, 0.75]] },
  brute_heavy_attack_sweep: { duration: 1600, windows: [[0.5, 0.7]] },
  rogue_light_attack_mid: { duration: 400, windows: [[0.3, 0.5]] },
  rogue_light_attack_high: { duration: 400, windows: [[0.3, 0.5]] },
  rogue_light_attack_low: { duration: 400, windows: [[0.3, 0.5]] },
  rogue_special_attack: {
    duration: 1000,
    windows: [
      [0.15, 0.25],
      [0.4, 0.5],
      [0.65, 0.8],
    ],
  },
  boss_heavy_attack_mid: { duration: 2000, windows: [[0.6, 0.8]] },
  boss_heavy_attack_thrust: { duration: 1500, windows: [[0.4, 0.6]] },
  boss_heavy_attack_low: { duration: 1800, windows: [[0.5, 0.7]] },
  boss_heavy_attack_high: { duration: 1800, windows: [[0.5, 0.7]] },
};

export const tests = [
  async function testAuthoredCombatDurationsAndWindowsArePreserved() {
    for (const [name, expected] of Object.entries(authoredAttackTiming)) {
      const clip = AssetLoader.getAnimation(name)!;
      near(clip.duration, expected.duration);
      expect(
        JSON.stringify(hitWindows(clip).map((w) => [w.start, w.end])) ===
          JSON.stringify(expected.windows),
        `${name} changed phase boundaries`,
      );
    }
  },
  async function testGroundedTracksOnEverySkinAndWeapon() {
    for (const skin of skins)
      for (const weapon of skin === "player" ? Object.keys(WEAPONS) : ["longsword"]) {
        const a = fixture(skin, weapon),
          paths = skin === "player" ? PlayerBonePaths : EnemyBonePaths[skin];
        for (const clip of AssetLoader.animations.values()) {
          if (clip.skeletonId === "quadruped-skeleton") continue;
          const owned = skins.slice(1).find((type) => clip.name.startsWith(type + "_"));
          if (
            (owned && owned !== skin) ||
            (!owned && skin !== "player" && clip.name.includes("attack"))
          )
            continue;
          if (!clip.grounded) continue;
          for (let frame = 0; frame <= 120; frame++) {
            preview(a, clip.name, (frame / 120) * clip.duration);
            const y = Math.max(
              ...["foot-front", "foot-back"].map((b) => maxY(a.skeleton, b, paths[b].path)),
            );
            expect(y <= 0.02, `${skin}/${weapon}/${clip.name}: sole below surface ${y}`);
            if (clip.keyframes.every((k) => !k.clearance)) near(y, 0, clip.name);
          }
        }
      }
  },
  async function testLoopSeamsForEveryCharacterVariant() {
    for (const skin of skins) {
      const a = fixture(skin);
      for (const clip of AssetLoader.animations.values()) {
        if (clip.skeletonId === "quadruped-skeleton") continue;
        if (!clip.loop) continue;
        const owner = skins.slice(1).find((type) => clip.name.startsWith(type + "_"));
        if (owner && owner !== skin) continue;
        preview(a, clip.name, 0);
        const first = new Map([...a.skeleton.worldTransforms].map(([b, m]) => [b, { ...m }]));
        preview(a, clip.name, clip.duration);
        for (const [bone, m] of a.skeleton.worldTransforms) {
          const f = first.get(bone)!;
          for (const property of ["a", "b", "c", "d", "tx", "ty"] as const)
            near(m[property], f[property], `${skin}/${clip.name}/${bone}/${property}`);
        }
      }
    }
  },
  async function testContactAt30FpsBothFacings() {
    await contactsAt(30);
  },
  async function testContactAt60FpsBothFacings() {
    await contactsAt(60);
  },
  async function testContactAt120FpsBothFacings() {
    await contactsAt(120);
  },
  async function testPoseAndHitEventsUseTheSameFrameTime() {
    for (const fps of [30, 60, 120]) {
      const a = fixture();
      a.world.removeComponent(a.id, "MovementState");
      a.world.removeComponent(a.id, "Combat");
      const name = "contact-clock-regression";
      AssetLoader.registerAnimation(name, {
        name,
        duration: 1000,
        loop: false,
        keyframes: [
          { time: 0, bones: { head: { rotate: 0 } } },
          { time: 1, bones: { head: { rotate: 100 } } },
        ],
        events: [
          {
            time: 0.5,
            type: "hitbox-start",
            data: { offset: { x: 0, y: 0 }, width: 10, height: 10, damage: 1 },
          },
          { time: 0.7, type: "hitbox-end" },
        ],
      });
      a.animator.currentAnim = name;
      a.animator.time = 495;
      a.world.getResource<TimeState>(TimeState).delta = 1000 / fps;
      a.animation.update();
      near(a.skeleton.currentPose.head.rotate!, a.animator.time / 10, "displayed clock");
      expect(a.world.hasComponent(a.id, "ActiveHitbox"), "Start event was lost");
      AssetLoader.animations.delete(name);
    }
  },
  async function testHitstopFreezesPoseClockEventsAndTrails() {
    const a = fixture();
    a.world.removeComponent(a.id, "MovementState");
    a.animator.currentAnim = "light_attack_mid";
    a.animator.time = 200;
    a.combat.attackState = "active";
    a.animation.update();
    a.bones.update();
    const before = JSON.stringify(a.skeleton.currentPose),
      clock = a.animator.time;
    a.world.addComponent(a.id, "HitStop", { framesRemaining: 3 });
    a.animation.update();
    a.animation.update();
    near(a.animator.time, clock);
    expect(JSON.stringify(a.skeleton.currentPose) === before, "Hitstop moved pose");
    expect(a.animator.pendingEvents.length === 0, "Hitstop repeated events");
  },
  async function testAttackRestartCapturesCurrentPoseAndReleasesSparseBones() {
    const a = fixture();
    a.world.removeComponent(a.id, "MovementState");
    a.world.removeComponent(a.id, "Combat");
    a.skeleton.currentPose = {
      "body-pivot": { rotate: 360 },
      head: { rotate: 30 },
      "arm-back-upper": { rotate: 50 },
    };
    a.animator.currentAnim = "light_attack_mid";
    beginAnimation(a.animator, "light_attack_mid");
    a.animation.update();
    near(a.skeleton.currentPose.head.rotate!, 30);
    expect(!!a.animator.blendFromPose, "Restart did not capture visible pose");
    for (let frame = 0; frame < 6; frame++) a.animation.update();
    expect(
      Math.abs((a.skeleton.currentPose["body-pivot"]?.rotate ?? 360) % 360) < 0.02,
      "Transition unwound a full roll",
    );
    near(a.skeleton.currentPose["arm-back-upper"]?.rotate ?? 0, 0, "unkeyed arm release");
  },
  async function testWalkClockTracksSpeedWithoutChangingVelocity() {
    const clocks: number[] = [];
    for (const velocity of [75, 150]) {
      const a = fixture();
      a.movement.current = "walk";
      a.physics.velocity.x = velocity;
      a.animator.currentAnim = "walk";
      a.animation.update();
      clocks.push(a.animator.time);
      near(a.physics.velocity.x, velocity);
    }
    near(clocks[1], 2 * clocks[0]);
  },
  async function testPlantedWalkFootFollowsWorldTravel() {
    for (const skin of skins) {
      const a = fixture(skin);
      a.world.removeComponent(a.id, "PlayerInput");
      const name = skin === "player" ? "walk" : skin + "_walk";
      const clip = AssetLoader.getAnimation(name)!;
      a.movement.current = "walk";
      a.animator.currentAnim = name;
      a.physics.velocity.x = 120;
      a.world.getResource<TimeState>(TimeState).delta = 1000 / 120;
      const positions: number[] = [];
      for (let frame = 0; frame < 80; frame++) {
        a.transform.position.x += a.physics.velocity.x / 120;
        a.animation.update();
        a.bones.update();
        if (a.animator.time >= clip.duration / 2) break;
        positions.push(a.skeleton.worldTransforms.get("foot-front")!.tx);
      }
      expect(
        positions.length > 2 && Math.max(...positions) - Math.min(...positions) < 0.5,
        `${skin} planted foot slid ${Math.max(...positions) - Math.min(...positions)} world units`,
      );
    }
  },
  async function testRogueUsesItsRunningPoseVariant() {
    const a = fixture("rogue");
    a.physics.velocity.x = 275;
    a.movement.current = "run";
    a.animation.update();
    const rogue = AssetLoader.getAnimation("run", { skin: "rogue" })!,
      shared = AssetLoader.getAnimation("run")!;
    expect(
      rogue.keyframes[0].bones.torso.rotate !== shared.keyframes[0].bones.torso.rotate,
      "Rogue still borrows the player sprint",
    );
  },
  async function testFootstepsOccurAtSupportContacts() {
    for (const skin of skins) {
      const a = fixture(skin),
        paths = skin === "player" ? PlayerBonePaths : EnemyBonePaths[skin];
      for (const name of [skin === "player" ? "walk" : skin + "_walk", "run", "crouchWalk"]) {
        const clip = AssetLoader.getAnimation(name)!;
        for (const event of clip.events ?? []) {
          if (event.type !== "sound") continue;
          preview(a, name, event.time * clip.duration);
          near(
            Math.max(...["foot-front", "foot-back"].map((b) => maxY(a.skeleton, b, paths[b].path))),
            0,
            `${skin}/${name} sound plant`,
          );
        }
      }
    }
  },
  async function testMovementOnsetSoundsHaveOneOwner() {
    for (const action of ["roll", "slide", "jump"] as const) {
      const a = fixture();
      a.physics.grounded = true;
      a.movement.previousGrounded = true;
      a.physics.velocity.x = 150;
      if (action === "slide") a.world.getResource<InputState>(InputState).keysPressed.add("KeyV");
      else
        a.world.getComponent<PlayerInputComponent>(a.id, "PlayerInput")!.buffer = {
          action,
          expiresAt: 999999,
        } as any;
      new MovementSystem(a.world).update();
      a.animation.update();
      const requests =
        a.world.getComponent<SoundRequestComponent>(a.id, "SoundRequest")?.requests ?? [];
      expect(
        requests.filter((r) => r.id === action).length === 1,
        `${action} requested ${requests.filter((r) => r.id === action).length} sounds`,
      );
    }
  },
  async function testLandingResponseDoesNotLockMovementOrDoubleSound() {
    const a = fixture("soldier");
    a.physics.grounded = true;
    a.physics.velocity.x = 123;
    new MovementSystem(a.world).update();
    a.animation.update();
    a.bones.update();
    expect(
      a.movement.landingTimer === 250 && a.movement.current === "walk",
      "Landing locked movement state",
    );
    near(a.physics.velocity.x, 123);
    new MovementSystem(a.world).update();
    a.animation.update();
    const requests = a.world.getComponent<SoundRequestComponent>(a.id, "SoundRequest")!.requests;
    expect(
      requests.filter((r) => r.id === "land").length === 1,
      "Landing duplicated its onset sound",
    );
  },
  async function testLandingDuringFallEntryBlendPlantsFeetImmediately() {
    const a = fixture();
    a.movement.current = "fall";
    a.physics.velocity.y = 100;
    a.animator.currentAnim = "fall";
    a.animation.update();
    beginAnimation(a.animator, "jump_attack");
    a.combat.attackState = "windup";
    a.combat.attackType = "jump";
    a.combat.attackTimer = 133;
    a.physics.grounded = true;
    a.movement.current = "idle";
    a.movement.landingTimer = 250;
    a.animation.update();
    a.bones.update();
    near(
      Math.max(
        ...["foot-front", "foot-back"].map((b) => maxY(a.skeleton, b, PlayerBonePaths[b].path)),
      ),
      0,
      "landing entry support",
    );
  },
  async function testAirAttackInitiationAndLandingCancel() {
    for (const heavy of [false, true]) {
      const a = fixture();
      a.movement.current = "fall";
      a.physics.grounded = false;
      a.world.getComponent<PlayerInputComponent>(a.id, "PlayerInput")!.buffer = {
        action: heavy ? "heavyAttack" : "lightAttack",
        expiresAt: 999999,
      } as any;
      new CombatSystem(a.world).update();
      a.animation.update();
      expect(
        a.animator.currentAnim === (heavy ? "jump_attack_heavy" : "jump_attack") &&
          a.combat.attackType === "jump",
        "Aerial input did not select jump attack",
      );
      expect(a.combat.isHeavyAttack === heavy, "Aerial heavy intent was lost");
      a.physics.grounded = true;
      a.movement.previousGrounded = false;
      new MovementSystem(a.world).update();
      a.animation.update();
      a.bones.update();
      expect(
        a.combat.attackState === "recovery" && !a.world.hasComponent(a.id, "ActiveHitbox"),
        "Landing kept airborne damage active",
      );
      near(
        Math.max(
          ...["foot-front", "foot-back"].map((b) => maxY(a.skeleton, b, PlayerBonePaths[b].path)),
        ),
        0,
        "landed air attack",
      );
      a.movement.current = "roll";
      new CombatSystem(a.world).update();
      expect(a.combat.attackState === "idle", "Landing recovery disabled the existing roll cancel");
    }
  },
  async function testClimbingHidesBladePlantsRungAndPausesAtRest() {
    const a = fixture();
    a.transform.position.y = 64;
    a.movement.current = "climb";
    a.movement.ladderTop = 0;
    a.movement.ladderCenter = 0;
    a.physics.velocity.y = -100;
    for (let frame = 0; frame < 100; frame++) {
      a.transform.position.y -= 1.6;
      a.animation.update();
      a.bones.update();
      const anchor = a.animator.climbPlant!;
      near(
        a.skeleton.worldTransforms.get(`hand-${anchor.side}`)!.ty,
        anchor.y,
        "planted ladder hand",
      );
      if (frame > 10)
        near(
          Math.hypot(
            a.skeleton.worldTransforms.get("weapon")!.a,
            a.skeleton.worldTransforms.get("weapon")!.b,
          ),
          0,
          "hidden climb blade",
        );
    }
    a.physics.velocity.y = 0;
    const clock = a.animator.time;
    for (let frame = 0; frame < 10; frame++) a.animation.update();
    near(a.animator.time, clock, "stationary climb");
  },
  async function testBruteWindupIsACompleteHold() {
    const a = fixture("brute"),
      name = "brute_heavy_attack_mid",
      clip = AssetLoader.getAnimation(name)!;
    preview(a, name, clip.duration * 0.5);
    const before = JSON.stringify(a.skeleton.currentPose);
    preview(a, name, clip.duration * 0.6);
    expect(JSON.stringify(a.skeleton.currentPose) === before, "Smash hold dropped joints");
  },
  async function testHeavySpecialFinishersReachDamageWithHeavyIdentity() {
    for (const skin of ["hollow", "soldier", "duelist", "rogue"] as const) {
      const a = fixture(skin);
      a.world.removeComponent(a.id, "MovementState");
      const clip = AssetLoader.getAnimation(skin + "_special_attack")!;
      const last = hitWindows(clip).at(-1)!;
      a.animator.currentAnim = clip.name;
      a.animator.time = last.start * clip.duration - 1;
      a.combat.attackState = "active";
      a.combat.isHeavyAttack = false;
      a.world.getResource<TimeState>(TimeState).delta = 2;
      a.animation.update();
      const box = a.world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
      expect(box.attackType === "heavy", `${skin} finisher was downgraded`);
      const target = createPlayer(a.world, 20, 0);
      a.world.getResource<CombatEventQueue>(CombatEventQueue).events.push({
        attackerId: a.id,
        targetId: target,
        damage: box.damage,
        poiseDamage: 100,
        zone: box.zone,
        attackType: box.attackType,
        knockback: { x: 0, y: 0 },
        impactPoint: { x: 10, y: -30 },
        isBlockable: true,
      });
      new DamageSystem(a.world).update();
      expect(
        a.world.getComponent<CombatComponent>(target, "Combat")!.staggerType === "heavy",
        "Finisher lost its heavy reaction",
      );
    }
  },
  async function testAirAttackPayloadMatchesExistingLightAndHeavyDamage() {
    for (const weapon of Object.keys(WEAPONS))
      for (const heavy of [false, true]) {
        const a = fixture("player", weapon);
        a.world.removeComponent(a.id, "MovementState");
        a.animator.currentAnim = heavy ? "jump_attack_heavy" : "jump_attack";
        const clip = AssetLoader.getAnimation(a.animator.currentAnim)!;
        a.animator.time = hitWindows(clip)[0].start * clip.duration - 1;
        a.combat.attackState = "active";
        a.combat.isHeavyAttack = heavy;
        a.world.getResource<TimeState>(TimeState).delta = 2;
        a.animation.update();
        const box = a.world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
        const normal = hitWindows(
          AssetLoader.getAnimation(heavy ? "heavy_attack_mid" : "light_attack_mid")!,
        )[0].data;
        near(
          box.damage,
          (normal.damage / WEAPONS.longsword.baseDamage) * WEAPONS[weapon].baseDamage,
        );
        near(
          box.poiseDamage,
          heavy ? WEAPONS[weapon].poiseDamageHeavy : WEAPONS[weapon].poiseDamageLight,
        );
      }
  },
  async function testWeaponTrailsMatchArtAndResetBetweenHits() {
    for (const skin of skins)
      for (const weapon of skin === "player" ? Object.keys(WEAPONS) : ["longsword"]) {
        const a = fixture(skin, weapon);
        a.world.removeComponent(a.id, "MovementState");
        a.animator.currentAnim =
          skin === "player"
            ? "light_attack_mid"
            : skin +
              (skin === "brute" || skin === "boss" ? "_heavy_attack_mid" : "_light_attack_mid");
        const clip = AssetLoader.getAnimation(a.animator.currentAnim)!;
        const win = hitWindows(clip)[0];
        a.animator.time = win.start * clip.duration - 1;
        a.combat.attackState = "active";
        a.world.getResource<TimeState>(TimeState).delta = 2;
        a.animation.update();
        a.bones.update();
        const trail: WeaponTrailComponent = {
          boneId: "weapon",
          tipOffset: { x: 40, y: 0 },
          baseOffset: { x: 0, y: 0 },
          history: [],
          maxLength: 6,
          active: true,
          color: "white",
        };
        a.world.addComponent(a.id, "WeaponTrail", trail);
        const system = new WeaponTrailSystem(a.world);
        system.update();
        const drawing =
          skin === "player" ? WeaponPaths[WEAPONS[weapon].svgAsset] : EnemyBonePaths[skin].weapon;
        const length = Math.max(...vertices(drawing.path).map((v) => v.x));
        near(trail.tipOffset.x, length);
        const segment = trail.history[0];
        const projection = Math.abs(a.skeleton.currentPose.weapon?.scale?.x ?? 1);
        near(
          Math.hypot(segment.tip.x - segment.base.x, segment.tip.y - segment.base.y),
          length * a.transform.scale.x * projection,
        );
        a.world.removeComponent(a.id, "ActiveHitbox");
        system.update();
        expect(
          !trail.active && trail.history.length === 0,
          "Trail connected across a non-damaging combo gap",
        );
      }
  },
  async function testRollAndCorpseBodyEnvelopeStaysAboveSurface() {
    for (const skin of skins) {
      const a = fixture(skin),
        paths = skin === "player" ? PlayerBonePaths : EnemyBonePaths[skin];
      for (const name of ["roll", "death"])
        for (let frame = 0; frame <= 120; frame++) {
          preview(a, name, (frame / 120) * AssetLoader.getAnimation(name)!.duration);
          const y = Math.max(...Object.entries(paths).map(([b, p]) => maxY(a.skeleton, b, p.path)));
          expect(y <= 0.02, `${skin}/${name}: body/weapon penetrated floor ${y}`);
        }
    }
  },
  async function testGroundedWeaponPathsStayAboveSurface() {
    for (const skin of skins)
      for (const weapon of skin === "player" ? Object.keys(WEAPONS) : ["longsword"]) {
        const a = fixture(skin, weapon);
        const drawing =
          skin === "player" ? WeaponPaths[WEAPONS[weapon].svgAsset] : EnemyBonePaths[skin].weapon;
        for (const clip of AssetLoader.animations.values()) {
          if (clip.skeletonId === "quadruped-skeleton") continue;
          const owner = skins.slice(1).find((type) => clip.name.startsWith(type + "_"));
          if (
            (owner && owner !== skin) ||
            (!owner && skin !== "player" && clip.name.includes("attack"))
          )
            continue;
          if (
            !clip.grounded ||
            ["jump", "fall", "backstep"].includes(clip.name) ||
            clip.name.startsWith("jump_attack")
          )
            continue;
          for (let frame = 0; frame <= 120; frame++) {
            preview(a, clip.name, (frame / 120) * clip.duration);
            expect(
              maxY(a.skeleton, "weapon", drawing.path) <= 0.5,
              `${skin}/${weapon}/${clip.name} blade entered floor`,
            );
          }
        }
      }
  },
  async function testDeathRestIgnoresGuardLandingAndLadderOverrides() {
    for (const skin of skins) {
      const a = fixture(skin);
      a.animator.currentAnim = "death";
      a.animator.time = 1500;
      a.movement.current = "climb";
      a.movement.ladderTop = 0;
      a.movement.landingTimer = 250;
      a.physics.grounded = true;
      a.combat.isBlocking = true;
      a.combat.blockZone = 1;
      a.combat.attackZone = 1;
      a.animation.update();
      a.bones.update();
      const m = a.skeleton.worldTransforms.get("weapon")!;
      near(Math.atan2(m.b, m.a), 0, `${skin} corpse weapon rest`);
      expect(!a.animator.climbPlant, "Death still plants a ladder hand");
    }
  },
  async function testEnemyJumpUsesTheSameSingleAnimationSoundOwner() {
    const a = fixture("rogue");
    a.movement.current = "jump";
    a.physics.velocity.y = -PLAYER_STATS.jumpForce;
    a.animation.update();
    a.animation.update();
    const sounds = a.world.getComponent<SoundRequestComponent>(a.id, "SoundRequest")!.requests;
    expect(
      sounds.filter((sound) => sound.id === "jump").length === 1,
      "Enemy jump lost or repeated its onset",
    );
  },
  async function testPlayerWeaponVariantsRemainDistinctAndKeepTiming() {
    for (const weapon of Object.keys(WEAPONS)) {
      const base = AssetLoader.getAnimation("heavy_attack_mid")!,
        clip = AssetLoader.getAnimation("heavy_attack_mid", { weapon })!;
      near(base.duration, clip.duration);
      expect(clip.events === base.events, "Variant changed timing source");
      if (weapon !== "longsword")
        expect(
          JSON.stringify(base.keyframes) !== JSON.stringify(clip.keyframes),
          `${weapon} has no authored accent`,
        );
    }
  },
  async function testJumpAttackHasCombatTimingInViewer() {
    const viewer = new AnimationViewer(document.createElement("canvas"));
    try {
      await viewer.init();
      viewer.setAnimation("jump_attack");
      viewer.setPlaybackMode("combat");
      expect(viewer.hasCombatTiming, "Air attack is still an unused raw-only preview");
    } finally {
      viewer.destroy();
    }
  },
  async function testAnimationWorkPreservesMovementBalance() {
    near(PLAYER_STATS.walkSpeed, 150);
    near(PLAYER_STATS.runSpeed, 250);
    near(PLAYER_STATS.crouchSpeed, 75);
    near(PLAYER_STATS.rollDuration, 500);
    near(PLAYER_STATS.rollDistance, 180);
    near(PLAYER_STATS.backstepDuration, 300);
    near(PLAYER_STATS.backstepDistance, 80);
  },
  async function testPlayerAttackGripsAvoidUnnaturalPropellerSpins() {
    const names = [
      "light_attack_high",
      "light_attack_mid",
      "light_attack_low",
      "heavy_attack_high",
      "heavy_attack_mid",
      "heavy_attack_low",
      "slide_attack",
      "slide_attack_heavy",
      "jump_attack",
      "jump_attack_heavy",
    ];
    for (const weapon of Object.keys(WEAPONS)) {
      for (const name of names) {
        const clip = AssetLoader.getAnimation(name, { weapon })!;
        for (let i = 1; i < clip.keyframes.length; i++) {
          const prev = clip.keyframes[i - 1].bones["weapon-grip"]?.rotate ?? 0;
          const next = clip.keyframes[i].bones["weapon-grip"]?.rotate ?? 0;
          expect(
            Math.abs(next - prev) <= 180,
            `${weapon}/${name} key ${i - 1}->${i} spun ${Math.abs(next - prev)} deg`,
          );
        }
      }
    }
  },
  async function testJumpAttacksBendFrontKneeNormally() {
    for (const name of ["jump_attack", "jump_attack_heavy"]) {
      const clip = AssetLoader.getAnimation(name)!;
      for (const kf of clip.keyframes) {
        expect(
          (kf.bones["leg-front-lower"]?.rotate ?? 0) >= 0 &&
            (kf.bones["leg-back-lower"]?.rotate ?? 0) >= 0,
          `${name} bent a lower leg backwards at t=${kf.time}`,
        );
      }
    }
  },
  async function testGroundAttacksSweepAcrossActiveWindows() {
    for (const name of [
      "light_attack_high",
      "light_attack_mid",
      "light_attack_low",
      "heavy_attack_high",
      "heavy_attack_mid",
      "heavy_attack_low",
    ]) {
      const clip = AssetLoader.getAnimation(name)!;
      const win = hitWindows(clip)[0];
      const a = fixture("player");
      preview(a, name, win.start * clip.duration);
      const startShoulder = a.skeleton.currentPose["shoulder-front"]?.rotate ?? 0;
      preview(a, name, win.end * clip.duration);
      const endShoulder = a.skeleton.currentPose["shoulder-front"]?.rotate ?? 0;
      expect(
        Math.abs(endShoulder - startShoulder) >= 10,
        `${name} stayed frozen (${startShoulder} -> ${endShoulder}) across active window`,
      );
    }
  },
  async function testGaitsMoveUpperBodyAndIdleSplitsLegs() {
    const idle = fixture("player");
    preview(idle, "idle", 0);
    const footFrontX = idle.skeleton.worldTransforms.get("foot-front")!.tx;
    const footBackX = idle.skeleton.worldTransforms.get("foot-back")!.tx;
    expect(Math.abs(footFrontX - footBackX) > 5, "Idle stacked both legs in one column");

    for (const name of ["walk", "run"]) {
      const a = fixture("player");
      const clip = AssetLoader.getAnimation(name)!;
      preview(a, name, 0);
      const back0 = a.skeleton.currentPose["shoulder-back"]?.rotate ?? 0;
      preview(a, name, clip.duration * 0.5);
      const backHalf = a.skeleton.currentPose["shoulder-back"]?.rotate ?? 0;
      expect(Math.abs(backHalf - back0) >= 15, `${name} kept back shoulder frozen across stride`);
    }
  },
  async function testHeavyJumpAndSlideVariantsDifferFromLight() {
    for (const [light, heavy] of [
      ["jump_attack", "jump_attack_heavy"],
      ["slide_attack", "slide_attack_heavy"],
    ]) {
      const lightClip = AssetLoader.getAnimation(light)!;
      const heavyClip = AssetLoader.getAnimation(heavy)!;
      near(lightClip.duration, heavyClip.duration);
      expect(
        JSON.stringify(lightClip.keyframes) !== JSON.stringify(heavyClip.keyframes),
        `${heavy} reused identical keyframes from ${light}`,
      );
    }
  },
  async function testUnifiedHitboxesMatchWeaponGeometryInGameplayAndViewer() {
    const expectedWeapons: Record<string, { w: number; h: number }> = {
      dagger: { w: 20, h: 4 },
      longsword: { w: 30, h: 4 },
      rapier: { w: 35, h: 2 },
      greatsword: { w: 40, h: 10 },
    };
    const expectedEnemies: Record<string, { w: number; h: number; anim: string }> = {
      hollow: { w: 24, h: 2, anim: "hollow_light_attack_mid" },
      soldier: { w: 30, h: 4, anim: "soldier_light_attack_mid" },
      duelist: { w: 35, h: 2, anim: "duelist_light_attack_high" },
      rogue: { w: 20, h: 2, anim: "rogue_light_attack_mid" },
      brute: { w: 45, h: 16, anim: "brute_heavy_attack_mid" },
      boss: { w: 45, h: 16, anim: "boss_heavy_attack_mid" },
    };

    for (const [weaponId, dims] of Object.entries(expectedWeapons)) {
      const bounds = drawingBounds(WeaponPaths[WEAPONS[weaponId].svgAsset].path, 0);
      near(bounds.width, dims.w, `${weaponId} svg width`);
      near(bounds.height, dims.h, `${weaponId} svg height`);

      for (const clipName of [
        "heavy_attack_low",
        "light_attack_mid",
        "slide_attack",
        "jump_attack",
      ]) {
        const a = fixture("player", weaponId);
        a.world.removeComponent(a.id, "PlayerInput");
        a.world.removeComponent(a.id, "Combat");
        a.world.removeComponent(a.id, "MovementState");
        const clip = AssetLoader.getAnimation(clipName, { weapon: weaponId })!;
        const win = hitWindows(clip)[0];
        const expected = resolveAttackHitbox(a.world, a.id, win.data, WEAPONS[weaponId]);
        near(expected.width, dims.w, `${weaponId}/${clipName} resolved width`);
        near(expected.height, dims.h, `${weaponId}/${clipName} resolved height`);
        near(expected.offset.x, dims.w / 2, `${weaponId}/${clipName} resolved offset.x`);
        near(expected.offset.y, 0, `${weaponId}/${clipName} resolved offset.y`);
        near(expected.rotation, 0, `${weaponId}/${clipName} resolved rotation`);

        a.animator.currentAnim = clipName;
        a.animator.time = Math.max(0, win.start * clip.duration - 1);
        a.animation.preview = {
          time: Math.max(0, win.start * clip.duration - 1),
          delta: 16,
          loop: false,
          emitEvents: true,
        };
        a.animation.update();
        const spawned = a.world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
        expect(!!spawned, `${weaponId}/${clipName} failed to spawn ActiveHitbox`);
        near(spawned.width, expected.width, `${weaponId}/${clipName} runtime width`);
        near(spawned.height, expected.height, `${weaponId}/${clipName} runtime height`);
        near(spawned.offset.x, expected.offset.x, `${weaponId}/${clipName} runtime offset.x`);
        near(spawned.offset.y, expected.offset.y, `${weaponId}/${clipName} runtime offset.y`);
        near(spawned.rotation, expected.rotation, `${weaponId}/${clipName} runtime rotation`);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    const originalFillRect = ctx.fillRect.bind(ctx);
    const viewer = new AnimationViewer(canvas);
    try {
      await viewer.init();
      viewer.isPlaying = false;
      const drawn: { x: number; y: number; w: number; h: number }[] = [];
      ctx.fillRect = function (x: number, y: number, w: number, h: number) {
        if (this.fillStyle === "rgba(0, 255, 0, 0.2)") drawn.push({ x, y, w, h });
        return originalFillRect(x, y, w, h);
      };

      for (const [weaponId, dims] of Object.entries(expectedWeapons)) {
        viewer.spawnEntity("player");
        viewer.setWeapon(weaponId);
        viewer.setPlaybackMode("clip");
        viewer.setAnimation("heavy_attack_low");
        viewer.setPlaybackTime(0.55 * viewer.clipDuration);
        drawn.length = 0;
        viewer.update(0);
        expect(drawn.length === 1, `Viewer missed overlay rect for player/${weaponId}`);
        near(drawn[0].w, dims.w, `viewer player/${weaponId} width`);
        near(drawn[0].h, dims.h, `viewer player/${weaponId} height`);
        near(drawn[0].x, -dims.w / 2, `viewer player/${weaponId} x`);
        near(drawn[0].y, -dims.h / 2, `viewer player/${weaponId} y`);
      }

      for (const [skin, info] of Object.entries(expectedEnemies)) {
        const a = fixture(skin as any);
        const clip = AssetLoader.getAnimation(info.anim)!;
        const win = hitWindows(clip)[0];
        a.world.removeComponent(a.id, "Combat");
        a.world.removeComponent(a.id, "MovementState");
        a.animator.currentAnim = info.anim;
        a.animator.time = Math.max(0, win.start * clip.duration - 1);
        a.animation.preview = {
          time: Math.max(0, win.start * clip.duration - 1),
          delta: 16,
          loop: false,
          emitEvents: true,
        };
        a.animation.update();
        const spawned = a.world.getComponent<ActiveHitboxComponent>(a.id, "ActiveHitbox")!;
        expect(!!spawned, `${skin}/${info.anim} failed to spawn ActiveHitbox`);
        near(spawned.width, info.w, `${skin} runtime width`);
        near(spawned.height, info.h, `${skin} runtime height`);
        near(spawned.offset.x, info.w / 2, `${skin} runtime offset.x`);
        near(spawned.rotation, 0, `${skin} runtime rotation`);

        // Switching the viewer's player weapon selector must not scale an enemy's weapon hitbox,
        // even when previewing a cross-character player clip on that enemy.
        viewer.spawnEntity(skin);
        viewer.setWeapon("greatsword");
        viewer.setPlaybackMode("clip");
        viewer.setAnimation("heavy_attack_low");
        viewer.setPlaybackTime(0.55 * viewer.clipDuration);
        drawn.length = 0;
        viewer.update(0);
        expect(drawn.length === 1, `Viewer missed cross-character overlay for ${skin}`);
        near(drawn[0].w, info.w, `viewer ${skin} cross-clip width`);
        near(drawn[0].h, info.h, `viewer ${skin} cross-clip height`);
      }
    } finally {
      ctx.fillRect = originalFillRect;
      viewer.destroy();
    }
  },
  async function testAuthoredWeaponHitboxesAlignStrictlyWithWeaponBone() {
    for (const clip of AssetLoader.animations.values()) {
      for (const event of clip.events ?? []) {
        if (event.type !== "hitbox-start" || event.data?.attachedToBone !== "weapon") continue;
        near(event.data.rotation ?? 0, 0, `${clip.name} weapon hitbox rotation`);
        near(event.data.offset?.y ?? 0, 0, `${clip.name} weapon hitbox offset.y`);
      }
    }
  },
];
