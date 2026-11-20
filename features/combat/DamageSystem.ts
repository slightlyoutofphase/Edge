import { World, EntityId } from "../../core/World";
import { WeaponTrailComponent } from "../visuals/WeaponTrailComponent";
import { CombatEventQueue, TimeState, CameraState, InputState } from "../../core/Resources";
import { HitEvent } from "./HitEvent";
import { HealthComponent } from "../../components/Health";
import { CombatComponent } from "./CombatComponent";
import { StaminaComponent } from "../../components/Stamina";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { TransformComponent } from "../../components/Transform";
import { SoundRequestComponent } from "../../components/SoundRequest";
import { SpawnEffectComponent } from "../../components/SpawnEffect";
import { HitFlashComponent } from "../visuals/VisualEffectComponent";
import { COMBAT_SETTINGS, PLAYER_STATS } from "../../core/Constants";
import { AIControllerComponent } from "../ai/AIControllerComponent";
import { HitStopComponent } from "../../components/HitStop";
import { InputAction } from "../../core/InputDefinitions";
import { applyHealthDamage } from "./HealthDamage";
import { InventoryComponent } from "../../components/Inventory";
import { WEAPONS } from "../../data/WeaponDefinitions";
import { facingAttacker } from "../ai/CombatReach";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { SkeletonComponent } from "../animation/SkeletonComponent";
import { AssetLoader } from "../../assets/AssetLoader";
import { AnimationSystem } from "../animation/AnimationSystem";
import { SkeletonSystem } from "../animation/SkeletonSystem";
import { holdWeapon } from "../../animation/data/PoseAuthoring";
import { EnemyTagComponent } from "../../components/EnemyTag";
import {
  actorInertia,
  weaponImpact,
  contactDirection,
  impactVelocity,
  recoilVelocity,
  applyImpactVelocity,
} from "./ImpactResponse";
import { actorContacts } from "./ContactGeometry";

export class DamageSystem {
  private sampler: AnimationSystem;
  private bones: SkeletonSystem;
  private canceled = new Map<
    number,
    { serial: number | undefined; time: number; strictAfter?: boolean }
  >();
  constructor(private world: World) {
    this.sampler = new AnimationSystem(world);
    this.bones = new SkeletonSystem(world);
  }

  update() {
    const queue = this.world.getResource<CombatEventQueue>(CombatEventQueue);
    const time = this.world.getResource<TimeState>(TimeState);
    this.canceled.clear();
    const rank = (event: HitEvent) =>
      event.contactType === "clash" || event.contactType === "guard"
        ? 0
        : event.contactType === "terrain"
          ? 1
          : 2;
    queue.events.sort((a, b) => (a.contactTime ?? 0) - (b.contactTime ?? 0) || rank(a) - rank(b));

    while (queue.events.length > 0) {
      const event = queue.events.shift()!;
      const canceled = this.canceled.get(event.attackerId);
      // Interception wins a tie. Ordinary simultaneous flesh trades remain
      // valid; a stagger only invalidates that actor's later contacts.
      if (
        canceled &&
        event.attackSerial !== undefined &&
        event.attackSerial === canceled.serial &&
        (canceled.strictAfter
          ? (event.contactTime ?? 0) > canceled.time + 1e-5
          : (event.contactTime ?? 0) >= canceled.time - 1e-5)
      )
        continue;
      if (event.contactType === "clash") {
        this.handleClash(event);
        continue;
      }

      if (event.targetId === -1) {
        this.handleEnvironmentRecoil(event, time);
        continue;
      }

      const targetHealth = this.world.getComponent<HealthComponent>(event.targetId, "Health");
      if (!targetHealth || targetHealth.isDead || targetHealth.invulnTimer > 0) continue;

      this.resolveHit(event, time);
      const target = this.world.getComponent<CombatComponent>(event.targetId, "Combat");
      if (
        target &&
        (target.attackState === "stagger" || targetHealth.isDead || targetHealth.current <= 0) &&
        !this.canceled.has(event.targetId)
      )
        this.canceled.set(event.targetId, {
          serial: target.attackSerial,
          time: event.contactTime ?? 0,
          strictAfter: true,
        });
    }
  }

