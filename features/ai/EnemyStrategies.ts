import { beginAnimation } from "../animation/AnimationTransition";
import { World, EntityId } from "../../core/World";
import { AIControllerComponent } from "./AIControllerComponent";
import { TransformComponent } from "../../components/Transform";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { CombatComponent } from "../combat/CombatComponent";
import { HealthComponent } from "../../components/Health";
import { StaminaComponent } from "../../components/Stamina";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { lerp } from "../../utils/Math";
import { PLAYER_STATS, ENEMY_JUMP_SPEED } from "../../core/Constants";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { FactionComponent } from "../../components/Faction";
import { ColliderComponent } from "../../components/Collider";
import { TimeState } from "../../core/Resources";
import { NavigationGraph } from "../navigation/NavigationGraph";
import { AnimationKey } from "../../core/AssetKeys";
import { AssetLoader } from "../../assets/AssetLoader";

import { MovementStateComponent } from "../movement/MovementStateComponent";
import {
  canAttackTarget,
  getIncomingAttack,
  nearbyThreat,
  isSolidTerrainBlocking,
  attackRange,
  animationAttackRange,
  animationCanReach,
  ordinaryAttackNames,
  actorBounds,
  facingAttacker,
} from "./CombatReach";

import { reactionFor, evasionClear } from "./CombatReactions";
import { flankLanding, flankLandingHazard } from "./FlankPlanning";
import { isQuadruped } from "../../data/EnemyTypes";
import { bodyContactDistance } from "../combat/BodySeparation";

export interface EnemyStrategy {
  update(dt: number, entityId: EntityId, world: World): void;
}

export abstract class BaseStrategy implements EnemyStrategy {
  protected combatThreat: ReturnType<typeof nearbyThreat>;

  update(dt: number, entityId: EntityId, world: World) {
    const ai = world.getComponent<AIControllerComponent>(entityId, "AIController")!;
    const transform = world.getComponent<TransformComponent>(entityId, "Transform")!;
    const physics = world.getComponent<PhysicsComponent>(entityId, "Physics")!;
    const combat = world.getComponent<CombatComponent>(entityId, "Combat")!;
    const animator = world.getComponent<AnimatorComponent>(entityId, "Animator")!;
    const stamina = world.getComponent<StaminaComponent>(entityId, "Stamina")!;
    const movement = world.getComponent<MovementStateComponent>(entityId, "MovementState")!; // Fetch MovementState
    const time = world.getResource<TimeState>(TimeState);
    const health = world.getComponent<HealthComponent>(entityId, "Health")!;

    ai.stateTimer = Math.max(0, ai.stateTimer - dt);
    ai.attackCooldownTimer = Math.max(0, ai.attackCooldownTimer - dt);
    ai.decisionTimer = Math.max(0, ai.decisionTimer - dt);
    ai.turnTimer = Math.max(0, ai.turnTimer - dt);
    ai.pathRecalculateTimer = Math.max(0, ai.pathRecalculateTimer - dt);
    ai.flankTimer = Math.max(0, ai.flankTimer - dt);
    ai.dodgeCooldownTimer = Math.max(0, ai.dodgeCooldownTimer - dt);
    if (ai.guardTimer !== undefined) ai.guardTimer = Math.max(0, ai.guardTimer - dt);
    if (ai.attackDecisionTimer !== undefined)
      ai.attackDecisionTimer = Math.max(0, ai.attackDecisionTimer - dt);
    if (ai.pendingAttack?.target !== ai.target || combat.attackState === "stagger")
      ai.pendingAttack = undefined;
    if (
      ai.clashResponse &&
      (ai.clashResponse.target !== ai.target ||
        time.elapsed >= ai.clashResponse.expiresAt ||
        health.isDead)
    )
      ai.clashResponse = undefined;

    if (ai.consecutiveHits > 0 && time.elapsed - ai.lastHitTime > 3000) {
      ai.consecutiveHits = 0;
    }

    if (combat.attackState === "stagger") {
      ai.state = "stagger";
      physics.velocity.x = lerp(physics.velocity.x, 0, Math.min(1, dt * 0.01));
      ai.isFlanking = false; // Cancel flank if hit
      ai.flankLanding = undefined;
      ai.guardTimer = 0;
      ai.neutralTempo = undefined;
      return;
    } else if (ai.state === "stagger") {
      ai.state = "alert";
      ai.attackCooldownTimer = 1000;
    }

    // If performing a locked movement (backstep/roll), allow MovementSystem to drive physics
    // But ensure we face the target if it's a backstep (so we backstep AWAY)
    if (movement.current === "backstep" || movement.current === "roll") {
      return;
    }

    switch (ai.state) {
      case "idle":
        this.handleIdle(dt, ai, physics, animator, transform);
        break;
      case "patrol":
        this.handlePatrol(dt, ai, physics, animator, transform);
        break;
      case "alert":
        this.handleAlert(dt, ai, physics, animator, transform, world);
        break;
      case "combat":
        this.handleCombat(
          dt,
          ai,
          physics,
          combat,
          stamina,
          animator,
          transform,
          world,
          entityId,
          movement,
          health,
        );
        break;
      case "retreat":
        this.handleRetreat(dt, ai, physics, combat, stamina, animator, transform, world, entityId);
        break;
    }
  }

  protected handleIdle(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    _animator: AnimatorComponent,
    _transform: TransformComponent,
  ) {
    this.applyFriction(dt, physics, 0.2);
    if (ai.decisionTimer <= 0) {
      ai.decisionTimer = 500 + Math.random() * 500;
      if (Math.random() < 0.2) {
        ai.state = "patrol";
        ai.stateTimer = 2000 + Math.random() * 2000;
      }
    }
  }

  protected handlePatrol(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    _animator: AnimatorComponent,
    transform: TransformComponent,
  ) {
    const speed = PLAYER_STATS.walkSpeed * 0.5;
    this.moveDirect(dt, physics, ai.patrolDirection * speed);
    this.faceDirection(dt, ai, transform, ai.patrolDirection);

    const distFromOrigin = Math.abs(transform.position.x - ai.patrolOrigin.x);
    if (
      distFromOrigin > 100 &&
      Math.sign(transform.position.x - ai.patrolOrigin.x) === ai.patrolDirection
    ) {
      ai.patrolDirection *= -1;
    }

    if (ai.stateTimer <= 0) {
      ai.state = "idle";
      ai.stateTimer = 1000 + Math.random() * 1000;
    }
  }

  protected handleAlert(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    _animator: AnimatorComponent,
    transform: TransformComponent,
    world: World,
  ) {
    this.applyFriction(dt, physics, 0.2);
    if (ai.target && world.hasComponent(ai.target, "Transform")) {
      const targetTrans = world.getComponent<TransformComponent>(ai.target, "Transform")!;
      const dir = targetTrans.position.x > transform.position.x ? 1 : -1;
      this.faceDirection(dt, ai, transform, dir);

      if (ai.stateTimer <= 0) {
        const dist = Math.abs(targetTrans.position.x - transform.position.x);
        if (dist > ai.behaviorParams.aggroRange * 1.5) {
          ai.target = null;
          ai.state = "idle";
        } else {
          ai.state = "combat";
        }
      }
    } else {
      ai.state = "idle";
    }
  }

