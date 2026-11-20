import { World, EntityId } from "../../core/World";
import { AIControllerComponent } from "./AIControllerComponent";
import { TimeState, BattleState } from "../../core/Resources";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { TransformComponent } from "../../components/Transform";
import { HealthComponent } from "../../components/Health";
import { StaminaComponent } from "../../components/Stamina";
import { MovementStateComponent } from "../movement/MovementStateComponent";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { CombatComponent } from "../combat/CombatComponent";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { FactionComponent } from "../../components/Faction";
import { AssetLoader } from "../../assets/AssetLoader";
import { beginAnimation } from "../animation/AnimationTransition";
import { HellhoundStrategy } from "./HellhoundStrategy";
import { isQuadruped } from "../../data/EnemyTypes";
import {
  EnemyStrategy,
  HollowStrategy,
  SoldierStrategy,
  DuelistStrategy,
  BruteStrategy,
  BossStrategy,
  RogueStrategy,
} from "./EnemyStrategies";

export class AISystem {
  private strategies: Map<string, EnemyStrategy> = new Map();

  constructor(private world: World) {
    this.strategies.set("hollow", new HollowStrategy());
    this.strategies.set("soldier", new SoldierStrategy());
    this.strategies.set("duelist", new DuelistStrategy());
    this.strategies.set("brute", new BruteStrategy());
    this.strategies.set("boss", new BossStrategy());
    this.strategies.set("rogue", new RogueStrategy());
    this.strategies.set("hellhound", new HellhoundStrategy());
    this.strategies.set("alpha_hellhound", new HellhoundStrategy(true));
  }

