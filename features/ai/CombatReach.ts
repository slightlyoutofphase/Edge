import { World, EntityId } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { PlatformComponent } from "../../components/Platform";
import { ColliderComponent } from "../../components/Collider";
import { AABB, aabbIntersects } from "../../utils/AABB";
import { SpatialGridState } from "../../core/Resources";
import { CombatComponent } from "../combat/CombatComponent";
import { ActiveHitboxComponent } from "../combat/ActiveHitboxComponent";
import { AIControllerComponent } from "./AIControllerComponent";
import { InventoryComponent } from "../../components/Inventory";
import { WEAPONS } from "../../data/WeaponDefinitions";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { isQuadruped } from "../../data/EnemyTypes";
import { HealthComponent } from "../../components/Health";
import { FactionComponent } from "../../components/Faction";
import { AssetLoader } from "../../assets/AssetLoader";
import { AnimationSystem } from "../animation/AnimationSystem";
import { Animation } from "../animation/AnimationTypes";
import { SkeletonComponent } from "../animation/SkeletonComponent";
import { poseMatrices } from "../../animation/data/PoseAuthoring";
import { attackMotionOffset } from "../combat/AttackTiming";
import { Matrix2D } from "../../utils/Matrix2D";
import { actorContacts, actorWeaponPath } from "../combat/ContactGeometry";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { GRAVITY } from "../../core/Constants";
import { HitboxShape, resolveAttackHitbox } from "../combat/HitboxGeometry";
import { bodySeparationBounds } from "../combat/BodySeparation";

const terrainCandidates: number[] = [];

export function actorBounds(world: World, id: EntityId): AABB | undefined {
  const t = world.getComponent<TransformComponent>(id, "Transform"),
    box = world.getComponent<ColliderComponent>(id, "Collider")?.hurtboxes[0];
  if (!t || !box) return;
  return {
    x: t.position.x + box.x * Math.abs(t.scale.x),
    y: t.position.y + box.y * t.scale.y,
    width: box.width * Math.abs(t.scale.x),
    height: box.height * t.scale.y,
  };
}

export function attackRange(world: World, sourceId: EntityId, targetId: EntityId): number {
  const ai = world.getComponent<AIControllerComponent>(sourceId, "AIController")!;
  if (ai.pendingAttack?.target === targetId) return ai.pendingAttack.range;
  // Existing ranges were tuned against the player's 14-unit body. Preserve
  // that baseline while permitting attacks outside a large target's body.
  return ai.behaviorParams.attackRange + targetRangeAllowance(world, sourceId, targetId);
}

function targetRangeAllowance(world: World, sourceId: number, targetId: number): number {
  let radius = (actorBounds(world, targetId)?.width ?? 14) / 2;
  const type = world.getComponent<EnemyTagComponent>(targetId, "EnemyTag")?.enemyType;
  if (type && isQuadruped(type) && world.hasComponent(targetId, "Collider")) {
    const source = world.getComponent<TransformComponent>(sourceId, "Transform")!;
    const target = world.getComponent<TransformComponent>(targetId, "Transform")!;
    const body = bodySeparationBounds(world, targetId);
    radius = Math.max(
      radius,
      source.position.x <= target.position.x
        ? target.position.x - body.x
        : body.x + body.width - target.position.x,
    );
  }
  return radius - 7;
}

type ReachSample = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  motionX: number;
  motionY: number;
  shape: HitboxShape;
  window: number;
};
function reachProfileKey(world: World, sourceId: EntityId): string {
  const inventory = world.getComponent<InventoryComponent>(sourceId, "Inventory");
  return `${actorWeaponPath(world, sourceId) ?? ""}:${inventory?.currentWeapon ?? ""}`;
}

const reachProfiles = new WeakMap<Animation, Map<string, ReachSample[]>>();
const samplers = new WeakMap<World, AnimationSystem>();
const rangeCache = new WeakMap<
  SkeletonComponent,
  { clip: Animation; target: number; key: string; range: number }
>();

