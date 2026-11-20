import { World } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { ColliderComponent } from "../../components/Collider";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { InventoryComponent } from "../../components/Inventory";
import { SkeletonComponent } from "../animation/SkeletonComponent";
import { CombatComponent } from "./CombatComponent";
import { PlayerBonePaths } from "../../assets/svg/PlayerSVG";
import { EnemyBonePaths } from "../../assets/svg/EnemySVGs";
import { WeaponPaths } from "../../assets/svg/WeaponSVGs";
import { WEAPONS } from "../../data/WeaponDefinitions";
import { isQuadruped } from "../../data/EnemyTypes";
import { SpriteCache } from "../../utils/SpriteCache";
import { AABB } from "../../utils/AABB";
import { Matrix2D } from "../../utils/Matrix2D";
import type { HitboxShape } from "./HitboxGeometry";
import { AssetLoader } from "../../assets/AssetLoader";
import { poseMatrices, plantFeet } from "../../animation/data/PoseAuthoring";
import { plantQuadrupedFeet } from "../../animation/data/QuadrupedPose";

export interface ActorContacts {
  bodies: HitboxShape[];
  parts?: string[];
  bounds: AABB;
  weapon?: HitboxShape;
  previousWeapon?: HitboxShape;
  poseKey?: number;
  origin?: { x: number; y: number; sx: number; sy: number; facing: number };
}
const cache = new WeakMap<SkeletonComponent, ActorContacts>();
const pathBounds = new Map<string, Map<number, AABB>>();
const humanoidParts = [
  "head",
  "torso",
  ...["front", "back"].flatMap((side) => [
    `leg-${side}-upper`,
    `leg-${side}-lower`,
    `foot-${side}`,
  ]),
  ...["front", "back"].flatMap((side) => [
    `arm-${side}-upper`,
    `arm-${side}-lower`,
    `hand-${side}`,
  ]),
];
const quadrupedParts = [
  "head",
  "jaw",
  "neck",
  "chest",
  "torso",
  "pelvis",
  ...["fore-near", "fore-far", "hind-near", "hind-far"].flatMap((leg) => [
    `${leg}-upper`,
    `${leg}-lower`,
    `${leg}-paw`,
  ]),
];

export function matrixShape(m: Matrix2D, box: AABB, out?: HitboxShape): HitboxShape {
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  const shape = out ?? { center: { x: 0, y: 0 }, u: { x: 0, y: 0 }, v: { x: 0, y: 0 } };
  shape.center.x = m.a * x + m.c * y + m.tx;
  shape.center.y = m.b * x + m.d * y + m.ty;
  shape.u.x = (m.a * box.width) / 2;
  shape.u.y = (m.b * box.width) / 2;
  shape.v.x = (m.c * box.height) / 2;
  shape.v.y = (m.d * box.height) / 2;
  return shape;
}

// Sprite bounds include four units of raster padding. Damage geometry uses
// the artwork itself plus a small forgiving margin, never that raster border.
export function drawingBounds(path: string, margin = 0.75): AABB {
  let margins = pathBounds.get(path);
  if (!margins) {
    margins = new Map();
    pathBounds.set(path, margins);
  }
  const cached = margins.get(margin);
  if (cached) return cached;
  const box = SpriteCache.getBounds(path);
  const value = {
    x: box.x + 4 - margin,
    y: box.y + 4 - margin,
    width: Math.max(1, box.width - 8 + margin * 2),
    height: Math.max(1, box.height - 8 + margin * 2),
  };
  margins.set(margin, value);
  return value;
}

export function actorWeaponPath(world: World, id: number): string | undefined {
  const skin = world.getComponent<EnemyTagComponent>(id, "EnemyTag")?.enemyType;
  const inventory = world.getComponent<InventoryComponent>(id, "Inventory");
  return inventory
    ? WeaponPaths[WEAPONS[inventory.currentWeapon]?.svgAsset]?.path
    : (skin ? EnemyBonePaths[skin] : PlayerBonePaths)?.weapon?.path;
}

