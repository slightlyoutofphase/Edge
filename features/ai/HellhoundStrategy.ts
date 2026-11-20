import { BaseStrategy } from "./EnemyStrategies";
import { World, EntityId } from "../../core/World";
import { AIControllerComponent } from "./AIControllerComponent";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { CombatComponent } from "../combat/CombatComponent";
import { StaminaComponent } from "../../components/Stamina";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { TransformComponent } from "../../components/Transform";
import { HealthComponent } from "../../components/Health";
import { TimeState } from "../../core/Resources";
import { AnimationKey } from "../../core/AssetKeys";
import { AssetLoader } from "../../assets/AssetLoader";
import { animationAttackRange, getIncomingAttack } from "./CombatReach";
import { evasionClear, reactionFor } from "./CombatReactions";

export class HellhoundStrategy extends BaseStrategy {
  constructor(private alpha = false) {
    super();
  }

  override update(dt: number, entityId: EntityId, world: World) {
    const ai = world.getComponent<AIControllerComponent>(entityId, "AIController")!;
    if (ai.hellhoundDecisionTimer !== undefined)
      ai.hellhoundDecisionTimer = Math.max(0, ai.hellhoundDecisionTimer - dt);
    super.update(dt, entityId, world);
  }

  private ordinaryAttack(ai: AIControllerComponent, dist: number): 0 | 1 | 2 {
    // Close bites/swipes are preferred; pouncing is useful when the target is
    // farther away. Repeating a move stays possible without becoming a cycle.
    if (dist > (this.alpha ? 105 : 34)) return 2;
    const weights = [!this.alpha && dist > 32 ? 0 : 0.5, 0.35, 0.15];
    const zones = [3, 2, 1] as const;
    for (let i = 0; i < weights.length; i++)
      if (zones[i] === ai.lastHellhoundAttackZone) weights[i] *= 0.25;
    let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (const i of [0, 1] as const) {
      roll -= weights[i];
      if (roll < 0) return i;
    }
    return 2;
  }

  protected override updateCombatPhase(
    ai: AIControllerComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    health: HealthComponent,
  ): boolean {
    if (this.alpha && ai.currentPhase === 0 && health.current / health.max <= 0.5) {
      ai.currentPhase = 1;
      ai.behaviorParams.attackCooldown *= 0.8;
      stamina.current = stamina.max;
      ai.attackCooldownTimer = 1000;
      combat.attackState = "stagger";
      combat.staggerType = "heavy";
      combat.staggerTimer = combat.attackTimer = 750;
      return true;
    }
    return false;
  }