  protected handleCombat(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    transform: TransformComponent,
    world: World,
    entityId: EntityId,
    movement: MovementStateComponent,
    health: HealthComponent,
  ) {
    if (!ai.target || !world.hasComponent(ai.target, "Transform")) {
      ai.state = "idle";
      return;
    }

    const corneredState = this.isBackedAgainstWall(world, transform, entityId);

    // Finish an attack/parry before deciding to retreat after spending stamina.
    if (combat.attackState !== "idle") {
      this.applyFriction(dt, physics, 3.0);
      return;
    }

    if (
      !corneredState &&
      ai.staminaRetreatThreshold >= 0 &&
      stamina.current < ai.staminaRetreatThreshold
    ) {
      ai.state = "retreat";
      ai.stateTimer = 2000;
      combat.isBlocking = false;
      return;
    }

    if (corneredState) {
      ai.attackCooldownTimer = Math.max(0, ai.attackCooldownTimer - dt * 3);
    }

    const targetTrans = world.getComponent<TransformComponent>(ai.target, "Transform")!;
    const targetPhysics = world.getComponent<PhysicsComponent>(ai.target, "Physics");
    const airborneTarget =
      !!targetPhysics &&
      !targetPhysics.grounded &&
      targetTrans.position.y < transform.position.y - 18;
    const sourceType = world.getComponent<EnemyTagComponent>(entityId, "EnemyTag")?.enemyType;
    if (
      airborneTarget &&
      sourceType &&
      !isQuadruped(sourceType) &&
      ai.pendingAttack &&
      !ai.pendingAttack.animation.endsWith("_high")
    )
      ai.pendingAttack = undefined;
    if (ai.pendingAttack) {
      const name = ai.pendingAttack.animation;
      const anticipate =
        targetPhysics && !targetPhysics.grounded
          ? (AssetLoader.getAnimation(name)?.windupMs ??
            (ai.behaviorParams.windupFrames * 1000) / 60)
          : 0;
      const reach = animationAttackRange(world, entityId, ai.target, name, anticipate);
      const terrainClear =
        !world.hasComponent(ai.target, "Collider") ||
        animationCanReach(world, entityId, ai.target, name, anticipate, true, true);
      // A target can crouch, rear or land while we are positioning. Refresh
      // the pending move before its range or cover blockage can strand the approach/director.
      if (
        !terrainClear ||
        ai.pendingAttack.range <= 0 ||
        reach < Math.max(1, bodyContactDistance(world, entityId, ai.target) - 2)
      )
        ai.pendingAttack = undefined;
      else ai.pendingAttack.range = Math.min(ai.pendingAttack.range, reach);
    }
    const actualDist = Math.abs(targetTrans.position.x - transform.position.x);
    const range = attackRange(world, entityId, ai.target);
    const dist = actualDist - (range - ai.behaviorParams.attackRange);
    const dir =
      actualDist < 1 ? transform.facing : targetTrans.position.x > transform.position.x ? 1 : -1;
    ai.approachBlocked = false;
    let blocker: number | undefined,
      blockerGap = Infinity;

    // --- FLANKING MANEUVER ---
    // Handle Airborne Flank Movement
    if (ai.isFlanking) {
      if (physics.grounded && physics.velocity.y >= 0) {
        const reached = !ai.flankLanding || Math.abs(transform.position.x - ai.flankLanding.x) < 30;
        ai.isFlanking = false; // Landed
        ai.flankLanding = undefined;
        ai.flankTimer = reached ? 2000 : 4500; // Cooldown on landing to prevent immediate re-flank
      } else {
        // Move towards target constantly while in air to jump over
        // High acceleration to ensure we clear the jump
        const landingDir = ai.flankLanding
          ? Math.sign(ai.flankLanding.x - transform.position.x)
          : dir;
        const remaining = ai.flankLanding
          ? Math.abs(ai.flankLanding.x - transform.position.x)
          : Infinity;
        this.moveDirect(
          dt,
          physics,
          landingDir *
            Math.min(PLAYER_STATS.runSpeed, Math.sqrt(4000 * Math.max(0, remaining - 3))),
          2000,
        );
        // Don't face direction change while mid-air over target
        return;
      }
    }

    // If crowded or blocked by ally, jump over target
    if (
      physics.grounded &&
      actualDist < range + bodyContactDistance(world, entityId, ai.target) + 80
    ) {
      // Check for overcrowding on this side
      const allies = world.query("AIController", "Transform", "Faction", "Health");
      const team = world.getComponent<FactionComponent>(entityId, "Faction")?.team;
      let amIBlocked = false;

      for (const ally of allies) {
        if (ally.id === entityId) continue;
        const allyTrans = ally.components[1] as TransformComponent;
        const allyFaction = ally.components[2] as FactionComponent;
        const allyHealth = ally.components[3] as HealthComponent;
        if (
          allyFaction.team !== team ||
          allyHealth.isDead ||
          allyHealth.current <= 0 ||
          Math.abs(allyTrans.position.y - transform.position.y) >= 40
        )
          continue;
        // An ally can obstruct the route while pursuing a different opponent.
        const allyDir = Math.sign(targetTrans.position.x - allyTrans.position.x);
        const allyDist = Math.abs(targetTrans.position.x - allyTrans.position.x);
        if (allyDir === dir && allyDist < actualDist) {
          amIBlocked = true;
          const gap = Math.abs(allyTrans.position.x - transform.position.x);
          if (gap < blockerGap) {
            blocker = ally.id;
            blockerGap = gap;
          }
        }
      }

      ai.approachBlocked = amIBlocked && actualDist > range;
      const obstruction = ai.flankObstruction;
      if (
        obstruction &&
        (!amIBlocked ||
          blocker !== obstruction.blocker ||
          ai.target !== obstruction.target ||
          Math.abs(
            world.getComponent<TransformComponent>(blocker!, "Transform")!.position.x -
              obstruction.blockerX,
          ) > 24 ||
          Math.hypot(
            targetTrans.position.x - obstruction.targetX,
            targetTrans.position.y - obstruction.targetY,
          ) > 24)
      ) {
        ai.flankTimer = 0;
        ai.flankObstruction = undefined;
      }
      if (
        amIBlocked &&
        actualDist < 200 &&
        ai.flankTimer <= 0 &&
        !ai.hasAttackToken &&
        !stamina.isExhausted &&
        stamina.current > 30
      ) {
        const landing = flankLanding(
          world,
          entityId,
          ai.target,
          ai.behaviorParams.flankJumpSpeed ?? 650,
        );
        if (!landing) {
          ai.flankTimer = 4500;
          ai.approachBlocked = true;
          ai.flankObstruction = {
            blocker: blocker!,
            blockerX: world.getComponent<TransformComponent>(blocker!, "Transform")!.position.x,
            target: ai.target,
            targetX: targetTrans.position.x,
            targetY: targetTrans.position.y,
          };
        } else {
          const hazard = flankLandingHazard(world, entityId, ai.target, landing);
          const baseChance =
            sourceType === "rogue" || sourceType === "duelist" || sourceType === "hellhound"
              ? 0.55
              : sourceType === "brute" || sourceType === "boss"
                ? 0.25
                : 0.45;
          const flankChance = hazard.activeThreatOnLanding
            ? 0.1
            : hazard.enemiesNearLanding >= 2
              ? baseChance * 0.35
              : baseChance;
          if (Math.random() < flankChance) {
            ai.flankObstruction = undefined;
            ai.flankLanding = landing;
            // Trigger Jump Flank
            physics.velocity.y = -(ai.behaviorParams.flankJumpSpeed ?? 650);
            physics.grounded = false;
            ai.flankTimer = 2000; // Cooldown
            ai.isFlanking = true;
            stamina.current -= 10;
            combat.isBlocking = false;
            beginAnimation(animator, AnimationKey.JUMP);
            this.faceDirection(dt, ai, transform, dir);
            this.moveDirect(dt, physics, dir * PLAYER_STATS.runSpeed, 2000);
            return;
          } else {
            ai.flankTimer = 400 + Math.random() * 500;
            ai.approachBlocked = true;
            ai.flankObstruction = {
              blocker: blocker!,
              blockerX: world.getComponent<TransformComponent>(blocker!, "Transform")!.position.x,
              target: ai.target,
              targetX: targetTrans.position.x,
              targetY: targetTrans.position.y,
            };
          }
        }
      }
    }

    if (this.updateCombatPhase(ai, combat, stamina, health)) return;

    const tag = world.getComponent<EnemyTagComponent>(entityId, "EnemyTag");
    const defensive =
      tag &&
      (["soldier", "duelist", "rogue"].includes(tag.enemyType) ||
        (["brute", "boss"].includes(tag.enemyType) && ai.attackCooldownTimer > 0))
        ? nearbyThreat(world, entityId)
        : undefined;
    this.combatThreat = defensive;
    const attentive = defensive && reactionFor(world, ai, defensive).ready;
    const canReach = canAttackTarget(world, transform, targetTrans, entityId, ai.target);
    if (!canReach && attentive) {
      this.faceDirection(
        dt,
        ai,
        transform,
        Math.sign(defensive.attacker.position.x - transform.position.x),
      );
      this.executeCombatLogic(
        dt,
        ai,
        physics,
        combat,
        stamina,
        animator,
        transform,
        dist,
        dir,
        world,
        entityId,
        corneredState,
        movement,
        health,
      );
      return;
    }
    if (
      blocker !== undefined &&
      !ai.hasAttackToken &&
      !attentive &&
      blockerGap < bodyContactDistance(world, entityId, blocker) + 26
    ) {
      this.faceDirection(dt, ai, transform, dir);
      const crowded = blockerGap < bodyContactDistance(world, entityId, blocker) + 22;
      this.moveDirect(
        dt,
        physics,
        crowded && evasionClear(world, entityId, -dir, 8) ? -dir * 30 : 0,
        1800,
      );
      // A Soldier can cover the line while its own attack is cooling down.
      // Lower that guard when ready, so waiting never prevents token access or
      // stamina recovery indefinitely. Animals retain their natural stance.
      combat.isBlocking =
        sourceType === "soldier" &&
        ai.attackCooldownTimer > 0 &&
        !stamina.isExhausted &&
        stamina.current > 20;
      combat.blockZone = 0;
      return;
    }
    const response = ai.clashResponse;
    if (response?.pending && !attentive && canReach) {
      this.faceDirection(dt, ai, transform, dir);
      if (response.step > 0) {
        response.step = Math.max(0, response.step - dt);
        if (!corneredState && physics.grounded && evasionClear(world, entityId, -dir, 12)) {
          this.moveDirect(dt, physics, -dir * 55, 1800);
          combat.isBlocking = false;
          return;
        }
      }
      if (ai.attackCooldownTimer <= 0 && response.delay > 0) {
        response.delay = Math.max(0, response.delay - dt);
        this.moveDirect(dt, physics, 0, 1800);
        combat.isBlocking = false;
        return;
      }
    }
    const clearance = bodyContactDistance(world, entityId, ai.target);
    const spacing = Math.max(clearance + 4, Math.min(range - 4, clearance + 16));
    if (
      physics.grounded &&
      !corneredState &&
      !defensive &&
      canReach &&
      actualDist < spacing &&
      ai.attackCooldownTimer > 0 &&
      evasionClear(world, entityId, -dir, 12)
    ) {
      this.faceDirection(dt, ai, transform, dir);
      this.moveDirect(dt, physics, -dir * PLAYER_STATS.walkSpeed * 0.3, 1200);
      combat.isBlocking = false;
      return;
    }
    const elapsed = world.getResource<TimeState>(TimeState).elapsed;
    const targetCombatState = world.getComponent<CombatComponent>(ai.target, "Combat")?.attackState;
    if (
      ai.neutralTempo &&
      (elapsed >= ai.neutralTempo.until ||
        ai.attackCooldownTimer <= 0 ||
        corneredState ||
        !!defensive ||
        !!ai.pendingAttack ||
        airborneTarget ||
        (sourceType === "soldier" && targetCombatState === "recovery"))
    ) {
      ai.neutralTempo = undefined;
    }
    if (
      physics.grounded &&
      !corneredState &&
      !defensive &&
      !airborneTarget &&
      !ai.pendingAttack &&
      canReach &&
      ai.attackCooldownTimer > 0 &&
      actualDist >= spacing &&
      actualDist <= range * 2.2 &&
      !(sourceType === "soldier" && actualDist <= range * 1.5)
    ) {
      if (!ai.neutralTempo && ai.decisionTimer <= 0) {
        const roll = Math.random();
        const mode =
          roll < 0.35 && actualDist < range * 1.35 && evasionClear(world, entityId, -dir, 18)
            ? "pace_back"
            : roll < 0.72
              ? "hold"
              : "press";
        ai.neutralTempo = { mode, until: elapsed + 320 + Math.random() * 340 };
      }
      if (ai.neutralTempo?.mode === "hold") {
        this.faceDirection(dt, ai, transform, dir);
        this.moveDirect(dt, physics, 0, 1400);
        combat.isBlocking = false;
        return;
      }
      if (ai.neutralTempo?.mode === "pace_back") {
        if (evasionClear(world, entityId, -dir, 12)) {
          this.faceDirection(dt, ai, transform, dir);
          this.moveDirect(dt, physics, -dir * PLAYER_STATS.walkSpeed * 0.35, 1200);
          combat.isBlocking = false;
          return;
        }
        ai.neutralTempo = undefined;
      }
      if (ai.neutralTempo?.mode === "press" && actualDist > spacing + 2) {
        this.faceDirection(dt, ai, transform, dir);
        this.moveDirect(dt, physics, dir * PLAYER_STATS.walkSpeed * 0.45, 1200);
        combat.isBlocking = false;
        return;
      }
    }
    if (
      airborneTarget &&
      actualDist < ai.behaviorParams.aggroRange &&
      Math.abs(targetTrans.position.y - transform.position.y) < 240
    ) {
      // A jumping opponent is not a new platform-navigation destination.
      ai.currentPath = [];
      ai.pathTargetIndex = 0;
      this.faceDirection(
        dt,
        ai,
        transform,
        attentive ? Math.sign(defensive.attacker.position.x - transform.position.x) : dir,
      );
      if (
        !attentive &&
        (!canReach ||
          (ai.attackCooldownTimer > 0 &&
            !ai.pendingAttack &&
            !combat.isBlocking &&
            (ai.guardTimer ?? 0) <= 0 &&
            physics.grounded &&
            actualDist > spacing + 2))
      ) {
        const landingX = targetTrans.position.x + targetPhysics!.velocity.x * 0.25;
        const gap = Math.abs(landingX - transform.position.x);
        const targetGap = canReach ? spacing + 2 : range;
        if (gap > targetGap)
          this.approach(
            dt,
            ai,
            physics,
            gap - (targetGap - ai.behaviorParams.attackRange),
            Math.sign(landingX - transform.position.x),
            PLAYER_STATS.walkSpeed * 0.6,
          );
        else this.moveDirect(dt, physics, 0, 1800);
        combat.isBlocking = false;
        return;
      }
      this.executeCombatLogic(
        dt,
        ai,
        physics,
        combat,
        stamina,
        animator,
        transform,
        dist,
        dir,
        world,
        entityId,
        corneredState,
        movement,
        health,
      );
      return;
    }
    if (
      (dist > ai.behaviorParams.attackRange || !canReach) &&
      ai.pathRecalculateTimer <= 0 &&
      (ai.pathTargetIndex >= ai.currentPath.length ||
        !ai.lastPathTarget ||
        (physics.grounded &&
          Math.hypot(
            targetTrans.position.x - ai.lastPathTarget.x,
            targetTrans.position.y - ai.lastPathTarget.y,
          ) > 60))
    ) {
      const nav = world.getResource<NavigationGraph>(NavigationGraph);
      const box = world.getComponent<ColliderComponent>(entityId, "Collider")!.hurtboxes[0];
      ai.currentPath = nav.findPath(transform.position, targetTrans.position, {
        width: box.width * Math.abs(transform.scale.x),
        height: box.height * transform.scale.y,
      });
      ai.pathTargetIndex = 0;
      ai.lastPathTarget = { ...targetTrans.position };
      ai.pathRecalculateTimer = 1000;
      ai.pathProgressTimer = 0;
      ai.lastPathDistance = Infinity;
    }

    let moveDir: number = dir;
    const step = ai.currentPath[ai.pathTargetIndex];
    if (
      step &&
      (dist > ai.behaviorParams.attackRange || !canReach || (step.started && !physics.grounded))
    ) {
      const goal =
        !step.started && step.action && step.action !== "walk" && step.takeoff
          ? step.takeoff
          : step;
      const dx = goal.x - transform.position.x;
      const dy = goal.y - transform.position.y;
      moveDir = Math.sign(dx);
      const distance = Math.hypot(dx, dy);
      ai.pathProgressTimer =
        distance < (ai.lastPathDistance ?? Infinity) - 0.5 ? 0 : (ai.pathProgressTimer ?? 0) + dt;
      ai.lastPathDistance = distance;
      if ((ai.pathProgressTimer ?? 0) > 2000) {
        ai.currentPath = [];
        ai.pathRecalculateTimer = 0;
        ai.pathProgressTimer = 0;
      } else if (goal !== step) {
        if (Math.abs(dx) < 8 && (physics.grounded || step.action === "fall")) {
          step.started = true;
          if (step.action === "jump") physics.velocity.y = -ENEMY_JUMP_SPEED;
          else if (step.dropThrough) {
            movement.dropThroughTimer = 300;
            physics.velocity.y = 1;
          }
          physics.grounded = false;
        }
      } else if (
        Math.abs(dx) < 20 &&
        Math.abs(dy) < 30 &&
        (physics.grounded || step.action === "walk")
      ) {
        ai.pathTargetIndex++;
        ai.lastPathDistance = Infinity;
        ai.pathProgressTimer = 0;
      }
      if ((step.action && step.action !== "walk") || !canReach) {
        this.faceDirection(dt, ai, transform, moveDir);
        this.moveDirect(dt, physics, moveDir * PLAYER_STATS.walkSpeed * 0.8);
        return;
      }
    }
    if (!canReach) {
      combat.isBlocking = false;
      this.applyFriction(dt, physics, 1);
      return;
    }

    this.faceDirection(
      dt,
      ai,
      transform,
      attentive ? Math.sign(defensive.attacker.position.x - transform.position.x) : moveDir,
    );
    this.executeCombatLogic(
      dt,
      ai,
      physics,
      combat,
      stamina,
      animator,
      transform,
      dist,
      dir,
      world,
      entityId,
      corneredState,
      movement,
      health,
    );
  }