  private resolveHit(event: HitEvent, time: TimeState) {
    const targetCombat = this.world.getComponent<CombatComponent>(event.targetId, "Combat");
    const targetStamina = this.world.getComponent<StaminaComponent>(event.targetId, "Stamina");
    const targetPhysics = this.world.getComponent<PhysicsComponent>(event.targetId, "Physics");
    const targetTransform = this.world.getComponent<TransformComponent>(
      event.targetId,
      "Transform",
    );

    const attackerCombat = this.world.getComponent<CombatComponent>(event.attackerId, "Combat");
    const attackerPhysics = this.world.getComponent<PhysicsComponent>(event.attackerId, "Physics");
    const attackerTransform = this.world.getComponent<TransformComponent>(
      event.attackerId,
      "Transform",
    );
    const attackerAI = this.world.getComponent<AIControllerComponent>(
      event.attackerId,
      "AIController",
    );

    const hitDir = contactDirection(
      this.world,
      event.attackerId,
      event.targetId,
      event.impactPoint,
    );

    // === PARRY LOGIC ===
    let parrySuccess = false;
    let isReactiveParry = false;

    // Check for "Player Privilege": Reactive Input Check
    // If the hit connects THIS frame, and the player pressed Parry THIS frame, allow it.
    const isPlayer = this.world.hasComponent(event.targetId, "PlayerInput");
    const guardContact =
      event.contactType !== "body" ||
      !this.world.getComponent<SkeletonComponent>(event.targetId, "Skeleton")?.worldTransforms.size;
    const canDefend =
      event.isBlockable &&
      guardContact &&
      (isPlayer ||
        (!!targetTransform &&
          !!attackerTransform &&
          facingAttacker(targetTransform, attackerTransform)));

    if (isPlayer) {
      const input = this.world.getResource<InputState>(InputState);
      // Check if parry pressed exactly this frame
      if (input.isActionPressed(InputAction.PARRY)) {
        // Validate stamina
        if (
          targetStamina &&
          !targetStamina.isExhausted &&
          targetStamina.current >= PLAYER_STATS.parryCost
        ) {
          isReactiveParry = true;

          // Manually deduct stamina if CombatSystem didn't already catch this input
          // (If CombatSystem caught it, state would be 'parry', but we check here just in case of race/state override)
          if (targetCombat && targetCombat.attackState !== "parry") {
            targetStamina.current -= PLAYER_STATS.parryCost;
            // Force state transition for visual consistency
            targetCombat.attackState = "parry";
            targetCombat.attackTimer = 12 * 16.66;
          }
        }
      }
    }

    if (
      event.isBlockable &&
      (canDefend || isPlayer) &&
      ((targetCombat && targetCombat.attackState === "parry") || isReactiveParry)
    ) {
      if (isPlayer) {
        // Player Privilege: Omni-directional Parry (Ignore Zone Match)
        parrySuccess = true;
      } else {
        // Enemy Logic: Strict Zone Match
        if (targetCombat && event.zone === targetCombat.attackZone) {
          parrySuccess = true;
        }
      }

      if (parrySuccess) {
        this.addSound(event.targetId, "parry");
        if (targetStamina)
          targetStamina.current = Math.min(targetStamina.max, targetStamina.current + 15);

        if (targetCombat) {
          targetCombat.counterWindowActive = true;
          targetCombat.counterWindowTimer = 800;
        }

        if (attackerCombat) this.applyStagger(attackerCombat, "heavy", event.attackerId);
        this.cancelLaterContacts(event);
        if (attackerAI) attackerAI.consecutiveHits = 0;

        this.spawnEffect("parry_burst", event.impactPoint, undefined, 2.0);
        this.addHitFlash(event.targetId, "#baffff", "weapon");
        const recoil = recoilVelocity(this.world, event.attackerId, event.targetId, 130);
        applyImpactVelocity(attackerPhysics, -hitDir * recoil);
        this.impactPose(event.attackerId, -hitDir, true, true, recoil / 100);

        // Freeze both
        this.applyHitStop(event.attackerId, 12);
        this.applyHitStop(event.targetId, 12);

        // Time Slow
        time.timeScale = 0.5;
        time.timeScaleDuration = 60; // 60ms

        this.triggerShake(5, 10 * 16);
        return; // HIT RESOLVED AS PARRY
      } else {
        // Failed Parry
        if (targetStamina) targetStamina.current -= 20;
        if (targetCombat) this.applyStagger(targetCombat, "light", event.targetId);
      }
    }

    // === BLOCK LOGIC ===
    let finalDamage = event.damage;
    let blocked = false;
    let mismatch = false;

    if (
      targetCombat &&
      canDefend &&
      targetCombat.isBlocking &&
      targetCombat.attackState !== "stagger" &&
      targetStamina
    ) {
      let reduction = 0;
      if (targetCombat.blockZone === 0) {
        reduction = COMBAT_SETTINGS.guardStanceReduction;
        blocked = true;
      } else {
        if (targetCombat.blockZone === event.zone) {
          reduction = COMBAT_SETTINGS.perfectBlockReduction;
          blocked = true;
        } else if (Math.abs(targetCombat.blockZone - event.zone) === 1) {
          reduction = COMBAT_SETTINGS.adjacentBlockReduction;
          blocked = true;
        } else {
          reduction = COMBAT_SETTINGS.mismatchBlockReduction;
          blocked = true;
          mismatch = true;
        }
      }

      finalDamage *= 1.0 - reduction;
      targetStamina.current -=
        (event.damage *
          (targetCombat.blockZone === 0 ? COMBAT_SETTINGS.guardStanceCostMalus : 1.0) *
          (1 -
            (WEAPONS[
              this.world.getComponent<InventoryComponent>(event.targetId, "Inventory")
                ?.currentWeapon ?? "longsword"
            ]?.blockStability ?? 50) /
              100)) /
        0.5;

      this.addSound(event.targetId, "block");
      this.addHitFlash(event.targetId, "#8ddfff", "weapon");

      this.spawnEffect("block_spark", event.impactPoint, undefined, 1.5);

      const push = impactVelocity(this.world, event, true);
      applyImpactVelocity(targetPhysics, hitDir * push.x);
      this.impactPose(event.targetId, hitDir, true, false, push.x / 120);

      if (attackerCombat && attackerPhysics) {
        if (attackerAI) attackerAI.consecutiveHits = 0;

        const recoil = recoilVelocity(
          this.world,
          event.attackerId,
          event.targetId,
          event.attackType === "heavy" ? 80 : 115,
        );
        const guardHolds = targetStamina.current > 0 && !mismatch;
        if (event.attackType === "light" || guardHolds) {
          attackerCombat.attackState = "recovery";
          attackerCombat.attackTimer = 200;
          attackerCombat.attackTiming = undefined;
          this.world.removeComponent(event.attackerId, "ActiveHitbox");
          this.recoverWeaponPose(event.attackerId, event);
          this.cancelLaterContacts(event);
          applyImpactVelocity(attackerPhysics, -hitDir * recoil);
          this.impactPose(event.attackerId, -hitDir, true, true, recoil / 100);
          this.applyHitStop(event.attackerId, event.attackType === "heavy" ? 6 : 4);
        } else {
          applyImpactVelocity(attackerPhysics, -hitDir * recoil * 0.35, 0, 60);
          this.impactPose(event.attackerId, -hitDir, true, true, 0.4);
          this.applyHitStop(event.attackerId, 12);
        }
      }
      this.applyHitStop(
        event.targetId,
        event.attackType === "heavy" && targetStamina.current > 0 && !mismatch ? 6 : 4,
      );

      if (targetStamina.current <= 0) {
        targetStamina.current = 0;
        targetStamina.isExhausted = true;
        targetCombat.isBlocking = false;
        this.applyStagger(targetCombat, "heavy", event.targetId);
        this.addSound(event.targetId, "stagger");
      } else if (mismatch) {
        this.applyStagger(targetCombat, "heavy", event.targetId);
        this.addSound(event.targetId, "stagger");
        targetCombat.isBlocking = false;
      }
    } else {
      // Direct Hit
      this.addSound(event.targetId, "hit-flesh");
      const isHeavy = event.attackType === "heavy";
      const frames = isHeavy ? 4 : 2;
      this.applyHitStop(event.attackerId, frames);
      this.applyHitStop(event.targetId, frames);

      this.spawnEffect("flesh_hit", event.impactPoint, { x: hitDir, y: -0.25 });
      this.addHitFlash(event.targetId, "#ffd0ac", this.contactBone(event));
      const push = impactVelocity(this.world, event);
      this.impactPose(event.targetId, hitDir, false, false, push.x / 120);

      if (attackerAI) {
        attackerAI.consecutiveHits = (attackerAI.consecutiveHits || 0) + 1;
        attackerAI.lastHitTime = time.elapsed;
      }

      applyImpactVelocity(targetPhysics, hitDir * push.x, push.y);

      this.triggerShake(isHeavy ? 4 : 2, (isHeavy ? 8 : 4) * 16);
    }

    // Counter Damage
    if (attackerCombat && attackerCombat.counterWindowActive) {
      finalDamage *= 1.5;
      this.spawnEffect("flesh_hit", event.impactPoint, { x: hitDir, y: -0.25 }, 1.5);
    }

    // Apply Damage
    const targetHealth = this.world.getComponent<HealthComponent>(event.targetId, "Health")!;

    // Poise
    if (targetCombat && (!blocked || mismatch || (targetStamina && targetStamina.isExhausted))) {
      // Punish state: Hitting enemy (or player) in recovery frames forces stagger
      const isPunish = targetCombat.attackState === "recovery";

      targetCombat.poise -= event.poiseDamage;
      targetCombat.poiseRegenTimer = 5000;
      if (targetCombat.poise <= 0 || isPunish) {
        this.applyStagger(
          targetCombat,
          event.attackType === "heavy" ? "heavy" : "light",
          event.targetId,
        );
        targetCombat.poise = targetCombat.maxPoise;
      }
    }

    if (!blocked && targetCombat && targetCombat.attackState !== "stagger") {
      targetHealth.invulnTimer = 500;
    }

    applyHealthDamage(this.world, event.targetId, finalDamage);
  }