  protected override handleRetreat(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    transform: TransformComponent,
    world: World,
    entityId?: EntityId,
  ) {
    super.handleRetreat(dt, ai, physics, combat, stamina, animator, transform, world, entityId);
    // Animals disengage to recover; a humanoid guard would hide their recovery.
    combat.isBlocking = false;
  }

  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
  ) {
    combat.isBlocking = false;
    const targetCombat = world.getComponent<CombatComponent>(ai.target!, "Combat");
    const targetAnimation =
      world.getComponent<AnimatorComponent>(ai.target!, "Animator")?.currentAnim ?? "";
    const activeThreatState =
      targetCombat && ["windup", "active", "recovery"].includes(targetCombat.attackState);
    const specialCommitted = targetAnimation.includes("special") && activeThreatState;
    const heavyCommitted =
      !specialCommitted &&
      activeThreatState &&
      (targetCombat!.isHeavyAttack ||
        targetCombat!.attackType === "heavy" ||
        (targetCombat!.attackState === "windup" && targetCombat!.attackTimer >= 350));
    if (
      ai.hellhoundSpecialResponse &&
      (!(specialCommitted || heavyCommitted) ||
        ai.hellhoundSpecialResponse.attacker !== ai.target ||
        ai.hellhoundSpecialResponse.serial !== (targetCombat?.attackSerial ?? 0))
    )
      ai.hellhoundSpecialResponse = undefined;
    const bite = this.alpha
      ? AnimationKey.ALPHA_HELLHOUND_ATTACK_LOW
      : AnimationKey.HELLHOUND_ATTACK_LOW;
    const target = world.getComponent<TransformComponent>(ai.target!, "Transform")!;
    const gap = Math.abs(target.position.x - transform.position.x);
    if ((specialCommitted || heavyCommitted) && !ai.hellhoundSpecialResponse && physics.grounded) {
      const threat = getIncomingAttack(world, transform, ai.target!, entityId);
      if (threat && reactionFor(world, ai, threat).ready) {
        let shouldRespond = !!specialCommitted;
        if (!shouldRespond) {
          const serial = targetCombat!.attackSerial ?? 0;
          if (
            !ai.heavyThreatChecked ||
            ai.heavyThreatChecked.attacker !== ai.target ||
            ai.heavyThreatChecked.serial !== serial
          ) {
            ai.heavyThreatChecked = { attacker: ai.target!, serial };
            shouldRespond = Math.random() < (this.alpha ? 0.3 : 0.55);
          }
        }
        if (shouldRespond) {
          const quickPunish =
            ai.hasAttackToken &&
            ai.attackCooldownTimer <= 0 &&
            this.canAffordAttack(ai, stamina) &&
            gap <= animationAttackRange(world, entityId, ai.target!, bite) &&
            threat.timeToImpact >
              (AssetLoader.getAnimation(bite)?.windupMs ?? 400) +
                (ai.hellhoundDecisionTimer ?? 240) +
                120;
          const away = Math.sign(transform.position.x - target.position.x) || -dir;
          const distance = this.alpha ? 40 : 30;
          const withdraw = !quickPunish && evasionClear(world, entityId, away, distance);
          ai.hellhoundSpecialResponse = {
            attacker: ai.target!,
            serial: targetCombat!.attackSerial ?? 0,
            mode: quickPunish ? "punish" : withdraw ? "withdraw" : "wait",
            retreatX: withdraw ? transform.position.x + away * distance : undefined,
          };
          // Only uncommitted choices change. A windup already in progress is
          // handled by BaseStrategy and remains fully committed.
          ai.pendingAttack = undefined;
        }
      }
    }
    const response = ai.hellhoundSpecialResponse;
    if (response && targetCombat?.attackState !== "recovery" && response.mode !== "punish") {
      const remaining = (response.retreatX ?? transform.position.x) - transform.position.x;
      const away = Math.sign(remaining);
      this.moveDirect(
        dt,
        physics,
        response.mode === "withdraw" &&
          Math.abs(remaining) > 3 &&
          physics.grounded &&
          evasionClear(world, entityId, away, Math.min(8, Math.abs(remaining)))
          ? away * (this.alpha ? 100 : 140)
          : 0,
        1800,
      );
      return;
    }
    if (dist > ai.behaviorParams.attackRange) {
      if (!ai.pendingAttack) ai.hellhoundDecisionTimer = undefined;
      const next = ai.currentPath[ai.pathTargetIndex];
      const moveDir = next ? Math.sign(next.x - transform.position.x) : dir;
      this.approach(dt, ai, physics, dist, moveDir, this.alpha ? 145 : 195, 1400);
      return;
    }
    this.moveDirect(dt, physics, 0, 1800);
    if (
      !physics.grounded ||
      (!ai.hasAttackToken && !cornered) ||
      ai.attackCooldownTimer > 0 ||
      !this.canAffordAttack(ai, stamina)
    )
      return;

    // Sample once per decision, in attack range. Starting this delay during the
    // approach would let identical opponents expire it together before contact.
    if (ai.hellhoundDecisionTimer === undefined) {
      ai.hellhoundDecisionTimer = 80 + Math.random() * 160;
      return;
    }
    if (ai.hellhoundDecisionTimer > 0) return;

    let name: string, zone: 1 | 2 | 3;
    if (response) {
      // A short ordinary counter differs from copying a telegraphed major
      // special, including when an earlier withdrawal opens its recovery.
      name = bite;
      zone = 3;
    } else if (ai.pendingAttack) {
      name = ai.pendingAttack.animation;
      zone = ai.pendingAttack.zone as 1 | 2 | 3;
    } else if (!this.alpha) {
      const choice = this.ordinaryAttack(ai, dist);
      name = [
        AnimationKey.HELLHOUND_ATTACK_LOW,
        AnimationKey.HELLHOUND_ATTACK_MID,
        AnimationKey.HELLHOUND_ATTACK_HIGH,
      ][choice];
      zone = ([3, 2, 1] as const)[choice];
    } else {
      const now = world.getResource<TimeState>(TimeState).elapsed;
      const specialReady = now >= (ai.bossSpecialReadyAt ?? 0);
      if (
        specialReady &&
        (dist > 125 ||
          ai.consecutiveHits >= 2 ||
          (ai.currentComboIndex >= 2 && Math.random() < 0.4))
      ) {
        // Long approach: commit to a maul. In close combat, alternate it with
        // the broadly telegraphed low slam, whose hitbox can catch a flank.
        const slam =
          dist <= 125 &&
          (ai.lastHellhoundSpecial === "maul" || ai.consecutiveHits >= 2 || Math.random() < 0.6);
        name = slam
          ? AnimationKey.ALPHA_HELLHOUND_SPECIAL_SLAM
          : AnimationKey.ALPHA_HELLHOUND_SPECIAL_MAUL;
        zone = slam ? 3 : 2;
      } else {
        const choice = this.ordinaryAttack(ai, dist);
        name = [
          AnimationKey.ALPHA_HELLHOUND_ATTACK_LOW,
          AnimationKey.ALPHA_HELLHOUND_ATTACK_MID,
          AnimationKey.ALPHA_HELLHOUND_ATTACK_HIGH,
        ][choice];
        zone = ([3, 2, 1] as const)[choice];
      }
    }
    if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world, name)) {
      const committed = animator.currentAnim;
      if (committed.includes("special")) {
        ai.lastHellhoundSpecial = committed.includes("slam") ? "slam" : "maul";
        ai.bossSpecialReadyAt =
          world.getResource<TimeState>(TimeState).elapsed +
          (ai.currentPhase ? 6500 : 8000) +
          Math.random() * 750;
        ai.consecutiveHits = 0;
      } else ai.lastHellhoundAttackZone = combat.attackZone as 1 | 2 | 3;
      ai.currentComboIndex++;
      ai.attackCooldownTimer = ai.behaviorParams.attackCooldown * (0.75 + Math.random() * 0.5);
      ai.hellhoundDecisionTimer = undefined;
    }
  }
}
