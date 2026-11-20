import type { Animation } from "../animation/AnimationTypes";
import type { AttackTiming } from "./CombatComponent";
import type { WeaponDef } from "../../data/WeaponDefinitions";
import { GRAVITY } from "../../core/Constants";

// The viewer displays the physical path as well as the local animation pose.
// Gameplay integrates velocity through PhysicsSystem and resolves collisions.
export function attackMotionOffset(animation: Animation, time: number) {
  const motion = animation.motion;
  if (!motion) return { x: 0, y: 0 };
  const elapsed = Math.max(0, (time - motion.start * animation.duration) / 1000);
  const driven = Math.min(elapsed, ((motion.end - motion.start) * animation.duration) / 1000);
  return {
    x: driven * motion.speed,
    y: motion.lift ? Math.min(0, -motion.lift * elapsed + (GRAVITY * elapsed * elapsed) / 2) : 0,
  };
}

// Shared by combat and its preview, so the viewer uses the actual phase mapping.
export function createAttackTiming(
  animation: Animation,
  windup: number,
  attackType: string | null,
  heavy: boolean,
  weapon?: WeaponDef,
): AttackTiming | undefined {
  const starts = animation.events?.filter((event) => event.type === "hitbox-start") ?? [];
  const ends = animation.events?.filter((event) => event.type === "hitbox-end") ?? [];
  if (!starts.length || !ends.length) return undefined;
  const hitStart = Math.min(...starts.map((event) => event.time)) * animation.duration;
  const hitEnd = Math.max(...ends.map((event) => event.time)) * animation.duration;
  const timing = heavy ? weapon?.heavyAttack : weapon?.lightAttack;
  return {
    animation: animation.name,
    elapsed: 0,
    windup: Math.max(1, windup),
    active: Math.max(
      1,
      attackType === "slide"
        ? (4 / 60) * 1000
        : timing
          ? (timing.active / 60) * 1000
          : hitEnd - hitStart,
    ),
    recovery: Math.max(
      1,
      attackType === "slide"
        ? (14 / 60) * 1000
        : timing
          ? (timing.recovery / 60) * 1000
          : animation.duration - hitEnd,
    ),
    hitStart,
    hitEnd,
    duration: animation.duration,
    phase: "windup",
    weapon: weapon
      ? {
          ...weapon,
          lightAttack: { ...weapon.lightAttack },
          heavyAttack: { ...weapon.heavyAttack },
        }
      : undefined,
    baseHitDamage: starts[0].data?.damage || 1,
  };
}

export function sampleAttackTiming(attack: AttackTiming, elapsed: number) {
  elapsed = Math.max(0, Math.min(attack.windup + attack.active + attack.recovery, elapsed));
  if (elapsed < attack.windup)
    return {
      phase: "windup" as const,
      remaining: attack.windup - elapsed,
      time: (attack.hitStart * elapsed) / attack.windup,
    };
  if (elapsed < attack.windup + attack.active)
    return {
      phase: "active" as const,
      remaining: attack.windup + attack.active - elapsed,
      time:
        attack.hitStart +
        ((attack.hitEnd - attack.hitStart) * (elapsed - attack.windup)) / attack.active,
    };
  return {
    phase: "recovery" as const,
    remaining: attack.windup + attack.active + attack.recovery - elapsed,
    time:
      attack.hitEnd +
      ((attack.duration - attack.hitEnd) * (elapsed - attack.windup - attack.active)) /
        attack.recovery,
  };
}

export function attackElapsedAtClipTime(attack: AttackTiming, time: number) {
  time = Math.max(0, Math.min(attack.duration, time));
  if (time <= attack.hitStart)
    return attack.hitStart > 0 ? (time / attack.hitStart) * attack.windup : 0;
  if (time <= attack.hitEnd)
    return (
      attack.windup + ((time - attack.hitStart) / (attack.hitEnd - attack.hitStart)) * attack.active
    );
  return (
    attack.windup +
    attack.active +
    ((time - attack.hitEnd) / Math.max(1, attack.duration - attack.hitEnd)) * attack.recovery
  );
}