  update() {
    const time = this.world.getResource<TimeState>(TimeState);
    const dtMs = time.delta;
    const battle = this.world.getResource<BattleState>(BattleState);

    const enemies = this.world.query("AIController", "EnemyTag", "Faction");
    const potentialTargets = this.world.query("Faction", "Transform", "Health");

    for (const { id, components } of enemies) {
      if (this.world.hasComponent(id, "HitStop")) continue;
      const ai = components[0] as AIControllerComponent;
      const tag = components[1] as EnemyTagComponent;
      const faction = components[2] as FactionComponent;

      const health = this.world.getComponent<HealthComponent>(id, "Health");
      const combat = this.world.getComponent<CombatComponent>(id, "Combat");
      const physics = this.world.getComponent<PhysicsComponent>(id, "Physics");
      const animator = this.world.getComponent<AnimatorComponent>(id, "Animator");
      const stamina = this.world.getComponent<StaminaComponent>(id, "Stamina");

      // --- Global Death Handling ---
      if (health && (health.isDead || health.current <= 0)) {
        if (ai.state !== "death") {
          ai.state = "death";
          if (animator && animator.currentAnim !== "death") beginAnimation(animator, "death");
          if (combat) {
            combat.attackState = "idle";
            combat.isBlocking = false;
          }
          this.world.removeComponent(id, "ActiveHitbox");
        }
        if (physics) physics.velocity.x = 0;
        continue;
      }

      // --- Feint Execution (Global Logic) ---
      if (
        combat &&
        combat.attackState === "windup" &&
        ai.behaviorParams.canFeint &&
        ai.wantsToFeint &&
        !ai.feintTriggered &&
        stamina &&
        !stamina.isExhausted &&
        stamina.current >= 5
      ) {
        // Check mid-windup (approx 50% progress)
        const windupTotal = combat.attackTiming?.windup ?? ai.behaviorParams.windupFrames * 16.66;
        const progress = (windupTotal - combat.attackTimer) / windupTotal;

        if (progress > 0.4) {
          ai.feintTriggered = true;
          // Reset attack to new zone
          combat.attackState = "windup";
          combat.attackZone = combat.attackZone === 2 ? 1 : 2; // Toggle
          combat.attackTimer = windupTotal * 0.8; // Faster second windup
          combat.attackTiming = undefined;
          if (animator) {
            const type = combat.attackType === "heavy" ? "heavy" : "light";
            const zone = combat.attackZone === 1 ? "high" : "mid";
            const name = `${tag.enemyType}_${type}_attack_${zone}`;
            beginAnimation(animator, AssetLoader.getAnimation(name) ? name : animator.currentAnim);
            animator.eventState.clear();
            this.world.removeComponent(id, "ActiveHitbox");
          }
          // Visual Tell
          stamina.current -= 5;
        }
      }

      // --- Target Selection (Global) ---
      // Verify current target is still valid
      if (ai.target !== null) {
        const targetHealth = this.world.getComponent<HealthComponent>(ai.target, "Health");
        const targetFaction = this.world.getComponent<FactionComponent>(ai.target, "Faction");
        if (
          !targetHealth ||
          targetHealth.isDead ||
          targetHealth.current <= 0 ||
          !targetFaction ||
          targetFaction.team === faction.team ||
          !this.world.hasComponent(ai.target, "Transform")
        ) {
          ai.target = null;
          ai.state = "idle";
          ai.currentPath = [];
          ai.pathTargetIndex = 0;
          ai.lastPathTarget = undefined;
          ai.pathRecalculateTimer = 0;
          ai.isFlanking = false;
          if (combat) combat.isBlocking = false;
        }
      }

      if (!ai.target) {
        const myTransform = this.world.getComponent<TransformComponent>(id, "Transform");
        if (myTransform) {
          // Find closest hostile target
          let closestDist = Infinity;
          let closestId: EntityId | null = null;

          for (const target of potentialTargets) {
            if (target.id === id) continue; // Don't target self

            const targetFaction = target.components[0] as FactionComponent;
            const targetTransform = target.components[1] as TransformComponent;
            const targetHealth = target.components[2] as HealthComponent;

            if (targetHealth.isDead || targetHealth.current <= 0) continue;
            if (targetFaction.team === faction.team) continue; // Same team

            // Optimized Distance Check (No object creation)
            const dx = targetTransform.position.x - myTransform.position.x;
            const dy = targetTransform.position.y - myTransform.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < closestDist) {
              closestDist = dist;
              closestId = target.id;
            }
          }

          // The arena assigns opponents regardless of campaign aggro range.
          // Keep that assignment working when the previous opponent dies.
          const assignedOpponent = battle?.isActive && !battle.winner;
          if (closestId && (closestDist <= ai.behaviorParams.aggroRange || assignedOpponent)) {
            ai.target = closestId;
            ai.state = assignedOpponent ? "combat" : "alert";
            ai.stateTimer = assignedOpponent ? 0 : 500;
          }
        }
      }

      // A live assignment can become screened by a nearer hostile body. Keep
      // committed swings aimed at their original target; between swings, deal
      // with the opponent actually blocking the approach. The distance margin
      // prevents target churn when opponents stand side by side.
      if (
        ai.target !== null &&
        ai.state === "combat" &&
        combat?.attackState === "idle" &&
        this.world.hasComponent(ai.target, "Combat")
      ) {
        const source = this.world.getComponent<TransformComponent>(id, "Transform")!;
        const assigned = this.world.getComponent<TransformComponent>(ai.target, "Transform")!;
        const direction = Math.sign(assigned.position.x - source.position.x);
        let nearest = Math.abs(assigned.position.x - source.position.x) - 8;
        let replacement: EntityId | undefined;
        for (const candidate of potentialTargets) {
          const [team, t, h] = candidate.components as [
            FactionComponent,
            TransformComponent,
            HealthComponent,
          ];
          const dx = t.position.x - source.position.x;
          if (
            candidate.id === id ||
            candidate.id === ai.target ||
            !this.world.hasComponent(candidate.id, "Combat") ||
            team.team === faction.team ||
            h.isDead ||
            h.current <= 0 ||
            Math.sign(dx) !== direction ||
            Math.abs(t.position.y - source.position.y) > 40 ||
            Math.abs(dx) >= nearest
          )
            continue;
          nearest = Math.abs(dx);
          replacement = candidate.id;
        }
        if (replacement !== undefined) {
          ai.target = replacement;
          ai.pendingAttack = undefined;
          ai.clashResponse = undefined;
          ai.currentPath = [];
          ai.pathTargetIndex = 0;
          ai.pathRecalculateTimer = 0;
          ai.lastPathTarget = undefined;
        }
      }

      // --- Strategy Execution ---
      const strategy = this.strategies.get(tag.enemyType);
      if (strategy) {
        strategy.update(dtMs, id, this.world);
      }

      // Sync MovementState for AnimationSystem
      const movement = this.world.getComponent<MovementStateComponent>(id, "MovementState");
      if (movement && physics && movement.rollTimer <= 0 && movement.backstepTimer <= 0) {
        const vx = Math.abs(physics.velocity.x);
        const scale = this.world.getComponent<TransformComponent>(id, "Transform")?.scale.x ?? 1;
        const runThreshold = isQuadruped(tag.enemyType) ? 70 * Math.abs(scale) : 180;
        if (vx > runThreshold) {
          movement.current = "run";
        } else if (vx > 10) {
          movement.current = "walk";
        } else {
          movement.current = "idle";
        }
      }
    }
  }
}
