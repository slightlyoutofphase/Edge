import { World } from "../../core/World";
import { CombatDirectorState, BattleState, TimeState } from "../../core/Resources";
import { AIControllerComponent } from "./AIControllerComponent";
import { HealthComponent } from "../../components/Health";
import { CombatComponent } from "../combat/CombatComponent";
import { TransformComponent } from "../../components/Transform";
import { StaminaComponent } from "../../components/Stamina";
import { FactionComponent } from "../../components/Faction";
import { MovementStateComponent } from "../movement/MovementStateComponent";
import { canAttackTarget, attackRange } from "./CombatReach";

export class CombatDirectorSystem {
  private reservations = new Map<number, number>();
  private lastGranted = 0;

  constructor(private world: World) {}

  reset() {
    this.reservations.clear();
    this.lastGranted = 0;
  }

  private ready(id: number, ai: AIControllerComponent, combat: CombatComponent) {
    if (
      ai.state !== "combat" ||
      ai.attackCooldownTimer > 0 ||
      combat.attackState !== "idle" ||
      combat.isBlocking ||
      ai.isFlanking
    )
      return false;
    const health = this.world.getComponent<HealthComponent>(id, "Health");
    const targetHealth =
      ai.target === null
        ? undefined
        : this.world.getComponent<HealthComponent>(ai.target, "Health");
    const source = this.world.getComponent<TransformComponent>(id, "Transform");
    const target =
      ai.target === null
        ? undefined
        : this.world.getComponent<TransformComponent>(ai.target, "Transform");
    const stamina = this.world.getComponent<StaminaComponent>(id, "Stamina");
    const faction = this.world.getComponent<FactionComponent>(id, "Faction");
    const targetFaction =
      ai.target === null
        ? undefined
        : this.world.getComponent<FactionComponent>(ai.target, "Faction");
    const movement = this.world.getComponent<MovementStateComponent>(id, "MovementState");
    return (
      !!health &&
      !health.isDead &&
      health.current > 0 &&
      !!targetHealth &&
      !targetHealth.isDead &&
      targetHealth.current > 0 &&
      !!source &&
      !!target &&
      !!faction &&
      !!targetFaction &&
      faction.team !== targetFaction.team &&
      (!stamina ||
        (!stamina.isExhausted && stamina.current >= (ai.behaviorParams.hyperArmor ? 30 : 15))) &&
      movement?.current !== "roll" &&
      movement?.current !== "backstep" &&
      Math.abs(target.position.x - source.position.x) <=
        attackRange(this.world, id, ai.target!) + 1 &&
      canAttackTarget(this.world, source, target, id)
    );
  }

  update() {
    const director = this.world.getResource<CombatDirectorState>(CombatDirectorState);
    const enemies = this.world.query("AIController", "Health", "Combat");
    const dt = this.world.getResource<TimeState>(TimeState)?.delta ?? 0;
    const released = new Set<number>();
    const release = (id: number, ai?: AIControllerComponent) => {
      director.releaseToken(id);
      this.reservations.delete(id);
      released.add(id);
      if (ai) ai.hasAttackToken = false;
    };
    for (const id of director.activeTokens) {
      if (!this.world.hasComponent(id, "AIController")) release(id);
    }

    // 1. Cleanup invalid tokens (dead, staggered, or not in combat)
    for (const { id, components } of enemies) {
      const ai = components[0] as AIControllerComponent;
      const health = components[1] as HealthComponent;
      const combat = components[2] as CombatComponent;

      if (!ai.hasAttackToken) continue;
      const targetHealth =
        ai.target === null
          ? undefined
          : this.world.getComponent<HealthComponent>(ai.target, "Health");
      const targetFaction =
        ai.target === null
          ? undefined
          : this.world.getComponent<FactionComponent>(ai.target, "Faction");
      const faction = this.world.getComponent<FactionComponent>(id, "Faction");
      if (
        health.isDead ||
        health.current <= 0 ||
        !targetHealth ||
        targetHealth.isDead ||
        targetHealth.current <= 0 ||
        !targetFaction ||
        !faction ||
        targetFaction.team === faction.team ||
        !this.world.hasComponent(ai.target!, "Transform") ||
        ai.state !== "combat" ||
        combat.attackState === "stagger"
      ) {
        release(id, ai);
      } else if (combat.attackState === "idle") {
        const remaining = (this.reservations.get(id) ?? 300) - dt;
        if (!this.ready(id, ai, combat) || remaining <= 0) release(id, ai);
        else this.reservations.set(id, remaining);
      } else {
        // Windup, active and recovery retain their existing protection.
        this.reservations.delete(id);
      }
    }

    // 2. Grant tokens
    const requestingEnemies = enemies.filter((e) => {
      const ai = e.components[0] as AIControllerComponent;
      return (
        !released.has(e.id) &&
        !ai.hasAttackToken &&
        this.ready(e.id, ai, e.components[2] as CombatComponent)
      );
    });

    for (let i = requestingEnemies.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [requestingEnemies[i], requestingEnemies[j]] = [requestingEnemies[j], requestingEnemies[i]];
    }
    if (requestingEnemies.length > 1 && this.lastGranted !== 0) {
      const lastIdx = requestingEnemies.findIndex((e) => e.id === this.lastGranted);
      if (lastIdx >= 0) {
        const [last] = requestingEnemies.splice(lastIdx, 1);
        requestingEnemies.push(last);
      }
    }

    // Rotate access; in the arena, share available slots across ready factions.
    const arena = this.world.getResource<BattleState>(BattleState)?.isActive;
    while (requestingEnemies.length && director.activeTokens.size < director.maxTokens) {
      let index = 0;
      if (arena) {
        const teamCount = (id: number) => {
          const team = this.world.getComponent<FactionComponent>(id, "Faction")?.team;
          return [...director.activeTokens].filter(
            (other) => this.world.getComponent<FactionComponent>(other, "Faction")?.team === team,
          ).length;
        };
        index = requestingEnemies.reduce(
          (best, candidate, i) =>
            teamCount(candidate.id) < teamCount(requestingEnemies[best].id) ? i : best,
          0,
        );
      }
      const { id, components } = requestingEnemies.splice(index, 1)[0];
      const ai = components[0] as AIControllerComponent;

      if (director.activeTokens.size < director.maxTokens) {
        if (director.requestToken(id)) {
          ai.hasAttackToken = true;
          this.lastGranted = id;
          this.reservations.set(id, 300);
        }
      }
    }
  }
}