  protected updateCombatPhase(
    _ai: AIControllerComponent,
    _combat: CombatComponent,
    _stamina: StaminaComponent,
    _health: HealthComponent,
  ): boolean {
    return false;
  }

  protected handleRetreat(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    _animator: AnimatorComponent,
    transform: TransformComponent,
    world: World,
    entityId?: EntityId,
  ) {
    if (!ai.target || !world.hasComponent(ai.target, "Transform")) {
      ai.state = "idle";
      return;
    }

    const cornered = this.isBackedAgainstWall(world, transform, entityId);
    if (cornered) {
      ai.state = "combat";
      combat.isBlocking = false;
      return;
    }

    const targetTrans = world.getComponent<TransformComponent>(ai.target, "Transform")!;
    const dist = Math.abs(targetTrans.position.x - transform.position.x);
    const dir = targetTrans.position.x > transform.position.x ? 1 : -1;

    this.faceDirection(dt, ai, transform, dir);
    this.moveDirect(dt, physics, -dir * PLAYER_STATS.walkSpeed * 0.8);

    const safeDist = ai.behaviorParams.attackRange * 2;

    if (dist > safeDist) {
      combat.isBlocking = false;
    } else {
      // Guarding pauses regeneration. A tired NPC must lower its guard even
      // when other actors prevent it from reaching the preferred safe distance.
      combat.isBlocking =
        !stamina.isExhausted && stamina.current > Math.max(20, ai.staminaRetreatThreshold);
      combat.blockZone = 0;
    }

    if (stamina.current > 50 || (ai.stateTimer <= 0 && stamina.current > 20)) {
      ai.state = "combat";
      combat.isBlocking = false;
    }
  }

