import { AIControllerComponent } from "./AIControllerComponent";
import { getIncomingAttack, actorBounds, isSolidTerrainBlocking } from "./CombatReach";
import { World } from "../../core/World";
import { CombatComponent } from "../combat/CombatComponent";
import { TimeState } from "../../core/Resources";
import { PlatformComponent } from "../../components/Platform";
import { HealthComponent } from "../../components/Health";
import { aabbIntersects } from "../../utils/AABB";

type Reaction = {
  serial: number;
  timing: object | undefined;
  firstSeen: number;
  delay: number;
  dodgeDecided: boolean;
  parryDecided: boolean;
};
const reactions = new WeakMap<AIControllerComponent, Map<CombatComponent, Reaction>>();

export function reactionFor(
  world: World,
  ai: AIControllerComponent,
  threat: NonNullable<ReturnType<typeof getIncomingAttack>>,
) {
  let records = reactions.get(ai);
  if (!records) {
    records = new Map();
    reactions.set(ai, records);
  }
  for (const [combat] of records)
    if (combat.attackState !== "windup" && combat.attackState !== "active") records.delete(combat);
  let reaction = records.get(threat.combat);
  const serial = threat.combat.attackSerial ?? 0;
  if (
    !reaction ||
    reaction.serial !== serial ||
    (threat.combat.attackSerial === undefined &&
      reaction.timing !== undefined &&
      reaction.timing !== threat.combat.attackTiming)
  ) {
    if (records.size >= 16) records.delete(records.keys().next().value!);
    reaction = {
      serial,
      timing: threat.combat.attackTiming,
      firstSeen: world.getResource<TimeState>(TimeState).elapsed,
      delay: 60 + Math.random() * 40,
      dodgeDecided: false,
      parryDecided: false,
    };
    records.set(threat.combat, reaction);
  }
  reaction.timing = threat.combat.attackTiming;
  return {
    reaction,
    ready: world.getResource<TimeState>(TimeState).elapsed - reaction.firstSeen >= reaction.delay,
  };
}

export function evasionClear(
  world: World,
  id: number,
  direction: number,
  distance: number,
): boolean {
  const body = actorBounds(world, id);
  if (!body) return false;
  const probe = {
    x: body.x + Math.min(0, direction * distance),
    y: body.y + 2,
    width: body.width + distance,
    height: Math.max(1, body.height - 4),
  };
  if (isSolidTerrainBlocking(world, probe)) return false;
  for (const {
    id: other,
    components: [health],
  } of world.query("Health", "Collider", "Transform")) {
    const h = health as HealthComponent,
      otherBody = actorBounds(world, other);
    if (
      other !== id &&
      !h.isDead &&
      h.current > 0 &&
      otherBody &&
      aabbIntersects(probe, otherBody) &&
      !aabbIntersects(body, otherBody)
    )
      return false;
  }
  const landing = { ...body, x: body.x + direction * distance };
  return world
    .query("Platform", "Collider", "Transform")
    .some(({ id: platformId, components: [p] }) => {
      const platform = p as PlatformComponent,
        ground = actorBounds(world, platformId);
      return (
        platform.collidable !== false &&
        (platform.type === "solid" || platform.type === "semisolid") &&
        !!ground &&
        landing.x >= ground.x &&
        landing.x + landing.width <= ground.x + ground.width &&
        ground.y >= landing.y + landing.height - 4 &&
        ground.y <= landing.y + landing.height + 8
      );
    });
}
