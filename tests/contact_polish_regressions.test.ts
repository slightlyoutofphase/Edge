import { World } from "../core/World";
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
import { EnemyType } from "../data/EnemyTypes";
import { AssetLoader } from "../assets/AssetLoader";
import { TransformComponent } from "../components/Transform";
import { ColliderComponent } from "../components/Collider";
import { HealthComponent } from "../components/Health";
import { FactionComponent } from "../components/Faction";
import { InventoryComponent } from "../components/Inventory";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { MovementSystem } from "../features/movement/MovementSystem";
import { CombatComponent } from "../features/combat/CombatComponent";
import { HitEvent } from "../features/combat/HitEvent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { DamageSystem } from "../features/combat/DamageSystem";
import { HitDetectionSystem } from "../features/combat/HitDetectionSystem";
import { actorContacts, actorWeaponPath } from "../features/combat/ContactGeometry";
import { bodySeparationBounds, bodyContactDistance } from "../features/combat/BodySeparation";
import { actorInertia, applyImpactVelocity } from "../features/combat/ImpactResponse";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { poseMatrices, placeHand, weaponDirection } from "../animation/data/PoseAuthoring";
import { blendWeaponDirection } from "../features/animation/ContactPose";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { AISystem } from "../features/ai/AISystem";
import { BossStrategy, SoldierStrategy } from "../features/ai/EnemyStrategies";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { CollisionSystem } from "../systems/CollisionSystem";
import { PhysicsSystem } from "../features/movement/PhysicsSystem";
import { EffectSystem } from "../systems/EffectSystem";
import {
  HitFlashComponent,
  VisualEffectComponent,
} from "../features/visuals/VisualEffectComponent";
import { SpawnEffectComponent } from "../components/SpawnEffect";
import { SpriteCache } from "../utils/SpriteCache";
import { aabbIntersects } from "../utils/AABB";

function expect(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function near(a: number, b: number, label: string, epsilon = 0.02) {
  expect(Math.abs(a - b) < epsilon, `${label}: ${a} != ${b}`);
}
type Skin = EnemyType | "player";
function fixture(source: Skin = "soldier", targetSkin: Skin = "soldier", distance = 60) {
  const world = new World(),
    time = Object.assign(new TimeState(), { delta: 1000 / 60, elapsed: 1000 });
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
  const make = (skin: Skin, x: number) =>
    skin === "player" ? createPlayer(world, x, 0) : createEnemy(world, x, 0, skin);
  const id = make(source, 0),
    target = make(targetSkin, distance);
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
        hasAttackToken: true,
        flankTimer: 10000,
        decisionTimer: 10000,
      });
  }
  const animation = new AnimationSystem(world),
    bones = new SkeletonSystem(world),
    collision = new CollisionSystem(world);
  animation.update();
  bones.update();
  collision.update(false);
  const combat = world.getComponent<CombatComponent>(id, "Combat")!,
    targetCombat = world.getComponent<CombatComponent>(target, "Combat")!;
  combat.attackSerial = 10;
  targetCombat.attackSerial = 11;
  return {
    world,
    id,
    target,
    time,
    animation,
    bones,
    collision,
    combat,
    targetCombat,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
    targetPhysics: world.getComponent<PhysicsComponent>(target, "Physics")!,
    transform: world.getComponent<TransformComponent>(id, "Transform")!,
    targetTransform: world.getComponent<TransformComponent>(target, "Transform")!,
    damage: new DamageSystem(world),
    hits: new HitDetectionSystem(world),
    queue: world.getResource<CombatEventQueue>(CombatEventQueue),
  };
}
function hit(a: ReturnType<typeof fixture>, extra: Partial<HitEvent> = {}): HitEvent {
  return {
    attackerId: a.id,
    targetId: a.target,
    damage: 10,
    poiseDamage: 0,
    zone: 2,
    attackType: "light",
    knockback: { x: 100, y: 0 },
    impactPoint: { x: 30, y: -25 },
    isBlockable: true,
    contactType: "body",
    attackSerial: 10,
    ...extra,
  };
}
function resolve(a: ReturnType<typeof fixture>, extra: Partial<HitEvent> = {}) {
  a.queue.events.push(hit(a, extra));
  a.damage.update();
}
function floorDepth(a: ReturnType<typeof fixture>) {
  const m = a.world
    .getComponent<SkeletonComponent>(a.id, "Skeleton")!
    .worldTransforms.get("weapon")!;
  const coordinates = SpriteCache.getCoordinates(actorWeaponPath(a.world, a.id)!);
  let y = -Infinity;
  for (let i = 0; i < coordinates.length; i += 2)
    y = Math.max(y, m.b * coordinates[i] + m.d * coordinates[i + 1] + m.ty);
  return y - a.transform.position.y;
}
function assertGrip(a: ReturnType<typeof fixture>) {
  const s = a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!,
    m = s.worldTransforms.get("weapon")!,
    back = s.worldTransforms.get("hand-back")!;
  near(back.tx, m.tx - m.a * 3, "Support hand x");
  near(back.ty, m.ty - m.b * 3, "Support hand y");
}