export function animationAttackRange(
  world: World,
  sourceId: EntityId,
  targetId: EntityId,
  name: string,
  anticipate = 0,
): number {
  const source = world.getComponent<TransformComponent>(sourceId, "Transform")!;
  const targetBox = actorBounds(world, targetId);
  const inventory = world.getComponent<InventoryComponent>(sourceId, "Inventory");
  const clip = AssetLoader.getAnimation(name, {
    skin: world.getComponent<EnemyTagComponent>(sourceId, "EnemyTag")?.enemyType ?? "player",
    weapon: inventory?.currentWeapon,
  });
  const skeleton = world.getComponent<SkeletonComponent>(sourceId, "Skeleton");
  const rig = skeleton?.definition ?? (skeleton && AssetLoader.getSkeleton(skeleton.definitionId));
  const baseline = Math.min(
    (world.getComponent<AIControllerComponent>(sourceId, "AIController")?.behaviorParams
      .attackRange ?? (WEAPONS[inventory?.currentWeapon ?? "longsword"]?.reach ?? 28) + 20) +
      targetRangeAllowance(world, sourceId, targetId),
    (clip?.engagementRange ?? Infinity) * Math.abs(source.scale.x),
  );
  if (!clip || !rig || !targetBox) return baseline;
  const profileKey = reachProfileKey(world, sourceId);
  let clipProfiles = reachProfiles.get(clip);
  if (!clipProfiles) {
    clipProfiles = new Map();
    reachProfiles.set(clip, clipProfiles);
  }
  let samples = clipProfiles.get(profileKey);
  if (!samples) {
    samples = [];
    let sampler = samplers.get(world);
    if (!sampler) {
      sampler = new AnimationSystem(world);
      samplers.set(world, sampler);
    }
    const weapon = inventory ? WEAPONS[inventory.currentWeapon] : undefined;
    const matrices = new Map<string, Matrix2D>();
    for (let i = 0; i < (clip.events?.length ?? 0); i++) {
      const start = clip.events![i];
      if (start.type !== "hitbox-start" || !start.data) continue;
      const end = clip.events!.slice(i + 1).find((e) => e.type === "hitbox-end")?.time ?? 1;
      const resolved = resolveAttackHitbox(world, sourceId, start.data, weapon),
        hb = { ...start.data, ...resolved },
        angle = (resolved.rotation * Math.PI) / 180;
      for (let n = 0; n <= 24; n++) {
        const t = (start.time + ((end - start.time) * n) / 24) * clip.duration;
        const m =
          poseMatrices(sampler.sampleAnimation(clip, t), rig, matrices).get(hb.attachedToBone) ??
          new Matrix2D();
        const cx = m.a * hb.offset.x + m.c * hb.offset.y + m.tx,
          cy = m.b * hb.offset.x + m.d * hb.offset.y + m.ty;
        const ux = ((m.a * Math.cos(angle) + m.c * Math.sin(angle)) * hb.width) / 2;
        const uy = ((m.b * Math.cos(angle) + m.d * Math.sin(angle)) * hb.width) / 2;
        const vx = ((-m.a * Math.sin(angle) + m.c * Math.cos(angle)) * hb.height) / 2;
        const vy = ((-m.b * Math.sin(angle) + m.d * Math.cos(angle)) * hb.height) / 2;
        const motion = attackMotionOffset(clip, t);
        samples.push({
          left: cx - Math.abs(ux) - Math.abs(vx),
          right: cx + Math.abs(ux) + Math.abs(vx),
          top: cy - Math.abs(uy) - Math.abs(vy),
          bottom: cy + Math.abs(uy) + Math.abs(vy),
          motionX: motion.x,
          motionY: motion.y,
          shape: { center: { x: cx, y: cy }, u: { x: ux, y: uy }, v: { x: vx, y: vy } },
          window: i,
        });
      }
    }
    clipProfiles.set(profileKey, samples);
  }
  let reach = 0;
  const windows = new Map<number, number>();
  const target = world.getComponent<TransformComponent>(targetId, "Transform")!;
  const shift =
    anticipate > 0 && target.position.y < source.position.y - 18
      ? predictedVerticalShift(world, targetId, anticipate)
      : 0;
  const contacts = actorContacts(world, targetId);
  const key = `${contacts.poseKey ?? 0}:${source.scale.x}:${source.scale.y}:${source.facing}:${source.position.y - target.position.y - shift}:${baseline}:${profileKey}`;
  const cached = skeleton && rangeCache.get(skeleton);
  if (cached?.clip === clip && cached.target === targetId && cached.key === key)
    return cached.range;
  const sx = Math.abs(source.scale.x) * source.facing,
    sy = source.scale.y;
  for (let bodyIndex = 0; bodyIndex < contacts.bodies.length; bodyIndex++) {
    // Arms can be hit, but their guard/carry pose is too transient to set an
    // attack's engagement distance. Position to reach the supported body.
    if (/^(arm-|hand-)/.test(contacts.parts?.[bodyIndex] ?? "")) continue;
    const body = contacts.bodies[bodyIndex];
    for (const sample of samples) {
      const s = sample.shape,
        a: HitboxShape = {
          center: {
            x: source.position.x + s.center.x * sx + sample.motionX * source.facing,
            y: source.position.y + s.center.y * sy + sample.motionY,
          },
          u: { x: s.u.x * sx, y: s.u.y * sy },
          v: { x: s.v.x * sx, y: s.v.y * sy },
        };
      let low = 0,
        high = baseline + 10;
      // SAT yields the whole horizontal interval in which these two posed
      // rectangles intersect. A diagonal blade cannot reach via empty corners.
      for (const edge of [a.u, a.v, body.u, body.v]) {
        const nx = -edge.y,
          ny = edge.x,
          coefficient = source.facing * nx;
        const radius =
          Math.abs(a.u.x * nx + a.u.y * ny) +
          Math.abs(a.v.x * nx + a.v.y * ny) +
          Math.abs(body.u.x * nx + body.u.y * ny) +
          Math.abs(body.v.x * nx + body.v.y * ny);
        const offset =
          (body.center.x - target.position.x - (a.center.x - source.position.x)) * nx +
          (body.center.y + shift - a.center.y) * ny;
        if (Math.abs(coefficient) < 1e-6) {
          if (Math.abs(offset) > radius) {
            high = -1;
            break;
          }
        } else {
          const x = (-radius - offset) / coefficient,
            y = (radius - offset) / coefficient;
          low = Math.max(low, Math.min(x, y));
          high = Math.min(high, Math.max(x, y));
        }
      }
      if (high >= low)
        windows.set(sample.window, Math.max(windows.get(sample.window) ?? 0, high - 2));
    }
  }
  if (windows.size) reach = Math.min(...windows.values());
  // Zero means the authored damage windows cannot reach this posed body.
  // Missing assets still use the compatibility baseline above; a real sampled
  // miss must not silently become a viable nominal-range attack.
  const range = Math.max(0, Math.min(baseline, reach));
  if (skeleton) rangeCache.set(skeleton, { clip, target: targetId, key, range });
  return range;
}

