import { World, EntityId } from "../../core/World";
import { HealthComponent } from "../../components/Health";
import { CombatComponent } from "./CombatComponent";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { beginAnimation } from "../animation/AnimationTransition";
import { PlayerInputComponent } from "../../components/PlayerInput";
import { AIControllerComponent } from "../ai/AIControllerComponent";
import { SoundRequestComponent } from "../../components/SoundRequest";
import { TimeState } from "../../core/Resources";

// Shared by melee and hazards so zero health always enters the same death state.
export function applyHealthDamage(world: World, id: EntityId, damage: number): void {
  const health = world.getComponent<HealthComponent>(id, "Health");
  if (!health || health.isDead) return;
  health.current = Math.max(0, health.current - Math.max(0, damage));
  const ai = world.getComponent<AIControllerComponent>(id, "AIController");
  if (damage > 0 && ai) ai.lastDamageTime = world.getResource<TimeState>(TimeState).elapsed;
  if (health.current > 0) return;
  health.isDead = true;
  world.removeComponent(id, "ActiveHitbox");
  const combat = world.getComponent<CombatComponent>(id, "Combat");
  if (combat) {
    combat.attackState = "idle";
    combat.attackTimer = 0;
    combat.isBlocking = false;
    combat.attackTiming = undefined;
    combat.animationDelta = undefined;
  }
  const animator = world.getComponent<AnimatorComponent>(id, "Animator");
  if (animator) {
    beginAnimation(animator, "death");
    animator.eventState.clear();
  }
  const input = world.getComponent<PlayerInputComponent>(id, "PlayerInput");
  if (input) input.buffer = null;
  let sound = world.getComponent<SoundRequestComponent>(id, "SoundRequest");
  if (!sound) world.addComponent(id, "SoundRequest", (sound = { requests: [] }));
  sound.requests.push({ id: "enemy-death" });
}