export const tests = [
  async function testSolidFootprintReflectsFacingAndExcludesWeaponSize() {
    const a = fixture("alpha_hellhound");
    const right = { ...bodySeparationBounds(a.world, a.id) };
    expect(right.width > 100, "Alpha retained only its narrow movement box");
    a.transform.facing = -1;
    const left = bodySeparationBounds(a.world, a.id);
    near(left.x, -right.x - right.width, "Reflected footprint");
    near(left.width, right.width, "Footprint width");
    const p = fixture("player");
    const before = { ...bodySeparationBounds(p.world, p.id) };
    p.world.getComponent<InventoryComponent>(p.id, "Inventory")!.currentWeapon = "greatsword";
    near(
      bodySeparationBounds(p.world, p.id).width,
      before.width,
      "Equipped weapon became a solid body",
    );
  },
  async function testAttackArmPosesDoNotInflateSolidClearance() {
    const a = fixture("boss");
    const before = { ...bodySeparationBounds(a.world, a.id) };
    const s = a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!;
    placeHand(s.currentPose, "front", { x: 35, y: -30 });
    a.bones.updateEntity(a.id);
    const after = bodySeparationBounds(a.world, a.id);
    near(after.width, before.width, "Arm pose changed clearance");
    near(after.x, before.x, "Arm pose shifted clearance");
  },
  async function testRearPostureDoesNotLeaveAGroundLevelPhantomMuzzle() {
    const a = fixture("hellhound");
    const normal = bodyContactDistance(a.world, a.id, a.target);
    a.world.getComponent<ColliderComponent>(a.id, "Collider")!.hurtboxes[0].height = 80;
    expect(
      bodyContactDistance(a.world, a.id, a.target) < normal - 2,
      "Lifted muzzle still blocked the paw swipe's reach",
    );
  },
  async function testFourLargeBodiesResolveTheirCrowdChain() {
    const a = fixture("alpha_hellhound", "alpha_hellhound", 20);
    const ids = [
      a.id,
      a.target,
      createEnemy(a.world, 40, 0, "alpha_hellhound"),
      createEnemy(a.world, 60, 0, "alpha_hellhound"),
    ];
    for (const id of ids) a.world.getComponent<PhysicsComponent>(id, "Physics")!.grounded = true;
    for (let frame = 0; frame < 12; frame++) a.collision.update();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        expect(
          !aabbIntersects(
            bodySeparationBounds(a.world, ids[i]),
            bodySeparationBounds(a.world, ids[j]),
          ),
          "A resolved crowd retained overlapping solid bodies",
        );
  },
  async function testFrozenActorStaysFixedWhileIncomingBodySeparates() {
    const a = fixture("soldier", "boss", 5);
    a.world.addComponent(a.target, "HitStop", { frames: 6, remainingMs: 100 });
    a.targetPhysics.velocity.x = -100;
    a.physics.velocity.x = 100;
    a.collision.update();
    near(a.targetTransform.position.x, 5, "Frozen root moved");
    near(a.targetPhysics.velocity.x, -100, "Stored frozen impulse changed");
    expect(
      !aabbIntersects(bodySeparationBounds(a.world, a.id), bodySeparationBounds(a.world, a.target)),
      "Moving body entered a frozen actor",
    );
  },
  async function testBodyPressureCannotLaunchAnIdleActorIntoAPersistentWalk() {
    const a = fixture("hellhound", "soldier", 5);
    a.physics.velocity.x = 150;
    a.targetPhysics.velocity.x = 0;
    a.collision.update();
    near(a.targetPhysics.velocity.x, 0, "Body contact injected walk speed");
    new MovementSystem(a.world).update();
    expect(
      a.world.getComponent<MovementStateComponent>(a.target, "MovementState")!.current === "idle",
      "Body pressure generated a walk state",
    );
  },
  async function testWaitingAllyKeepsClearanceInsteadOfPushingTheFrontLine() {
    const a = fixture("soldier", "soldier", 80),
      ally = createEnemy(a.world, 12, 0, "soldier");
    a.world.getComponent<FactionComponent>(ally, "Faction")!.team = 3;
    const ai = a.world.getComponent<AIControllerComponent>(a.id, "AIController")!;
    ai.hasAttackToken = false;
    new SoldierStrategy().update(16, a.id, a.world);
    expect(
      a.physics.velocity.x <= 0 && a.combat.attackState === "idle",
      "Waiting ally marched through the front-line body",
    );
  },
  async function testScreenedLiveTargetIsReplacedByTheNearerHostileBetweenSwings() {
    const a = fixture(),
      blocker = createEnemy(a.world, 25, 0, "soldier");
    a.world.getComponent<FactionComponent>(blocker, "Faction")!.team = 4;
    new AISystem(a.world).update();
    expect(
      a.world.getComponent<AIControllerComponent>(a.id, "AIController")!.target === blocker,
      "A live distant assignment stranded the front line behind another hostile body",
    );
  },
  async function testCommittedSwingKeepsItsOriginalTargetWhenAnotherHostileApproaches() {
    const a = fixture(),
      blocker = createEnemy(a.world, 25, 0, "soldier");
    a.world.getComponent<FactionComponent>(blocker, "Faction")!.team = 4;
    a.combat.attackState = "windup";
    a.combat.attackTimer = 200;
    new AISystem(a.world).update();
    expect(
      a.world.getComponent<AIControllerComponent>(a.id, "AIController")!.target === a.target,
      "Target switching redirected a committed swing",
    );
  },
  async function testHandOnlyContactRegistersAndNamesTheLimb() {
    const a = fixture();
    const s = a.world.getComponent<SkeletonComponent>(a.target, "Skeleton")!;
    placeHand(s.currentPose, "front", { x: 30, y: -30 });
    a.bones.updateEntity(a.target);
    const art = actorContacts(a.world, a.target),
      i = art.parts!.indexOf("hand-front"),
      center = art.bodies[i].center;
    a.world.addComponent(a.id, "ActiveHitbox", {
      sourceEntityId: a.id,
      offset: { x: center.x, y: center.y },
      width: 1,
      height: 1,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      zone: 2,
      attackType: "light",
      knockback: { x: 0, y: 0 },
      alreadyHit: new Set(),
    } as ActiveHitboxComponent);
    a.combat.attackState = "active";
    a.hits.update();
    const contact = a.queue.events.find((e) => e.targetId === a.target);
    expect(
      contact?.contactType === "body" && /^(hand-|arm-)/.test(contact.targetBone ?? ""),
      "An isolated hand/arm strike missed or was attributed to the torso",
    );
  },
  async function testHumanoidArmsUseSmallPosedContactShapes() {
    const a = fixture();
    const art = actorContacts(a.world, a.target);
    for (const side of ["front", "back"])
      for (const bone of [`arm-${side}-upper`, `arm-${side}-lower`, `hand-${side}`]) {
        const i = art.parts!.indexOf(bone);
        expect(i >= 0, `Missing ${bone} contact`);
        expect(
          Math.hypot(art.bodies[i].u.x, art.bodies[i].u.y) < 10,
          "A limb received a torso-sized damage shape",
        );
      }
  },
  async function testFleshFlashIsLocalAndTranslucent() {
    const a = fixture("soldier", "alpha_hellhound");
    resolve(a, { targetBone: "jaw" });
    const flash = a.world.getComponent<HitFlashComponent>(a.target, "HitFlash")!;
    expect(
      flash.bone === "jaw" && flash.opacity! <= 0.45 && flash.durationMs === 80,
      "Contact replaced the Alpha with an opaque full-body flash",
    );
  },
  async function testGuardAndClashEffectsDifferFromFleshContact() {
    const types: string[] = [];
    for (const kind of ["body", "guard", "clash"] as const) {
      const a = fixture();
      if (kind === "guard") Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
      if (kind === "clash") {
        a.combat.attackState = a.targetCombat.attackState = "active";
        a.combat.attackType = a.targetCombat.attackType = "light";
      }
      resolve(a, { contactType: kind, targetAttackSerial: 11 });
      const spawn = a.world
        .query("SpawnEffect")
        .map((e) => e.components[0] as SpawnEffectComponent);
      types.push(spawn[0].type);
    }
    expect(
      types.join() === "flesh_hit,block_spark,clash_spark",
      "Flesh, guard and blade clash still share an indistinguishable spark",
    );
  },
  async function testLocalFlashUsesElapsedTimeAtDifferentFrameRates() {
    for (const fps of [30, 60, 120]) {
      const a = fixture();
      resolve(a);
      a.world.removeComponent(a.target, "HitStop");
      a.time.delta = 1000 / fps;
      const effect = new EffectSystem(a.world);
      for (let n = 0; n < Math.ceil((80 * fps) / 1000); n++) effect.update();
      expect(
        !a.world.hasComponent(a.target, "HitFlash"),
        `Flash lifetime counted frames at ${fps} fps`,
      );
    }
  },
  async function testLocalFlashPausesForItsOwnContactHitstop() {
    const a = fixture();
    resolve(a);
    const flash = a.world.getComponent<HitFlashComponent>(a.target, "HitFlash")!;
    new EffectSystem(a.world).update();
    near(flash.remainingMs!, 80, "Entity hitstop consumed the local flash");
  },
  async function testContactParticlesKeepTheirDistinctRenderTypes() {
    const a = fixture();
    const effects = new EffectSystem(a.world);
    for (const type of ["flesh_hit", "block_spark", "clash_spark"] as const) {
      const id = a.world.createEntity();
      a.world.addComponent(id, "SpawnEffect", {
        type,
        position: { x: 30, y: -20 },
      } as SpawnEffectComponent);
    }
    effects.update();
    const types = new Set(
      a.world.query("VisualEffect").map((e) => (e.components[0] as VisualEffectComponent).type),
    );
    expect(
      types.size === 3 && !types.has("spark"),
      "Distinct contact particles fell back to the generic spark",
    );
  },
  async function testWeaponWeightChangesPlayerPushWithoutChangingDamage() {
    const pushes: number[] = [],
      damage: number[] = [];
    for (const weapon of ["dagger", "rapier", "longsword", "greatsword"]) {
      const a = fixture("player");
      a.world.getComponent<InventoryComponent>(a.id, "Inventory")!.currentWeapon = weapon;
      resolve(a);
      pushes.push(a.targetPhysics.velocity.x);
      damage.push(a.world.getComponent<HealthComponent>(a.target, "Health")!.current);
    }
    expect(
      pushes.every((p, i) => i === 0 || p > pushes[i - 1]),
      "Dagger, rapier and greatsword still deliver identical push",
    );
    expect(
      damage.every((d) => d === damage[0]),
      "Impulse calibration changed health damage",
    );
  },
  async function testActorSizeAndBuildResistTheSameWeaponDifferently() {
    const pushes: number[] = [];
    for (const skin of ["hellhound", "soldier", "brute", "boss", "alpha_hellhound"] as const) {
      const a = fixture("player", skin);
      resolve(a);
      pushes.push(a.targetPhysics.velocity.x);
    }
    expect(
      pushes.every((p, i) => i === 0 || p < pushes[i - 1]),
      "Small creature and large bosses resist the same push identically",
    );
    expect(
      pushes[4] > 0 && pushes[4] < pushes[1] * 0.3,
      "Alpha is either immovable or light as a Soldier",
    );
  },
  async function testCrouchingAndRearingCannotChangeImpactInertia() {
    for (const skin of ["player", "hellhound", "alpha_hellhound"] as const) {
      const a = fixture(skin),
        before = actorInertia(a.world, a.id),
        box = a.world.getComponent<ColliderComponent>(a.id, "Collider")!.hurtboxes[0];
      box.height *= 0.6;
      box.y = -box.height;
      near(actorInertia(a.world, a.id), before, "Crouch changed mass");
      box.height = 80;
      near(actorInertia(a.world, a.id), before, "Rear changed mass");
    }
  },
  async function testBehindTheAttackerContactPushesTowardTheActualVictim() {
    const a = fixture("soldier", "player", -40);
    a.transform.facing = 1;
    resolve(a);
    expect(
      a.targetPhysics.velocity.x < 0 && a.targetCombat.impact!.direction === -1,
      "A backward sweep pushed the victim toward the attacker",
    );
  },
  async function testExplicitZeroVerticalPushPreservesGroundAndAirMotion() {
    for (const vy of [0, -600, 650]) {
      const a = fixture();
      a.targetPhysics.velocity.y = vy;
      a.targetPhysics.grounded = vy === 0;
      resolve(a);
      near(a.targetPhysics.velocity.y, vy, "Zero vertical force erased existing motion");
      expect(a.targetPhysics.grounded === (vy === 0), "Horizontal contact invented a launch");
    }
  },
  async function testTinyLiftBracesAHeavyGroundedBody() {
    const a = fixture("player", "alpha_hellhound");
    resolve(a, { knockback: { x: 100, y: -50 } });
    expect(
      a.targetPhysics.grounded && a.targetPhysics.velocity.y === 0,
      "A tiny lift floated the Alpha",
    );
    const b = fixture("boss", "player");
    resolve(b, { attackType: "heavy", knockback: { x: 200, y: -80 } });
    expect(
      !b.targetPhysics.grounded && b.targetPhysics.velocity.y < -45,
      "A meaningful heavy launch was removed",
    );
  },
  async function testRepeatedPushCannotStackAnUnboundedLaunch() {
    const a = fixture();
    for (let n = 0; n < 20; n++) applyImpactVelocity(a.targetPhysics, 100, -100);
    near(a.targetPhysics.velocity.x, 100, "Horizontal push stacked");
    near(a.targetPhysics.velocity.y, -100, "Vertical launch stacked");
  },
  async function testAirborneCounterImpulseDoesNotInstantlyReverseAFastFall() {
    const a = fixture();
    a.targetPhysics.grounded = false;
    a.targetPhysics.velocity.y = 650;
    applyImpactVelocity(a.targetPhysics, 0, -100);
    expect(
      a.targetPhysics.velocity.y > 500 && a.targetPhysics.velocity.y < 650,
      "Small lift replaced a fast fall with an instant jump",
    );
  },
  async function testPlayerAndNPCInputsDoNotEraseContactMomentumImmediately() {
    const a = fixture("soldier", "player");
    resolve(a);
    a.world.removeComponent(a.target, "HitStop");
    const push = a.targetPhysics.velocity.x;
    new MovementSystem(a.world).update();
    near(a.targetPhysics.velocity.x, push, "Player idle input erased knockback");
    applyImpactVelocity(a.physics, -100);
    const ai = a.world.getComponent<AIControllerComponent>(a.id, "AIController")!;
    ai.attackCooldownTimer = 10000;
    new SoldierStrategy().update(16, a.id, a.world);
    near(a.physics.velocity.x, -100, "NPC locomotion erased recoil");
  },
  async function testImpactControlDurationFreezesWithTheActor() {
    const a = fixture();
    applyImpactVelocity(a.physics, -100);
    a.world.addComponent(a.id, "HitStop", { frames: 4 });
    new MovementSystem(a.world).update();
    near(a.physics.impactControlMs!, 100, "Hitstop spent the control hold");
    a.world.removeComponent(a.id, "HitStop");
    a.time.delta = 25;
    new MovementSystem(a.world).update();
    near(a.physics.impactControlMs!, 75, "Hold did not resume by elapsed time");
  },
  async function testAHeavyWeaponClashOverpowersALightWeaponAtEqualActorSize() {
    const a = fixture("player", "rogue");
    a.world.getComponent<InventoryComponent>(a.id, "Inventory")!.currentWeapon = "greatsword";
    a.combat.attackState = a.targetCombat.attackState = "active";
    a.combat.attackType = a.targetCombat.attackType = "light";
    resolve(a, { contactType: "clash", targetAttackSerial: 11 });
    expect(
      a.combat.attackState === "active" && (a.targetCombat.attackState as string) === "recovery",
      "Small weapon met a greatsword as an equal blade",
    );
  },
  async function testEqualClashPlansAHeightAndTimingResponseForBothActors() {
    const a = fixture("boss", "boss");
    a.combat.attackState = a.targetCombat.attackState = "active";
    a.combat.attackType = a.targetCombat.attackType = "heavy";
    resolve(a, { contactType: "clash", targetAttackSerial: 11 });
    const ar = a.world.getComponent<AIControllerComponent>(a.id, "AIController")!.clashResponse!,
      br = a.world.getComponent<AIControllerComponent>(a.target, "AIController")!.clashResponse!;
    expect(
      ar?.pending && br?.pending && ar.zone !== 2 && br.zone !== 2,
      "Clashing actors repeated their previous attack height",
    );
    expect(ar.delay !== br.delay, "A mirror clash scheduled identical retry times");
  },
  async function testClashResponseCommitsItsAlternativeWithoutAnEndlessWait() {
    const a = fixture("boss", "boss", 35);
    a.combat.attackState = a.targetCombat.attackState = "active";
    a.combat.attackType = a.targetCombat.attackType = "heavy";
    resolve(a, { contactType: "clash", targetAttackSerial: 11 });
    const ai = a.world.getComponent<AIControllerComponent>(a.id, "AIController")!,
      zone = ai.clashResponse!.zone;
    a.world.removeComponent(a.id, "HitStop");
    a.world.removeComponent(a.target, "HitStop");
    a.combat.attackState = "idle";
    a.targetCombat.attackState = "idle";
    ai.attackCooldownTimer = 0;
    ai.bossSpecialReadyAt = Infinity;
    const previous = Math.random;
    try {
      Math.random = () => 0.99;
      for (let n = 0; n < 90 && a.combat.attackState === "idle"; n++) {
        a.time.elapsed += 16;
        new BossStrategy().update(16, a.id, a.world);
        new MovementSystem(a.world).update();
        new PhysicsSystem(a.world).update();
        a.collision.update();
      }
    } finally {
      Math.random = previous;
    }
    expect(
      (a.combat.attackState as string) === "windup" &&
        a.combat.attackZone === zone &&
        !ai.clashResponse!.pending,
      "Post-clash alternative did not commit",
    );
  },
  async function testCeilingRecoilDeflectsTheBladeWithoutASidewaysShove() {
    const a = fixture("brute");
    a.combat.attackState = "active";
    resolve(a, {
      targetId: -1,
      contactType: "terrain",
      impactNormal: { x: 0, y: 1 },
      knockback: { x: 0, y: 0 },
    });
    near(a.physics.velocity.x, 0, "Ceiling caused a sideways shove");
    expect(
      a.combat.impact?.recoil && (a.combat.attackState as string) === "recovery",
      "Ceiling lost blade deflection",
    );
  },
  async function testTerrainRecoilUsesTheContactNormalEvenBehindTheActor() {
    const a = fixture("brute");
    a.transform.facing = 1;
    a.combat.attackState = "active";
    resolve(a, {
      targetId: -1,
      contactType: "terrain",
      impactNormal: { x: 1, y: 0 },
      impactPoint: { x: -20, y: -30 },
    });
    expect(a.physics.velocity.x > 0, "Rear wall recoil pushed into the wall");
  },
  async function testHeavyGuardRecoilsTheSmallAttackerMoreThanTheLargeOne() {
    const recoil: number[] = [];
    for (const source of ["rogue", "brute"] as const) {
      const a = fixture(source, "boss");
      a.combat.attackState = "active";
      Object.assign(a.targetCombat, { isBlocking: true, blockZone: 2 });
      resolve(a, { contactType: "guard", attackType: source === "brute" ? "heavy" : "light" });
      recoil.push(Math.abs(a.physics.velocity.x));
      expect(
        a.targetPhysics.velocity.x > 0 && a.physics.velocity.x < 0,
        "Guard response did not separate the actors",
      );
    }
    expect(recoil[0] > recoil[1] * 1.5, "Light and massive attackers receive the same deflection");
  },
  async function testRecoveryStepKeepsFeetAndHeavySupportHandAttached() {
    for (const skin of ["brute", "boss"] as const)
      for (const facing of [1, -1] as const) {
        const a = fixture(skin, "soldier", 200);
        a.transform.facing = facing;
        a.time.delta = 0;
        const before =
          a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!.currentPose["leg-back-lower"]
            ?.rotate ?? 0;
        a.combat.impact = {
          remaining: 90,
          duration: 180,
          direction: -facing,
          guard: true,
          recoil: true,
          strength: 1,
        };
        a.animation.update();
        a.bones.update();
        const s = a.world.getComponent<SkeletonComponent>(a.id, "Skeleton")!;
        expect(
          Math.abs((s.currentPose["leg-back-lower"]?.rotate ?? 0) - before) > 4,
          "Recoil did not create a bracing step",
        );
        const soles = ["foot-front", "foot-back"].map((b) => {
          const m = s.worldTransforms.get(b)!;
          return m.ty + 4 * m.d;
        });
        near(Math.max(...soles), 0, "Support soles detached");
        assertGrip(a);
        expect(floorDepth(a) <= 0.1, "Recoil deflection dipped the weapon through the floor");
      }
  },
  async function testDisplayedHeavyWeaponRecoveryAndGuardTransitionsClearTheFloor() {
    for (const skin of ["brute", "boss"] as const)
      for (const facing of [1, -1] as const)
        for (const fps of [30, 60, 120]) {
          const a = fixture(skin, "soldier", 200);
          a.transform.facing = facing;
          a.time.delta = 1000 / fps;
          a.world.removeComponent(a.id, "MovementState");
          a.world.removeComponent(a.id, "Combat");
          const animator = a.world.getComponent<AnimatorComponent>(a.id, "Animator")!;
          for (const name of [
            skin + "_heavy_attack_mid",
            "idle",
            skin === "brute" ? "brute_heavy_attack_sweep" : "boss_heavy_attack_low",
            skin + "_walk",
            skin + "_heavy_attack_high",
            "idle",
          ]) {
            if (!AssetLoader.getAnimation(name)) continue;
            beginAnimation(animator, name);
            for (let n = 0; n < fps; n++) {
              a.animation.update();
              a.bones.update();
              expect(
                floorDepth(a) <= 0.1,
                `${skin}/${name}/${fps} displayed a floor-penetrating weapon`,
              );
              assertGrip(a);
            }
          }
        }
  },
  async function testWeaponTransitionUsesTheGlobalShortestBladeTurn() {
    const pose = {
      torso: { rotate: 80 },
      "shoulder-front": { rotate: -80 },
      "weapon-grip": { rotate: 170 },
    };
    blendWeaponDirection(pose, 170, -170, 0.5);
    near(weaponDirection(pose), 180, "Blade took the long rotation path");
    expect(poseMatrices(pose).get("weapon") !== undefined, "Blend detached the weapon chain");
  },
  async function testLowCoverHopHasAnAccessibleTakeoffWhenPursuerIsFlushWithStone() {
    for (const direction of [1, -1]) {
      const a = fixture("boss", "player", direction * 84.5);
      createPlatform(a.world, direction === 1 ? 10.5 : -22.5, -30, 12, 30, "solid");
      const nav = a.world.getResource<NavigationGraph>(NavigationGraph);
      nav.build(a.world);
      const path = nav.findPath(a.transform.position, a.targetTransform.position, {
        width: 21,
        height: 96,
      });
      expect(
        path[0]?.action === "jump" && path[0].takeoff!.x * direction < 0,
        "A flush pursuer planned a fall from the cover's unreachable top",
      );
    }
  },
];