export function facingAttacker(
  defender: TransformComponent,
  attacker: TransformComponent,
): boolean {
  const dx = attacker.position.x - defender.position.x;
  const dy = attacker.position.y - defender.position.y;
  return dx * defender.facing >= -1 && dx * defender.facing >= Math.abs(dy) * 0.25;
}

const attackNames: Record<string, string[]> = {
  hollow: ["hollow_light_attack_mid", "hollow_light_attack_low"],
  soldier: [
    "soldier_light_attack_high",
    "soldier_light_attack_mid",
    "soldier_light_attack_low",
    "soldier_light_attack_thrust",
  ],
  brute: ["brute_heavy_attack_high", "brute_heavy_attack_mid", "brute_heavy_attack_sweep"],
  boss: [
    "boss_heavy_attack_high",
    "boss_heavy_attack_mid",
    "boss_heavy_attack_thrust",
    "boss_heavy_attack_low",
  ],
};

export function ordinaryAttackNames(world: World, sourceId: number): string[] {
  const type = world.getComponent<EnemyTagComponent>(sourceId, "EnemyTag")?.enemyType ?? "hollow";
  const heavy = world.getComponent<AIControllerComponent>(sourceId, "AIController")?.behaviorParams
    .hyperArmor
    ? "heavy"
    : "light";
  return (
    attackNames[type] ?? ["high", "mid", "low"].map((zone) => `${type}_${heavy}_attack_${zone}`)
  );
}

function damageBounds(world: World, id: number): AABB {
  return { ...actorContacts(world, id).bounds };
}

function predictedVerticalShift(world: World, targetId: number, anticipate: number): number {
  const target = world.getComponent<TransformComponent>(targetId, "Transform")!,
    physics = world.getComponent<PhysicsComponent>(targetId, "Physics");
  if (!physics || physics.grounded) return 0;
  const t = Math.min(0.55, anticipate / 1000);
  let dy = physics.velocity.y * t + (GRAVITY * t * t) / 2;
  if (dy > 0)
    for (const {
      components: [p, tr, c],
    } of world.query("Platform", "Transform", "Collider")) {
      const platform = p as PlatformComponent,
        transform = tr as TransformComponent,
        box = (c as ColliderComponent).hurtboxes[0];
      if (!box || platform.collidable === false || !["solid", "semisolid"].includes(platform.type))
        continue;
      const x = transform.position.x + box.x * Math.abs(transform.scale.x),
        y = transform.position.y + box.y * transform.scale.y;
      if (
        target.position.x >= x &&
        target.position.x <= x + box.width * Math.abs(transform.scale.x) &&
        y >= target.position.y
      )
        dy = Math.min(dy, y - target.position.y);
    }
  return dy;
}