// Runs once after forward kinematics. Queries reuse these few simple shapes;
// locomotion, platform collision and navigation retain their existing collider.
export function updateActorContacts(world: World, id: number): void {
  const skeleton = world.getComponent<SkeletonComponent>(id, "Skeleton");
  if (!skeleton) return;
  const skin = world.getComponent<EnemyTagComponent>(id, "EnemyTag")?.enemyType ?? "player";
  const drawings = skin === "player" ? PlayerBonePaths : EnemyBonePaths[skin];
  if (!drawings) return;
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  let transforms = skeleton.worldTransforms;
  if (!transforms.size) {
    const definition = skeleton.definition ?? AssetLoader.getSkeleton(skeleton.definitionId);
    if (!definition) return;
    const root = new Matrix2D()
      .translate(transform.position.x, transform.position.y)
      .scale(transform.facing * transform.scale.x, transform.scale.y);
    const idle = AssetLoader.getAnimation("idle", {
      skin,
      weapon: world.getComponent<InventoryComponent>(id, "Inventory")?.currentWeapon,
    });
    const pose = Object.keys(skeleton.currentPose).length
      ? skeleton.currentPose
      : structuredClone(idle?.keyframes[0]?.bones ?? {});
    if (!Object.keys(skeleton.currentPose).length && idle?.grounded) {
      if (isQuadruped(skin)) plantQuadrupedFeet(pose, 0);
      else plantFeet(pose, 0);
    }
    transforms = new Map(
      [...poseMatrices(pose, definition)].map(([bone, m]) => [bone, root.clone().multiply(m)]),
    );
  }
  const previous = cache.get(skeleton);
  const contacts: ActorContacts = previous ?? {
    bodies: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  };
  const bodies = contacts.bodies;
  const parts = (contacts.parts ??= []);
  const oldWeapon = contacts.weapon;
  if (oldWeapon) {
    const old = contacts.origin,
      valid =
        old &&
        old.facing === transform.facing &&
        Math.hypot(old.x - transform.position.x, old.y - transform.position.y) <= 128;
    if (valid) {
      const snapshot = contacts.previousWeapon ?? {
        center: { x: 0, y: 0 },
        u: { x: 0, y: 0 },
        v: { x: 0, y: 0 },
      };
      Object.assign(snapshot.center, oldWeapon.center);
      Object.assign(snapshot.u, oldWeapon.u);
      Object.assign(snapshot.v, oldWeapon.v);
      contacts.previousWeapon = snapshot;
    } else contacts.previousWeapon = undefined;
  }
  let count = 0,
    x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity,
    hash = 2166136261;
  for (const bone of isQuadruped(skin) ? quadrupedParts : humanoidParts) {
    const m = transforms.get(bone),
      art = drawings[bone];
    if (m && art) {
      const body = (bodies[count] = matrixShape(m, drawingBounds(art.path), bodies[count]));
      parts[count] = bone;
      count++;
      const ex = Math.abs(body.u.x) + Math.abs(body.v.x),
        ey = Math.abs(body.u.y) + Math.abs(body.v.y);
      x = Math.min(x, body.center.x - ex);
      y = Math.min(y, body.center.y - ey);
      right = Math.max(right, body.center.x + ex);
      bottom = Math.max(bottom, body.center.y + ey);
      for (const value of [
        body.center.x - transform.position.x,
        body.center.y - transform.position.y,
        body.u.x,
        body.u.y,
        body.v.x,
        body.v.y,
      ])
        hash = Math.imul(hash ^ Math.round(value * 2), 16777619);
    }
  }
  bodies.length = count;
  parts.length = count;
  if (!count) {
    cache.delete(skeleton);
    return;
  }
  Object.assign(contacts.bounds, { x, y, width: right - x, height: bottom - y });
  contacts.poseKey = hash;
  contacts.origin ??= { x: 0, y: 0, sx: 1, sy: 1, facing: 1 };
  Object.assign(contacts.origin, {
    x: transform.position.x,
    y: transform.position.y,
    sx: transform.scale.x,
    sy: transform.scale.y,
    facing: transform.facing,
  });
  const m = transforms.get("weapon"),
    path = actorWeaponPath(world, id);
  if (m && path) {
    contacts.weapon = matrixShape(m, drawingBounds(path, 1.5), contacts.weapon);
  } else {
    contacts.weapon = undefined;
    contacts.previousWeapon = undefined;
  }
  cache.set(skeleton, contacts);
}

export function actorContacts(world: World, id: number): ActorContacts {
  const skeleton = world.getComponent<SkeletonComponent>(id, "Skeleton");
  if (skeleton && !cache.has(skeleton)) updateActorContacts(world, id);
  const cached = skeleton && cache.get(skeleton);
  if (cached) {
    const t = world.getComponent<TransformComponent>(id, "Transform")!,
      origin = cached.origin;
    if (
      !origin ||
      (t.position.x === origin.x &&
        t.position.y === origin.y &&
        t.scale.x === origin.sx &&
        t.scale.y === origin.sy &&
        t.facing === origin.facing)
    )
      return cached;
    const sx = (t.scale.x * t.facing) / (origin.sx * origin.facing),
      sy = t.scale.y / origin.sy;
    const project = (shape: HitboxShape): HitboxShape => ({
      center: {
        x: t.position.x + (shape.center.x - origin.x) * sx,
        y: t.position.y + (shape.center.y - origin.y) * sy,
      },
      u: { x: shape.u.x * sx, y: shape.u.y * sy },
      v: { x: shape.v.x * sx, y: shape.v.y * sy },
    });
    const x0 = t.position.x + (cached.bounds.x - origin.x) * sx,
      x1 = x0 + cached.bounds.width * sx;
    return {
      ...cached,
      bodies: cached.bodies.map(project),
      weapon: cached.weapon && project(cached.weapon),
      previousWeapon: undefined,
      bounds: {
        x: Math.min(x0, x1),
        y: t.position.y + (cached.bounds.y - origin.y) * sy,
        width: Math.abs(cached.bounds.width * sx),
        height: cached.bounds.height * sy,
      },
      poseKey: (cached.poseKey ?? 0) ^ Math.round(sx * 1000) ^ Math.round(sy * 1000),
    };
  }
  const t = world.getComponent<TransformComponent>(id, "Transform")!;
  const boxes = world.getComponent<ColliderComponent>(id, "Collider")!.hurtboxes.map((b) => ({
    x: t.position.x + b.x * Math.abs(t.scale.x),
    y: t.position.y + b.y * t.scale.y,
    width: b.width * Math.abs(t.scale.x),
    height: b.height * t.scale.y,
  }));
  const b = boxes[0] ?? { x: t.position.x, y: t.position.y, width: 1, height: 1 };
  return {
    bounds: b,
    bodies: boxes.map((b) => ({
      center: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      u: { x: b.width / 2, y: 0 },
      v: { x: 0, y: b.height / 2 },
    })),
  };
}

export function defensiveWeapon(world: World, id: number): HitboxShape | undefined {
  const combat = world.getComponent<CombatComponent>(id, "Combat");
  if (
    !combat ||
    (!combat.isBlocking && combat.attackState !== "parry") ||
    combat.attackState === "stagger"
  )
    return;
  return actorContacts(world, id).weapon;
}
