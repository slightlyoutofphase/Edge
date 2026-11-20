import { World } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { InventoryComponent } from "../../components/Inventory";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { CombatComponent } from "./CombatComponent";
import { WEAPONS } from "../../data/WeaponDefinitions";
import { HitEvent } from "./HitEvent";

const inertia: Record<string, number> = {
  player: 1,
  hollow: 0.95,
  rogue: 0.85,
  duelist: 1,
  soldier: 1.15,
  brute: 1.9,
  boss: 1.55,
  hellhound: 2,
  alpha_hellhound: 2,
};
const naturalWeapons: Record<string, number> = {
  hollow: 0.85,
  soldier: 1,
  duelist: 0.71,
  rogue: 0.55,
  brute: 1.5,
  boss: 1.6,
  hellhound: 1.1,
  alpha_hellhound: 1.1,
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function actorSize(world: World, id: number): number {
  const t = world.getComponent<TransformComponent>(id, "Transform");
  return t ? Math.sqrt(Math.abs(t.scale.x * t.scale.y)) : 1;
}

// Gameplay inertia, rather than the current hurtbox's area: crouching or
// rearing cannot change an actor's resistance to pushes. Scale is sub-quadratic
// so bosses feel heavy without making a smaller opponent unable to move them.
export function actorInertia(world: World, id: number): number {
  const skin = world.getComponent<EnemyTagComponent>(id, "EnemyTag")?.enemyType ?? "player";
  return clamp((inertia[skin] ?? 1) * actorSize(world, id) ** 1.3, 0.4, 8);
}

export function weaponImpact(world: World, id: number): number {
  const equipped =
    world.getComponent<CombatComponent>(id, "Combat")?.attackTiming?.weapon ??
    WEAPONS[world.getComponent<InventoryComponent>(id, "Inventory")?.currentWeapon ?? ""];
  const skin = world.getComponent<EnemyTagComponent>(id, "EnemyTag")?.enemyType ?? "player";
  const weight = equipped
    ? Math.sqrt(equipped.poiseDamageHeavy / WEAPONS.longsword.poiseDamageHeavy)
    : (naturalWeapons[skin] ?? 1);
  return weight * actorSize(world, id) ** 0.5;
}

export function contactDirection(
  world: World,
  attacker: number,
  target: number,
  point?: { x: number; y: number },
): number {
  const a = world.getComponent<TransformComponent>(attacker, "Transform"),
    b = world.getComponent<TransformComponent>(target, "Transform");
  const dx = a && b ? b.position.x - a.position.x : a && point ? point.x - a.position.x : 0;
  return Math.abs(dx) > 0.1 ? Math.sign(dx) : (a?.facing ?? 1);
}

export function impactVelocity(
  world: World,
  event: HitEvent,
  guard = false,
): { x: number; y: number } {
  const factor = weaponImpact(world, event.attackerId) / actorInertia(world, event.targetId);
  const heavy = event.attackType === "heavy";
  const x = event.knockback.x ?? (heavy ? 300 : 100),
    y = event.knockback.y ?? (heavy ? -150 : -50);
  return {
    x: clamp(guard ? clamp(Math.abs(x) * 0.5, 60, 170) * factor : Math.abs(x) * factor, 0, 450),
    y: guard ? 0 : clamp(y * factor, -220, 220),
  };
}

export function recoilVelocity(
  world: World,
  attacker: number,
  defender: number,
  base: number,
): number {
  const resistance = actorInertia(world, defender) * weaponImpact(world, defender);
  const commitment = actorInertia(world, attacker) * weaponImpact(world, attacker);
  return base * clamp(Math.sqrt(resistance / commitment), 0.35, 1.5);
}

// Do not accumulate launch speed across repeated contacts or erase a jump/fall
// when a strike explicitly requests zero vertical force. A grounded heavy actor
// braces against a very small lift instead of floating for a single frame.
export function applyImpactVelocity(
  physics: PhysicsComponent | undefined,
  x: number,
  y = 0,
  controlMs = 100,
): void {
  if (!physics) return;
  if (x !== 0) {
    physics.velocity.x =
      Math.sign(x) === Math.sign(physics.velocity.x)
        ? Math.sign(x) * Math.max(Math.abs(x), Math.abs(physics.velocity.x))
        : physics.velocity.x + x;
    physics.impactControlMs = Math.max(physics.impactControlMs ?? 0, controlMs);
  }
  if (y !== 0 && !(physics.grounded && (y > 0 || y > -45))) {
    physics.velocity.y =
      Math.sign(y) === Math.sign(physics.velocity.y)
        ? Math.sign(y) * Math.max(Math.abs(y), Math.abs(physics.velocity.y))
        : physics.velocity.y + y;
    physics.grounded = false;
  }
}