export function animationCanReach(
  world: World,
  sourceId: number,
  targetId: number,
  name: string,
  anticipate = 0,
  faceTarget = false,
  ignoreHorizontal = false,
): boolean {
  const source = world.getComponent<TransformComponent>(sourceId, "Transform")!,
    target = world.getComponent<TransformComponent>(targetId, "Transform")!;
  const clip = AssetLoader.getAnimation(name, {
    skin: world.getComponent<EnemyTagComponent>(sourceId, "EnemyTag")?.enemyType ?? "player",
    weapon: world.getComponent<InventoryComponent>(sourceId, "Inventory")?.currentWeapon,
  });
  if (!clip) return false;
  const profileKey = reachProfileKey(world, sourceId);
  if (!reachProfiles.get(clip)?.has(profileKey))
    animationAttackRange(world, sourceId, targetId, name); // Populate once, not once per defensive query.
  const samples = reachProfiles.get(clip)?.get(profileKey);
  if (!samples?.length) return false;
  const body = damageBounds(world, targetId),
    physics = world.getComponent<PhysicsComponent>(targetId, "Physics");
  if (
    anticipate > 0 &&
    physics &&
    !physics.grounded &&
    target.position.y < source.position.y - 18
  ) {
    // Anticipate a visible ballistic landing, never steering a committed swing.
    body.y += predictedVerticalShift(world, targetId, anticipate);
  }
  const facing = faceTarget
    ? Math.sign(target.position.x - source.position.x) || source.facing
    : source.facing;
  const left = facing === 1 ? body.x - source.position.x : source.position.x - body.x - body.width;
  const sx = Math.abs(source.scale.x),
    sy = source.scale.y;
  const minX = Math.min(source.position.x, target.position.x);
  const corridorW = Math.max(1, Math.abs(source.position.x - target.position.x));
  const maxFloorY = source.position.y - 2;
  let blockedWindow = -1;
  for (const s of samples) {
    if (s.window === blockedWindow) continue;
    const x0 = s.left * sx + s.motionX,
      x1 = s.right * sx + s.motionX;
    const y0 = source.position.y + s.top * sy + s.motionY,
      y1 = source.position.y + s.bottom * sy + s.motionY;
    const ray = {
      x: minX,
      y: y0,
      width: corridorW,
      height: Math.max(1, y1 - y0),
    };
    if (isSolidTerrainBlocking(world, ray, maxFloorY)) {
      blockedWindow = s.window;
      continue;
    }
    if (
      (!ignoreHorizontal && (x0 > left + body.width || x1 < left)) ||
      y0 > body.y + body.height ||
      y1 < body.y
    )
      continue;
    return true;
  }
  return false;
}

export function isSolidTerrainBlocking(world: World, probe: AABB, maxTopY = Infinity): boolean {
  const blocked = (
    platform: PlatformComponent,
    transform: TransformComponent,
    collider: ColliderComponent,
  ) => {
    if (platform.type !== "solid" || platform.collidable === false) return false;
    const box = collider.hurtboxes[0];
    if (!box) return false;
    const y = transform.position.y + box.y * transform.scale.y;
    if (y >= maxTopY) return false;
    return aabbIntersects(probe, {
      x: transform.position.x + box.x * Math.abs(transform.scale.x),
      y,
      width: box.width * Math.abs(transform.scale.x),
      height: box.height * transform.scale.y,
    });
  };
  const grids = world.getResource<SpatialGridState>(SpatialGridState);
  if (grids && !grids.needsStaticRebuild) {
    for (const id of grids.staticGrid.query(probe, terrainCandidates)) {
      const platform = world.getComponent<PlatformComponent>(id, "Platform");
      const transform = world.getComponent<TransformComponent>(id, "Transform");
      const collider = world.getComponent<ColliderComponent>(id, "Collider");
      if (platform && transform && collider && blocked(platform, transform, collider)) return true;
    }
    return false;
  }
  // AI can run before the first collision update, or in a standalone test world.
  return world
    .query("Platform", "Transform", "Collider")
    .some(({ components: [p, t, c] }) =>
      blocked(p as PlatformComponent, t as TransformComponent, c as ColliderComponent),
    );
}