  private handleEnvironmentRecoil(event: HitEvent, _time: TimeState) {
    this.spawnEffect("block_spark", event.impactPoint);
    this.addSound(event.attackerId, "hit-metal");
    const direction =
      event.impactNormal?.x ??
      -contactDirection(this.world, event.attackerId, -1, event.impactPoint);
    // A ceiling deflects the blade but must not shove the actor sideways.
    const recoil = Math.min(
      120,
      (65 * weaponImpact(this.world, event.attackerId)) /
        actorInertia(this.world, event.attackerId),
    );
    applyImpactVelocity(
      this.world.getComponent<PhysicsComponent>(event.attackerId, "Physics"),
      direction * recoil,
      0,
      80,
    );
    this.impactPose(
      event.attackerId,
      direction || -contactDirection(this.world, event.attackerId, -1, event.impactPoint),
      true,
      true,
      recoil / 100,
    );
    this.addHitFlash(event.attackerId, "#ffe2a4", "weapon");

    const combat = this.world.getComponent<CombatComponent>(event.attackerId, "Combat");
    const stamina = this.world.getComponent<StaminaComponent>(event.attackerId, "Stamina");

    if (combat) {
      combat.attackState = "recovery";
      combat.attackTimer = 200;
      combat.attackTiming = undefined;
      combat.animationDelta = undefined;
      combat.isBlocking = false;
    }
    this.world.removeComponent(event.attackerId, "ActiveHitbox");
    this.world.removeComponent(event.attackerId, "HitboxSweep");
    this.recoverWeaponPose(event.attackerId, event);
    this.cancelLaterContacts(event);
    if (stamina) {
      stamina.current = Math.max(0, stamina.current - PLAYER_STATS.recoilStaminaCost);
    }
    this.applyHitStop(event.attackerId, 6);
  }