  protected isBackedAgainstWall(
    world: World,
    transform: TransformComponent,
    entityId?: number,
  ): boolean {
    const body = entityId === undefined ? undefined : actorBounds(world, entityId);
    const probeAABB = {
      x:
        transform.facing === 1
          ? (body?.x ?? transform.position.x - 7) - 30
          : body
            ? body.x + body.width
            : transform.position.x + 7,
      y: body ? body.y + 2 : transform.position.y - 55,
      width: 30,
      height: body ? Math.max(1, body.height - 4) : 50,
    };

    return isSolidTerrainBlocking(world, probeAABB);
  }

  protected abstract executeCombatLogic(
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
    movement: MovementStateComponent,
    health: HealthComponent,
  ): void;

  protected moveDirect(
    dt: number,
    physics: PhysicsComponent,
    targetVelocityX: number,
    acceleration: number = 1000,
  ) {
    if ((physics.impactControlMs ?? 0) > 0) return;
    const diff = targetVelocityX - physics.velocity.x;
    const step = acceleration * (dt / 1000);
    if (Math.abs(diff) < step) physics.velocity.x = targetVelocityX;
    else physics.velocity.x += Math.sign(diff) * step;
  }

  protected approach(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    dist: number,
    direction: number,
    speed: number,
    acceleration = 1400,
  ) {
    if (ai.approachBlocked) {
      this.moveDirect(dt, physics, 0, acceleration);
      return;
    }
    const remaining = Math.max(0, dist - ai.behaviorParams.attackRange + 3);
    const velocity = Math.min(speed, Math.sqrt(2 * acceleration * remaining));
    this.moveDirect(dt, physics, direction * velocity, acceleration);
  }