// The director and the strategy must agree about whether an attack can reach.
export function canAttackTarget(
  world: World,
  source: TransformComponent,
  target: TransformComponent,
  sourceId?: EntityId,
  targetId?: EntityId,
) {
  const tag =
    sourceId === undefined
      ? undefined
      : world.getComponent<EnemyTagComponent>(sourceId, "EnemyTag");
  const ai =
    sourceId === undefined
      ? undefined
      : world.getComponent<AIControllerComponent>(sourceId, "AIController");
  const victim = targetId ?? ai?.target;
  if (
    sourceId !== undefined &&
    victim !== undefined &&
    victim !== null &&
    world.hasComponent(victim, "Collider")
  ) {
    const names = ai?.pendingAttack
      ? [ai.pendingAttack.animation]
      : ordinaryAttackNames(world, sourceId);
    const physics = world.getComponent<PhysicsComponent>(victim, "Physics");
    return names.some((name) =>
      animationCanReach(
        world,
        sourceId,
        victim,
        name,
        physics && !physics.grounded
          ? (AssetLoader.getAnimation(name)?.windupMs ??
              ((ai?.behaviorParams.windupFrames ?? 24) * 1000) / 60)
          : 0,
        true,
        true,
      ),
    );
  }
  if (Math.abs(target.position.y - source.position.y) >= 40) return false;
  const height =
    tag && isQuadruped(tag.enemyType)
      ? Math.min(
          40,
          (world.getComponent<ColliderComponent>(sourceId!, "Collider")?.standingHeight ?? 50) *
            source.scale.y *
            0.45,
        )
      : 40;
  const probe = {
    x: Math.min(source.position.x, target.position.x),
    y: Math.min(source.position.y, target.position.y) - height,
    width: Math.max(1, Math.abs(target.position.x - source.position.x)),
    height: 8,
  };
  return !isSolidTerrainBlocking(world, probe);
}

// React to a swing that can threaten this actor, rather than every attack
// performed by its target (which may be fighting somebody else).
export function getIncomingAttack(
  world: World,
  defender: TransformComponent,
  attackerId: EntityId,
  defenderId?: EntityId,
) {
  const attacker = world.getComponent<TransformComponent>(attackerId, "Transform");
  const combat = world.getComponent<CombatComponent>(attackerId, "Combat");
  if (!attacker || !combat || (combat.attackState !== "windup" && combat.attackState !== "active"))
    return;
  const dx = defender.position.x - attacker.position.x;
  const ai = world.getComponent<AIControllerComponent>(attackerId, "AIController");
  const weapon =
    world.getComponent<InventoryComponent>(attackerId, "Inventory")?.currentWeapon ?? "longsword";
  // Weapon reach is measured from the hand; allow for the arm and an approach margin.
  const range =
    ai && defenderId !== undefined
      ? attackRange(world, attackerId, defenderId)
      : (ai?.behaviorParams.attackRange ?? (WEAPONS[weapon]?.reach ?? 28) + 20);
  if (dx * attacker.facing < 0 || Math.abs(dx) > range + 20) return;
  const animation = world.getComponent<AnimatorComponent>(attackerId, "Animator")?.currentAnim;
  const clip = animation ? AssetLoader.getAnimation(animation) : undefined;
  if (defenderId !== undefined && clip?.events?.some((e) => e.type === "hitbox-start")) {
    if (
      !animationCanReach(
        world,
        attackerId,
        defenderId,
        animation!,
        Math.min(120, combat.attackTimer),
      )
    )
      return;
  } else if (!canAttackTarget(world, attacker, defender, attackerId, defenderId)) return;
  const hitbox = world.getComponent<ActiveHitboxComponent>(attackerId, "ActiveHitbox");
  if (defenderId !== undefined && hitbox?.alreadyHit.has(defenderId)) return;
  return {
    attackerId,
    attacker,
    combat,
    zone: hitbox?.zone ?? combat.attackZone,
    timeToImpact: combat.attackState === "windup" ? combat.attackTimer : 0,
  };
}

// Defensive attention is independent of the NPC's assigned pursuit target.
export function nearbyThreat(world: World, defenderId: EntityId) {
  const defender = world.getComponent<TransformComponent>(defenderId, "Transform")!;
  const team = world.getComponent<FactionComponent>(defenderId, "Faction")?.team;
  let best: ReturnType<typeof getIncomingAttack>;
  for (const {
    id,
    components: [f, h],
  } of world.query("Faction", "Health", "Combat", "Transform")) {
    const faction = f as FactionComponent,
      health = h as HealthComponent;
    if (id === defenderId || faction.team === team || health.isDead || health.current <= 0)
      continue;
    const threat = getIncomingAttack(world, defender, id, defenderId);
    if (
      threat &&
      (!best ||
        threat.timeToImpact < best.timeToImpact ||
        (threat.timeToImpact === best.timeToImpact &&
          Math.abs(threat.attacker.position.x - defender.position.x) <
            Math.abs(best.attacker.position.x - defender.position.x)))
    )
      best = threat;
  }
  return best;
}