  private cancelLaterContacts(event: HitEvent) {
    this.canceled.set(event.attackerId, {
      serial: event.attackSerial,
      time: event.contactTime ?? 0,
    });
    this.world.removeComponent(event.attackerId, "HitboxSweep");
  }

  private handleClash(event: HitEvent) {
    const a = this.world.getComponent<CombatComponent>(event.attackerId, "Combat"),
      b = this.world.getComponent<CombatComponent>(event.targetId, "Combat");
    if (
      !a ||
      !b ||
      a.attackState === "stagger" ||
      b.attackState === "stagger" ||
      (event.attackSerial !== undefined && a.attackSerial !== event.attackSerial) ||
      (event.targetAttackSerial !== undefined && b.attackSerial !== event.targetAttackSerial)
    )
      return;
    const strength = (id: number, combat: CombatComponent) =>
      (combat.isHeavyAttack || combat.attackType === "heavy" ? 2 : 1) *
      weaponImpact(this.world, id);
    const sa = strength(event.attackerId, a),
      sb = strength(event.targetId, b);
    const recoil = (id: number, combat: CombatComponent, serial: number | undefined) => {
      const physics = this.world.getComponent<PhysicsComponent>(id, "Physics");
      combat.attackState = "recovery";
      combat.attackTimer = 200;
      combat.attackTiming = undefined;
      this.world.removeComponent(id, "ActiveHitbox");
      this.world.removeComponent(id, "HitboxSweep");
      this.recoverWeaponPose(id, event);
      this.canceled.set(id, { serial, time: event.contactTime ?? 0 });
      const other = id === event.attackerId ? event.targetId : event.attackerId;
      const direction = -contactDirection(this.world, id, other, event.impactPoint);
      const velocity = recoilVelocity(this.world, id, other, 70);
      applyImpactVelocity(physics, direction * velocity);
      this.impactPose(id, direction, true, true, velocity / 100);
      this.planAfterClash(id, other, combat);
    };
    if (sa < sb * 1.35) recoil(event.attackerId, a, event.attackSerial);
    if (sb < sa * 1.35) recoil(event.targetId, b, event.targetAttackSerial);
    this.spawnEffect("clash_spark", event.impactPoint, undefined, 1.2);
    this.addHitFlash(event.attackerId, "#ffe2a4", "weapon");
    this.addHitFlash(event.targetId, "#ffe2a4", "weapon");
    this.addSound(event.attackerId, "hit-metal");
    this.applyHitStop(event.attackerId, 4);
    this.applyHitStop(event.targetId, 4);
  }