  protected attackCooldown(ai: AIControllerComponent) {
    return ai.behaviorParams.attackCooldown * (0.75 + Math.random() * 0.5);
  }

  protected applyFriction(dt: number, physics: PhysicsComponent, factor: number) {
    if ((physics.impactControlMs ?? 0) > 0) return;
    physics.velocity.x = lerp(physics.velocity.x, 0, Math.min(1, (dt / 1000) * 10 * factor));
  }

  protected faceDirection(
    _dt: number,
    ai: AIControllerComponent,
    transform: TransformComponent,
    dir: number,
  ) {
    if (dir === 0 || transform.facing === dir) return;
    if (ai.turnTimer <= 0) {
      transform.facing = dir as 1 | -1;
      ai.turnTimer = 200;
    }
  }

  protected initiateAttack(
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    ai: AIControllerComponent,
    zone: 0 | 1 | 2 | 3,
    entityId: EntityId,
    world: World,
    customAnim?: string,
  ) {
    if (!this.canAffordAttack(ai, stamina) || ai.target === null) return false;
    const tag = world.getComponent<EnemyTagComponent>(entityId, "EnemyTag");
    const special =
      !customAnim &&
      ai.consecutiveHits >= 2 &&
      tag &&
      ["soldier", "duelist", "hollow", "rogue"].includes(tag.enemyType);
    const type = ai.behaviorParams.hyperArmor ? "heavy" : "light";
    const zoneName = zone === 1 ? "high" : zone === 3 ? "low" : "mid";
    let animName =
      ai.pendingAttack?.animation ??
      customAnim ??
      (special
        ? `${tag!.enemyType}_special_attack`
        : `${tag ? tag.enemyType + "_" : ""}${type}_attack_${zoneName}`);
    zone = ai.pendingAttack?.zone ?? zone;
    const transform = world.getComponent<TransformComponent>(entityId, "Transform")!;
    const target = world.getComponent<TransformComponent>(ai.target, "Transform")!;
    const targetPhysics = world.getComponent<PhysicsComponent>(ai.target, "Physics");
    if (
      !ai.pendingAttack &&
      ai.clashResponse?.pending &&
      tag &&
      !isQuadruped(tag.enemyType) &&
      !animName.includes("special") &&
      !animName.endsWith("_thrust") &&
      !(tag.enemyType === "brute" && zone === 1)
    ) {
      const nextZone = ai.clashResponse.zone;
      const name =
        tag.enemyType === "brute" && nextZone === 3
          ? AnimationKey.BRUTE_ATTACK_SWEEP
          : `${tag.enemyType}_${type}_attack_${nextZone === 1 ? "high" : nextZone === 3 ? "low" : "mid"}`;
      if (AssetLoader.getAnimation(name)) {
        animName = name;
        zone = nextZone;
      }
    }
    const high = tag && `${tag.enemyType}_${type}_attack_high`;
    if (
      targetPhysics &&
      !targetPhysics.grounded &&
      target.position.y < transform.position.y - 18 &&
      high &&
      tag &&
      !isQuadruped(tag.enemyType) &&
      AssetLoader.getAnimation(high)
    ) {
      animName = high;
      zone = 1;
    }
    const anticipateFor = (name: string) =>
      targetPhysics && !targetPhysics.grounded
        ? (AssetLoader.getAnimation(name)?.windupMs ?? (ai.behaviorParams.windupFrames * 1000) / 60)
        : 0;
    const reachFor = (name: string) =>
      animationAttackRange(world, entityId, ai.target!, name, anticipateFor(name));
    const terrainClear = (name: string) =>
      !world.hasComponent(ai.target!, "Collider") ||
      animationCanReach(world, entityId, ai.target!, name, anticipateFor(name), true, true);
    let chosenRange = Math.min(ai.pendingAttack?.range ?? Infinity, reachFor(animName));
    const clearance = Math.max(1, bodyContactDistance(world, entityId, ai.target) - 2);
    if (chosenRange < clearance || !terrainClear(animName)) {
      // Reselect only an impossible or terrain-blocked move, using this character's
      // existing ordinary attacks. Prefer an alternative already in range; otherwise
      // keep one viable move selected while closing/braking as before.
      let alternative: { name: string; range: number } | undefined;
      const gap = Math.abs(target.position.x - transform.position.x);
      for (const name of ordinaryAttackNames(world, entityId)) {
        if (name === animName || !AssetLoader.getAnimation(name)) continue;
        const range = reachFor(name);
        if (range < clearance || !terrainClear(name)) continue;
        alternative ??= { name, range };
        if (gap <= range + 1) {
          alternative = { name, range };
          break;
        }
      }
      if (!alternative) {
        ai.pendingAttack = undefined;
        return false;
      }
      animName = alternative.name;
      chosenRange = alternative.range;
      zone =
        AssetLoader.getAnimation(animName)?.zone ??
        (animName.endsWith("_high") ? 1 : /_(low|sweep)$/.test(animName) ? 3 : 2);
    }
    ai.pendingAttack = { target: ai.target, animation: animName, zone, range: chosenRange };
    const physics = world.getComponent<PhysicsComponent>(entityId, "Physics")!;
    // A selected move stays selected while positioning. Do not spend stamina or
    // start its cooldown while closing the remaining gap or braking.
    const quadruped = tag?.enemyType === "hellhound" || tag?.enemyType === "alpha_hellhound";
    if (!quadruped && ai.attackDecisionTimer === undefined)
      ai.attackDecisionTimer = 30 + Math.random() * 80;
    const touching =
      Math.abs(target.position.x - transform.position.x) <=
      bodyContactDistance(world, entityId, ai.target) + 2;
    if (
      (ai.attackDecisionTimer ?? 0) > 0 ||
      Math.abs(target.position.x - transform.position.x) > chosenRange + 1 ||
      (target.position.x - transform.position.x) * transform.facing < -1 ||
      (Math.abs(physics.velocity.x) > 35 && !touching)
    )
      return false;
    stamina.current -= ai.behaviorParams.hyperArmor ? 30 : 15;
    combat.attackState = "windup";
    combat.attackSerial = (combat.attackSerial ?? 0) + 1;
    combat.isBlocking = false;
    combat.attackTiming = undefined;
    combat.isHeavyAttack = ai.behaviorParams.hyperArmor;
    combat.attackType = type;
    combat.attackZone = zone;
    combat.attackTimer =
      AssetLoader.getAnimation(animName)?.windupMs ??
      (animName.endsWith("_special_attack") ? 200 : ai.behaviorParams.windupFrames * 16.66);
    if (animName.endsWith("_special_attack")) ai.consecutiveHits = 0;
    ai.pendingAttack = undefined;
    if (ai.clashResponse) ai.clashResponse.pending = false;
    ai.attackDecisionTimer = undefined;
    beginAnimation(animator, animName);
    animator.eventState?.delete(`main_${animName}`);
    return true;
  }

