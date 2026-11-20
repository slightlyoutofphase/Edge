import { World } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { PlatformComponent } from "../../components/Platform";
import { ColliderComponent } from "../../components/Collider";
import { HealthComponent } from "../../components/Health";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { AIControllerComponent } from "./AIControllerComponent";
import { GRAVITY, PLAYER_STATS } from "../../core/Constants";
import { isSolidTerrainBlocking } from "./CombatReach";
import { bodySeparationBounds } from "../combat/BodySeparation";
import { aabbIntersects } from "../../utils/AABB";
import { Vec2 } from "../../utils/Vec2";
import { FactionComponent } from "../../components/Faction";
import { CombatComponent } from "../combat/CombatComponent";

export function flankLanding(
  world: World,
  id: number,
  targetId: number,
  jumpSpeed: number,
): Vec2 | undefined {
  if (!world.hasComponent(id, "Collider") || !world.hasComponent(targetId, "Collider")) return;
  const body = bodySeparationBounds(world, id),
    target = bodySeparationBounds(world, targetId);
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  const targetTransform = world.getComponent<TransformComponent>(targetId, "Transform")!;
  const physics = world.getComponent<PhysicsComponent>(id, "Physics")!;
  if (!body || !target || Math.abs(transform.position.y - targetTransform.position.y) > 40) return;
  const dir = Math.sign(targetTransform.position.x - transform.position.x) || transform.facing;
  // Use the same facing-aware body clearance as actor collision, including a
  // large animal's muzzle. Movement boxes alone understate the landing space.
  const x =
    dir > 0
      ? target.x + target.width + 12 - (body.x - transform.position.x)
      : target.x - 12 - (body.x + body.width - transform.position.x);
  const left = x + body.x - transform.position.x;
  let ground = Infinity;
  for (const {
    components: [p, t, c],
  } of world.query("Platform", "Transform", "Collider")) {
    const platform = p as PlatformComponent,
      tform = t as TransformComponent,
      box = (c as ColliderComponent).hurtboxes[0];
    if (
      !box ||
      platform.collidable === false ||
      (platform.type !== "solid" && platform.type !== "semisolid")
    )
      continue;
    const px = tform.position.x + box.x * Math.abs(tform.scale.x),
      py = tform.position.y + box.y * tform.scale.y;
    if (
      left >= px &&
      left + body.width <= px + box.width * Math.abs(tform.scale.x) &&
      py >= transform.position.y - 4 &&
      py <= transform.position.y + 64
    )
      ground = Math.min(ground, py);
  }
  if (!Number.isFinite(ground)) return;
  const flightTime =
    (jumpSpeed + Math.sqrt(jumpSpeed * jumpSpeed + 2 * GRAVITY * (ground - transform.position.y))) /
    GRAVITY;
  const speed = PLAYER_STATS.runSpeed,
    initial = Math.max(-speed, Math.min(speed, physics.velocity.x * dir));
  const accelerationTime = Math.max(0, (speed - initial) / 2000);
  const maxTravel =
    speed * flightTime - ((speed - initial) * Math.min(flightTime, accelerationTime)) / 2;
  if (Math.abs(x - transform.position.x) > maxTravel - 6) return;
  const landing = {
    x: left,
    y: body.y + ground - transform.position.y,
    width: body.width,
    height: body.height - 0.1,
  };
  if (isSolidTerrainBlocking(world, landing)) return;
  const bodies: {
    body: typeof body;
    originX: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    airborne: boolean;
    floor: number;
    landing?: Vec2;
  }[] = [];
  for (const {
    id: other,
    components: [health],
  } of world.query("Health", "Collider", "Transform")) {
    const h = health as HealthComponent;
    if (other === id || h.isDead || h.current <= 0) continue;
    const otherBody = bodySeparationBounds(world, other);
    const t = world.getComponent<TransformComponent>(other, "Transform")!;
    const p = world.getComponent<PhysicsComponent>(other, "Physics");
    const ai = world.getComponent<AIControllerComponent>(other, "AIController");
    let floor = Infinity;
    for (const {
      components: [p, tr, c],
    } of world.query("Platform", "Transform", "Collider")) {
      const platform = p as PlatformComponent,
        pt = tr as TransformComponent,
        box = (c as ColliderComponent).hurtboxes[0];
      if (!box || platform.collidable === false || !["solid", "semisolid"].includes(platform.type))
        continue;
      const px = pt.position.x + box.x * Math.abs(pt.scale.x),
        py = pt.position.y + box.y * pt.scale.y;
      if (
        py >= t.position.y - 0.1 &&
        otherBody.x >= px &&
        otherBody.x + otherBody.width <= px + box.width * Math.abs(pt.scale.x)
      )
        floor = Math.min(floor, py);
    }
    bodies.push({
      body: otherBody,
      originX: t.position.x,
      x: t.position.x,
      y: t.position.y,
      vx: p?.velocity.x ?? 0,
      vy: p?.velocity.y ?? 0,
      airborne: !!p && !p.grounded,
      floor,
      landing: ai?.isFlanking ? ai.flankLanding : undefined,
    });
  }
  // Follow the same acceleration/braking as the airborne controller. A low
  // jump cannot clear a tall opponent merely because its landing is empty.
  // Early contact can delay the approach until the paws clear an ally.
  const steps = Math.ceil(flightTime * 60),
    dt = flightTime / steps;
  let atX = transform.position.x,
    vx = physics.velocity.x;
  for (let i = 1; i <= steps; i++) {
    const t = (flightTime * i) / steps;
    const y = transform.position.y - jumpSpeed * t + (GRAVITY * t * t) / 2;
    const remaining = x - atX;
    const desired =
      Math.sign(remaining) *
      Math.min(speed, Math.sqrt(4000 * Math.max(0, Math.abs(remaining) - 3)));
    vx += Math.sign(desired - vx) * Math.min(Math.abs(desired - vx), 2000 * dt);
    const at = {
      x: body.x + atX + vx * dt - transform.position.x,
      y: body.y + y - transform.position.y,
      width: body.width,
      height: body.height - 0.1,
    };
    if (isSolidTerrainBlocking(world, at)) return;
    for (const other of bodies) {
      let ox = other.x,
        oy = other.y;
      if (other.airborne) {
        oy = other.y + other.vy * t + (GRAVITY * t * t) / 2;
        if (other.landing) {
          // An earlier actor's committed flight is its reservation. Because
          // launch state is published immediately, opposing launches in the
          // same AI update also see one another's future crossing paths.
          const remaining = other.landing.x - other.x;
          const desired =
            Math.sign(remaining) *
            Math.min(speed, Math.sqrt(4000 * Math.max(0, Math.abs(remaining) - 3)));
          other.vx +=
            Math.sign(desired - other.vx) * Math.min(Math.abs(desired - other.vx), 2000 * dt);
          other.x += other.vx * dt;
          ox = other.x;
          if (oy >= other.landing.y && other.vy + GRAVITY * t >= 0) {
            ox = other.landing.x;
            oy = other.landing.y;
          }
        } else {
          ox += other.vx * t;
          if (other.vy + GRAVITY * t >= 0) oy = Math.min(oy, other.floor);
        }
      } else ox += other.vx * Math.min(t, 0.2);
      const obstacle = {
        ...other.body,
        x: other.body.x + ox - other.originX,
        y: other.body.y + oy - other.y,
      };
      if (aabbIntersects(at, obstacle)) {
        if (other.airborne || i === steps) return;
        at.x =
          dir > 0
            ? Math.min(at.x, obstacle.x - body.width - 0.01)
            : Math.max(at.x, obstacle.x + obstacle.width + 0.01);
        vx = 0;
      }
    }
    atX = transform.position.x + at.x - body.x;
  }
  if (Math.abs(atX - x) > 10) return;
  return { x, y: ground };
}