  private recoverWeaponPose(entityId: EntityId, event?: HitEvent) {
    const trail = this.world.getComponent<WeaponTrailComponent>(entityId, "WeaponTrail");
    if (trail) {
      trail.history.length = 0;
      trail.active = false;
    }
    const animator = this.world.getComponent<AnimatorComponent>(entityId, "Animator");
    const skeleton = this.world.getComponent<SkeletonComponent>(entityId, "Skeleton");
    const clip =
      animator &&
      AssetLoader.getAnimation(animator.currentAnim, {
        skin:
          this.world.getComponent<EnemyTagComponent>(entityId, "EnemyTag")?.enemyType ?? "player",
        weapon: this.world.getComponent<InventoryComponent>(entityId, "Inventory")?.currentWeapon,
      });
    const ends = clip?.events?.filter((event) => event.type === "hitbox-end");
    if (!animator || !clip || !ends?.length) return;
    if (skeleton && event?.contactTime !== undefined && event.contactTime < 1) {
      const step =
        this.world.getComponent<CombatComponent>(entityId, "Combat")?.animationDelta ??
        this.world.getResource<TimeState>(TimeState).delta;
      skeleton.currentPose = this.sampler.sampleAnimation(
        clip,
        Math.max(0, animator.time - step * (1 - event.contactTime)),
      );
      if (clip.offHandGrip) holdWeapon(skeleton.currentPose, clip.offHandGrip);
      this.bones.updateEntity(entityId);
    }
    // Keep the impact pose frozen during hitstop, then retract through the
    // existing recovery keys. A canceled blade must not finish another strike.
    animator.blendFrom = animator.currentAnim;
    animator.blendFromTime = animator.time;
    animator.blendFromPose =
      skeleton && Object.keys(skeleton.currentPose).length
        ? structuredClone(skeleton.currentPose)
        : undefined;
    animator.blendDuration = 80;
    animator.blendElapsed = 0;
    animator.transitionPending = false;
    animator.time = Math.max(
      animator.time,
      Math.max(...ends.map((event) => event.time)) * clip.duration,
    );
  }

  private applyStagger(combat: CombatComponent, type: "light" | "heavy", entityId: EntityId) {
    const ai = this.world.getComponent<AIControllerComponent>(entityId, "AIController");
    if (ai && ai.behaviorParams.hyperArmor && type === "light") return;

    combat.attackState = "stagger";
    combat.attackTiming = undefined;
    combat.animationDelta = undefined;
    this.world.removeComponent(entityId, "ActiveHitbox");
    this.world.removeComponent(entityId, "HitboxSweep");
    const trail = this.world.getComponent<WeaponTrailComponent>(entityId, "WeaponTrail");
    if (trail) {
      trail.history.length = 0;
      trail.active = false;
    }
    combat.staggerType = type;
    combat.staggerTimer = type === "light" ? 333 : 600;
    combat.attackTimer = combat.staggerTimer;
  }