  protected canAffordAttack(ai: AIControllerComponent, stamina: StaminaComponent) {
    return !stamina.isExhausted && stamina.current >= (ai.behaviorParams.hyperArmor ? 30 : 15);
  }

  protected tryEvade(
    ai: AIControllerComponent,
    threat: ReturnType<typeof getIncomingAttack>,
    world: World,
    entityId: number,
    chance: number,
    window: number,
    distance: number,
  ) {
    if (!threat) return false;
    const observed = reactionFor(world, ai, threat);
    if (!observed.ready || threat.timeToImpact > window || observed.reaction.dodgeDecided)
      return false;
    observed.reaction.dodgeDecided = true;
    const transform = world.getComponent<TransformComponent>(entityId, "Transform")!;
    const away = Math.sign(transform.position.x - threat.attacker.position.x) || -transform.facing;
    return Math.random() < chance && evasionClear(world, entityId, away, distance);
  }

  protected tryParry(
    dt: number,
    ai: AIControllerComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    threat: ReturnType<typeof getIncomingAttack>,
    world: World,
    transform: TransformComponent,
  ) {
    const window = (ai.behaviorParams.parryWindowFrames * 1000) / 60;
    // Leave one update of overlap: CombatSystem advances both actors before hits resolve.
    if (
      !threat ||
      threat.combat.attackState !== "windup" ||
      threat.combat.attackTimer > window - dt ||
      !ai.behaviorParams.canParry ||
      ai.decisionTimer > 0 ||
      stamina.isExhausted ||
      stamina.current < PLAYER_STATS.parryCost
    )
      return false;
    const observed = reactionFor(world, ai, threat);
    if (
      !observed.ready ||
      observed.reaction.parryDecided ||
      !facingAttacker(transform, threat.attacker)
    )
      return false;
    observed.reaction.parryDecided = true;
    ai.decisionTimer = 500;
    if (Math.random() >= ai.behaviorParams.parryChance) return false;
    stamina.current -= PLAYER_STATS.parryCost;
    combat.attackState = "parry";
    combat.attackTimer = window;
    combat.attackZone = threat.zone;
    combat.isBlocking = false;
    beginAnimation(animator, AnimationKey.PARRY);
    return true;
  }

  protected maintainOrTryGuard(
    dt: number,
    ai: AIControllerComponent,
    combat: CombatComponent,
    physics: PhysicsComponent,
    stamina: StaminaComponent,
    threat: ReturnType<typeof getIncomingAttack>,
    world: World,
    transform: TransformComponent,
    allowRoll: boolean,
  ): boolean {
    if (
      !threat ||
      stamina.isExhausted ||
      stamina.current <= 20 ||
      !facingAttacker(transform, threat.attacker)
    ) {
      if (combat.isBlocking) combat.isBlocking = false;
      return false;
    }
    const observed = reactionFor(world, ai, threat);
    if (!observed.ready) {
      if (combat.isBlocking) combat.isBlocking = false;
      return false;
    }
    if (combat.isBlocking) {
      if ((ai.guardTimer ?? 0) > 0) {
        combat.blockZone = threat.zone;
        this.moveDirect(dt, physics, 0, 1800);
        return true;
      }
      combat.isBlocking = false;
      return false;
    }
    if (
      !allowRoll ||
      ai.behaviorParams.blockChance <= 0 ||
      ai.decisionTimer > 0 ||
      (ai.guardTimer ?? 0) > 0
    )
      return false;
    ai.guardTimer = 420;
    if (Math.random() < ai.behaviorParams.blockChance) {
      combat.isBlocking = true;
      combat.blockZone = threat.zone;
      this.moveDirect(dt, physics, 0, 1800);
      return true;
    }
    return false;
  }
}

export class HollowStrategy extends BaseStrategy {
  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    _transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
  ) {
    if (dist > ai.behaviorParams.attackRange) {
      if (ai.attackCooldownTimer > 0) {
        this.applyFriction(dt, physics, 0.5);
        return;
      }

      if (ai.currentPath.length === 0) {
        this.approach(dt, ai, physics, dist, dir, PLAYER_STATS.walkSpeed * 0.8);
      } else {
        const nextNode = ai.currentPath[ai.pathTargetIndex];
        if (nextNode) {
          const dx = nextNode.x - _transform.position.x;
          const moveDir = Math.sign(dx);
          this.approach(dt, ai, physics, dist, moveDir, PLAYER_STATS.walkSpeed * 0.8);
        } else {
          this.approach(dt, ai, physics, dist, dir, PLAYER_STATS.walkSpeed * 0.8);
        }
      }
    } else {
      if (ai.attackCooldownTimer > 0 && !cornered) {
        this.moveDirect(dt, physics, -dir * PLAYER_STATS.walkSpeed * 0.5);
        return;
      }

      if (!ai.hasAttackToken && !cornered) {
        this.applyFriction(dt, physics, 0.5);
        return;
      }

      this.applyFriction(dt, physics, 2.0);
      const attackThreshold = cornered ? 5 : 15;

      if (stamina.current > attackThreshold && this.canAffordAttack(ai, stamina)) {
        const zone = Math.random() < 0.5 ? 2 : 3;
        if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world))
          ai.attackCooldownTimer = this.attackCooldown(ai);
      } else {
        if (ai.decisionTimer <= 0) {
          combat.isBlocking =
            !stamina.isExhausted &&
            stamina.current > 0 &&
            Math.random() < ai.behaviorParams.blockChance;
          combat.blockZone = 0;
          ai.decisionTimer = 500;
        }
      }
    }
  }
}