export function flankLandingHazard(
  world: World,
  id: number,
  _targetId: number,
  landing: Vec2,
): { enemiesNearLanding: number; activeThreatOnLanding: boolean } {
  const faction = world.getComponent<FactionComponent>(id, "Faction")?.team;
  let enemiesNearLanding = 0;
  let activeThreatOnLanding = false;
  for (const {
    id: other,
    components: [f, t, h],
  } of world.query("Faction", "Transform", "Health")) {
    const otherFaction = f as FactionComponent;
    const otherTrans = t as TransformComponent;
    const otherHealth = h as HealthComponent;
    if (
      other === id ||
      otherFaction.team === faction ||
      otherHealth.isDead ||
      otherHealth.current <= 0 ||
      Math.abs(otherTrans.position.y - landing.y) > 48
    )
      continue;
    const dist = Math.abs(otherTrans.position.x - landing.x);
    if (dist <= 95) {
      enemiesNearLanding++;
      const combat = world.getComponent<CombatComponent>(other, "Combat");
      const facingLanding =
        dist < 16 || Math.sign(landing.x - otherTrans.position.x) === otherTrans.facing;
      if (
        combat &&
        (combat.attackState === "windup" || combat.attackState === "active") &&
        facingLanding
      ) {
        activeThreatOnLanding = true;
      }
    }
  }
  return { enemiesNearLanding, activeThreatOnLanding };
}