  private applyHitStop(id: EntityId, frames: number) {
    this.world.addComponent(id, "HitStop", {
      frames,
      remainingMs: (frames * 1000) / 60,
    } as HitStopComponent);
  }

  private addSound(entityId: number, soundId: string) {
    let soundReq = this.world.getComponent<SoundRequestComponent>(entityId, "SoundRequest");
    if (!soundReq) {
      soundReq = { requests: [] };
      this.world.addComponent(entityId, "SoundRequest", soundReq);
    }
    soundReq.requests.push({ id: soundId });
  }

  private spawnEffect(
    type: any,
    position: { x: number; y: number },
    direction?: { x: number; y: number },
    scale: number = 1.0,
  ) {
    const id = this.world.createEntity();
    this.world.addComponent(id, "SpawnEffect", {
      type: type,
      position: { ...position },
      direction: direction || { x: Math.random() - 0.5, y: Math.random() - 0.5 },
      scale: scale,
    } as SpawnEffectComponent);
  }

  private contactBone(event: HitEvent): string {
    if (event.targetBone) return event.targetBone;
    const art = actorContacts(this.world, event.targetId);
    let nearest = "torso",
      distance = Infinity;
    for (let i = 0; i < art.bodies.length; i++) {
      const c = art.bodies[i].center,
        d = Math.hypot(c.x - event.impactPoint.x, c.y - event.impactPoint.y);
      if (d < distance && art.parts?.[i]) {
        distance = d;
        nearest = art.parts[i];
      }
    }
    return nearest;
  }

  private impactPose(
    id: number,
    direction: number,
    guard: boolean,
    recoil: boolean,
    strength: number,
  ) {
    const combat = this.world.getComponent<CombatComponent>(id, "Combat");
    const duration = recoil ? 180 : guard ? 160 : 140;
    if (combat)
      combat.impact = {
        remaining: duration,
        duration,
        direction,
        guard,
        recoil,
        strength: Math.max(0.4, Math.min(1.4, strength)),
      };
  }

  private planAfterClash(id: number, target: number, combat: CombatComponent) {
    const ai = this.world.getComponent<AIControllerComponent>(id, "AIController");
    if (!ai) return;
    const now = this.world.getResource<TimeState>(TimeState).elapsed;
    const old = ai.clashResponse;
    const repeats =
      old?.target === target && old.expiresAt > now ? Math.min(3, old.repeats + 1) : 1;
    // Sample one response for this contact. Entity/attack identity breaks a
    // mirror's timing without per-frame rerolls or arena-specific exceptions.
    const variant = ((id * 37 + (combat.attackSerial ?? 0) * 17 + repeats * 11) >>> 0) % 3;
    const timing = ((id * 53 + (combat.attackSerial ?? 0) * 7 + repeats * 31) >>> 0) % 137;
    const zone = (((Math.max(1, combat.attackZone) - 1 + 1 + (variant % 2)) % 3) + 1) as 1 | 2 | 3;
    ai.clashResponse = {
      target,
      expiresAt: now + Math.max(8000, ai.attackCooldownTimer + 5000),
      repeats,
      zone,
      delay: 90 + variant * 40 + timing + repeats * 20,
      step: 80 + variant * 35,
      pending: true,
    };
    ai.pendingAttack = undefined;
  }

  private addHitFlash(entityId: EntityId, color: string, bone: string) {
    this.world.addComponent(entityId, "HitFlash", {
      frames: 4,
      color,
      bone,
      remainingMs: 80,
      durationMs: 80,
      opacity: 0.4,
    } as HitFlashComponent);
  }

  private triggerShake(amplitude: number, duration: number) {
    const cam = this.world.getResource<CameraState>(CameraState);
    if (cam && (amplitude >= cam.shake.amplitude || cam.shake.duration <= 0)) {
      cam.shake.amplitude = amplitude;
      cam.shake.duration = duration;
      cam.shake.elapsed = 0;
    }
  }
}