export class SoldierStrategy extends BaseStrategy {
  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    _transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
  ) {
    const targetCombat = world.getComponent<CombatComponent>(ai.target!, "Combat");
    const threat = this.combatThreat;
    const observed = threat ? reactionFor(world, ai, threat) : undefined;
    if (threat && observed?.ready)
      this.faceDirection(
        dt,
        ai,
        _transform,
        Math.sign(threat.attacker.position.x - _transform.position.x),
      );
    if (this.tryParry(dt, ai, combat, stamina, animator, threat, world, _transform)) return;

    const canPunish =
      targetCombat?.attackState === "recovery" && dist <= ai.behaviorParams.attackRange;

    if (threat && observed?.ready && facingAttacker(_transform, threat.attacker)) {
      combat.isBlocking = !stamina.isExhausted && stamina.current > 20;
      combat.blockZone = threat.zone;
    } else if (
      ai.attackCooldownTimer > 0 &&
      dist < ai.behaviorParams.attackRange * 1.5 &&
      !canPunish
    ) {
      combat.isBlocking = !stamina.isExhausted && stamina.current > 20;
      combat.blockZone = 0;
    } else {
      combat.isBlocking = false;
    }

    if (dist > ai.behaviorParams.attackRange && !canPunish) {
      if (!combat.isBlocking) {
        const nextNode = ai.currentPath[ai.pathTargetIndex];
        const moveDir = nextNode ? Math.sign(nextNode.x - _transform.position.x) : dir;
        this.approach(dt, ai, physics, dist, moveDir, PLAYER_STATS.walkSpeed);
      } else this.moveDirect(dt, physics, 0, 1800);
    } else {
      this.moveDirect(dt, physics, 0, 1800);

      if (!ai.hasAttackToken && !canPunish && !cornered) {
        return;
      }

      const attackThreshold = cornered ? 5 : 20;

      if (
        (ai.attackCooldownTimer <= 0 || canPunish) &&
        stamina.current > attackThreshold &&
        this.canAffordAttack(ai, stamina) &&
        !combat.isBlocking
      ) {
        const nextCombo = (ai.currentComboIndex + 1) % 3;
        const target = world.getComponent<TransformComponent>(ai.target!, "Transform")!;
        const compact = cornered && Math.abs(target.position.x - _transform.position.x) < 40;
        const zone = compact ? 2 : ((nextCombo + 1) as 1 | 2 | 3);

        let customAnim: string | undefined = undefined;
        if (compact || (zone === 2 && Math.random() < 0.5)) {
          customAnim = AnimationKey.SOLDIER_ATTACK_THRUST;
          if (compact && ai.pendingAttack?.animation !== customAnim) ai.pendingAttack = undefined;
        }

        if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world, customAnim)) {
          ai.currentComboIndex = nextCombo;
          ai.attackCooldownTimer = this.attackCooldown(ai);
        }
      }
    }
  }
}

export class DuelistStrategy extends BaseStrategy {
  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    _transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
    movement: MovementStateComponent,
    health: HealthComponent,
  ) {
    const threat = this.combatThreat;
    const observed = threat ? reactionFor(world, ai, threat) : undefined;

    // Defensive Actions: Parry, Backstep, or Timed Guard
    if (threat?.combat.attackState === "windup") {
      // Check for Backstep Avoidance first (Range < 100, 40% chance, cooldown)
      if (
        ai.dodgeCooldownTimer <= 0 &&
        physics.grounded &&
        !stamina.isExhausted &&
        Math.abs(threat.attacker.position.x - _transform.position.x) < 100 &&
        stamina.current >= PLAYER_STATS.backstepStaminaCost
      ) {
        if (this.tryEvade(ai, threat, world, entityId, 0.4, 180, PLAYER_STATS.backstepDistance)) {
          // Trigger Backstep
          stamina.current -= PLAYER_STATS.backstepStaminaCost;
          health.invulnTimer = 100;
          movement.current = "backstep";
          movement.backstepTimer = PLAYER_STATS.backstepDuration;
          combat.isBlocking = false;
          beginAnimation(animator, AnimationKey.BACKSTEP);

          // Face target so backstep moves AWAY
          _transform.facing = (Math.sign(threat.attacker.position.x - _transform.position.x) ||
            dir) as 1 | -1;

          ai.dodgeCooldownTimer = 2000; // 2s cooldown on dodge
          ai.attackCooldownTimer = 500; // Brief pause before counter-attack
          return;
        }
      }

      if (this.tryParry(dt, ai, combat, stamina, animator, threat, world, _transform)) return;
    }

    const canTryGuard =
      !!threat &&
      (ai.attackCooldownTimer > 0 ||
        !ai.hasAttackToken ||
        threat.combat.attackState === "active" ||
        !!observed?.reaction.parryDecided);
    if (
      this.maintainOrTryGuard(
        dt,
        ai,
        combat,
        physics,
        stamina,
        threat,
        world,
        _transform,
        canTryGuard,
      )
    )
      return;

    if (dist > ai.behaviorParams.attackRange) {
      const nextNode = ai.currentPath[ai.pathTargetIndex];
      const moveDir = nextNode ? Math.sign(nextNode.x - _transform.position.x) : dir;
      this.approach(dt, ai, physics, dist, moveDir, PLAYER_STATS.runSpeed * 0.8);
    } else {
      this.moveDirect(dt, physics, 0, 1800);

      if (!ai.hasAttackToken && !cornered) return;

      const attackThreshold = cornered ? 5 : 25;

      if (
        ai.attackCooldownTimer <= 0 &&
        stamina.current > attackThreshold &&
        this.canAffordAttack(ai, stamina)
      ) {
        ai.wantsToFeint = ai.behaviorParams.canFeint && Math.random() < 0.5;
        ai.feintTriggered = false;

        const rand = Math.random();
        const zone = rand < 0.33 ? 1 : rand < 0.66 ? 2 : 3;

        if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world))
          ai.attackCooldownTimer = this.attackCooldown(ai);
      }
    }
  }
}

export class RogueStrategy extends BaseStrategy {
  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    _transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
    movement: MovementStateComponent,
    health: HealthComponent,
  ) {
    const threat = this.combatThreat;
    const observed = threat ? reactionFor(world, ai, threat) : undefined;

    // Reactive Dodge Roll (Backwards) or Escape Vault if cornered behind
    if (
      threat?.combat.attackState === "windup" &&
      ai.dodgeCooldownTimer <= 0 &&
      physics.grounded &&
      !stamina.isExhausted &&
      !cornered &&
      stamina.current >= PLAYER_STATS.rollStaminaCost
    ) {
      if (this.tryEvade(ai, threat, world, entityId, 0.6, 200, PLAYER_STATS.rollDistance)) {
        stamina.current -= PLAYER_STATS.rollStaminaCost;
        health.invulnTimer = 200;
        movement.current = "roll";
        movement.rollTimer = PLAYER_STATS.rollDuration;
        combat.isBlocking = false;
        beginAnimation(animator, AnimationKey.ROLL);

        // Turn AWAY from target so roll moves away (retreat)
        _transform.facing = (Math.sign(_transform.position.x - threat.attacker.position.x) ||
          -dir) as 1 | -1;

        ai.dodgeCooldownTimer = 1500;
        ai.attackCooldownTimer = 400;
        return;
      }

      const away = Math.sign(_transform.position.x - threat.attacker.position.x) || -dir;
      if (
        observed?.ready &&
        threat.timeToImpact <= 200 &&
        ai.flankTimer <= 0 &&
        stamina.current > 30 &&
        !evasionClear(world, entityId, away, PLAYER_STATS.rollDistance)
      ) {
        const escapeLanding = flankLanding(
          world,
          entityId,
          threat.attackerId,
          ai.behaviorParams.flankJumpSpeed ?? 650,
        );
        if (
          escapeLanding &&
          !flankLandingHazard(world, entityId, threat.attackerId, escapeLanding)
            .activeThreatOnLanding
        ) {
          ai.flankLanding = escapeLanding;
          physics.velocity.y = -(ai.behaviorParams.flankJumpSpeed ?? 650);
          physics.grounded = false;
          ai.flankTimer = 2000;
          ai.isFlanking = true;
          stamina.current -= 10;
          combat.isBlocking = false;
          beginAnimation(animator, AnimationKey.JUMP);
          this.faceDirection(dt, ai, _transform, -away);
          this.moveDirect(dt, physics, -away * PLAYER_STATS.runSpeed, 2000);
          return;
        }
      }
    }

    if (
      this.maintainOrTryGuard(
        dt,
        ai,
        combat,
        physics,
        stamina,
        threat,
        world,
        _transform,
        ai.attackCooldownTimer > 0 || !ai.hasAttackToken,
      )
    )
      return;

    if (dist > ai.behaviorParams.attackRange) {
      // Very fast movement
      const nextNode = ai.currentPath[ai.pathTargetIndex];
      const moveDir = nextNode ? Math.sign(nextNode.x - _transform.position.x) : dir;
      this.approach(dt, ai, physics, dist, moveDir, PLAYER_STATS.runSpeed * 1.1, 1500);
    } else {
      this.moveDirect(dt, physics, 0, 1800);

      if (!ai.hasAttackToken && !cornered) return;

      if (
        ai.attackCooldownTimer <= 0 &&
        stamina.current > 10 &&
        this.canAffordAttack(ai, stamina)
      ) {
        const rand = Math.random();
        const zone = rand < 0.33 ? 1 : rand < 0.66 ? 2 : 3;
        if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world))
          ai.attackCooldownTimer = this.attackCooldown(ai);
      }
    }
  }
}

export class BruteStrategy extends BaseStrategy {
  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    _transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
  ) {
    const heavyThreat = ai.attackCooldownTimer > 0 ? nearbyThreat(world, entityId) : undefined;
    if (
      this.maintainOrTryGuard(
        dt,
        ai,
        combat,
        physics,
        stamina,
        heavyThreat,
        world,
        _transform,
        ai.attackCooldownTimer > 0,
      )
    )
      return;

    if (dist > ai.behaviorParams.attackRange) {
      const nextNode = ai.currentPath[ai.pathTargetIndex];
      const moveDir = nextNode ? Math.sign(nextNode.x - _transform.position.x) : dir;
      this.approach(dt, ai, physics, dist, moveDir, PLAYER_STATS.walkSpeed * 0.6);
    } else {
      this.moveDirect(dt, physics, 0, 1800);

      if (!ai.hasAttackToken && !cornered) return;

      const attackThreshold = cornered ? 10 : 40;

      if (
        ai.attackCooldownTimer <= 0 &&
        stamina.current > attackThreshold &&
        this.canAffordAttack(ai, stamina)
      ) {
        const target = world.getComponent<TransformComponent>(ai.target!, "Transform")!;
        const compact = cornered || Math.abs(target.position.x - _transform.position.x) < 26;
        const r = Math.random();
        const zone = compact ? 1 : r < 0.45 ? 2 : r < 0.75 ? 3 : 1;
        let customAnim = undefined;
        if (zone === 3) customAnim = AnimationKey.BRUTE_ATTACK_SWEEP;
        if (compact && ai.pendingAttack?.animation !== AnimationKey.BRUTE_ATTACK_RISE)
          ai.pendingAttack = undefined;

        if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world, customAnim))
          ai.attackCooldownTimer = this.attackCooldown(ai);
      }
    }
  }
}

export class BossStrategy extends BaseStrategy {
  protected override updateCombatPhase(
    ai: AIControllerComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    health: HealthComponent,
  ): boolean {
    if (
      ai.behaviorParams.phaseThresholds &&
      ai.currentPhase < ai.behaviorParams.phaseThresholds.length &&
      health.current / health.max <= ai.behaviorParams.phaseThresholds[ai.currentPhase]
    ) {
      ai.currentPhase++;
      stamina.current = stamina.max;
      ai.attackCooldownTimer = 1000;
      combat.attackState = "stagger";
      combat.staggerType = "heavy";
      combat.staggerTimer = 1000;
      combat.attackTimer = 1000;
      ai.behaviorParams.attackCooldown *= 0.7;
      ai.behaviorParams.aggroRange = 1000;
      return true;
    }
    return false;
  }

  protected executeCombatLogic(
    dt: number,
    ai: AIControllerComponent,
    physics: PhysicsComponent,
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    _transform: TransformComponent,
    dist: number,
    dir: number,
    world: World,
    entityId: EntityId,
    cornered: boolean,
  ) {
    const bossThreat = ai.attackCooldownTimer > 0 ? nearbyThreat(world, entityId) : undefined;
    if (
      this.maintainOrTryGuard(
        dt,
        ai,
        combat,
        physics,
        stamina,
        bossThreat,
        world,
        _transform,
        ai.attackCooldownTimer > 0,
      )
    )
      return;

    if (dist > ai.behaviorParams.attackRange) {
      const speedMult = ai.currentPhase > 0 ? 1.2 : 1.0;
      const nextNode = ai.currentPath[ai.pathTargetIndex];
      const moveDir = nextNode ? Math.sign(nextNode.x - _transform.position.x) : dir;
      this.approach(dt, ai, physics, dist, moveDir, PLAYER_STATS.walkSpeed * speedMult);
    } else {
      this.moveDirect(dt, physics, 0, 1800);

      if (!ai.hasAttackToken && !cornered) return;

      if (ai.attackCooldownTimer <= 0 && this.canAffordAttack(ai, stamina)) {
        const rand = Math.random();
        let zone: 1 | 2 | 3 = 2;
        let customAnim = undefined;

        const elapsed = world.getResource<TimeState>(TimeState).elapsed;
        const specialChance = ai.currentPhase > 0 ? 0.35 : 0.25;
        const specialReady = elapsed >= (ai.bossSpecialReadyAt ?? 0) && stamina.current >= 30;
        const target = world.getComponent<TransformComponent>(ai.target!, "Transform")!;
        const compact = cornered && Math.abs(target.position.x - _transform.position.x) < 40;
        if (compact) {
          customAnim = AnimationKey.BOSS_ATTACK_THRUST;
          if (ai.pendingAttack?.animation !== customAnim) ai.pendingAttack = undefined;
        } else if (specialReady && (ai.consecutiveHits >= 2 || rand < specialChance)) {
          customAnim =
            ai.currentComboIndex % 2 === 0
              ? AnimationKey.BOSS_ATTACK_SPECIAL_REAP
              : AnimationKey.BOSS_ATTACK_SPECIAL_SKEWER;
          zone = customAnim === AnimationKey.BOSS_ATTACK_SPECIAL_REAP ? 3 : 2;
        } else {
          const ordinary = specialReady ? (rand - specialChance) / (1 - specialChance) : rand;
          if (ordinary < 0.25) zone = 1;
          else if (ordinary < 0.5) zone = 3;
          else if (Math.random() < 0.5) {
            customAnim = AnimationKey.BOSS_ATTACK_THRUST;
          }
        }

        if (this.initiateAttack(combat, stamina, animator, ai, zone, entityId, world, customAnim)) {
          if (animator.currentAnim.includes("special")) {
            ai.currentComboIndex++;
            ai.consecutiveHits = 0;
            ai.bossSpecialReadyAt = elapsed + 6000;
          }
          ai.attackCooldownTimer = this.attackCooldown(ai);
        }
      }
    }
  }
}
