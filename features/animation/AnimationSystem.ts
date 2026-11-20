import { beginAnimation } from "./AnimationTransition";
import {
  plantFeet,
  restBody,
  placeHand,
  poseMatrices,
  holdWeapon,
  carryHeavyWeapon,
  weaponDirection,
} from "../../animation/data/PoseAuthoring";
import { PlayerBonePaths } from "../../assets/svg/PlayerSVG";
import { EnemyBonePaths } from "../../assets/svg/EnemySVGs";
import { WeaponPaths } from "../../assets/svg/WeaponSVGs";
import { PLAYER_STATS } from "../../core/Constants";
import { World } from "../../core/World";
import { AnimatorComponent } from "./AnimatorComponent";
import { SkeletonComponent } from "./SkeletonComponent";
import { TimeState } from "../../core/Resources";
import { Animation, BonePose, EasingType } from "./AnimationTypes";
import { AssetLoader } from "../../assets/AssetLoader";
import { lerp } from "../../utils/Math";
import { SoundRequestComponent } from "../../components/SoundRequest";
import { ActiveHitboxComponent, HitboxSweepComponent } from "../combat/ActiveHitboxComponent";
import { hitboxShape, resolveAttackHitbox } from "../combat/HitboxGeometry";
import { TransformComponent } from "../../components/Transform";
import { MovementStateComponent } from "../movement/MovementStateComponent";
import { CombatComponent } from "../combat/CombatComponent";
import { SpawnEffectComponent } from "../../components/SpawnEffect";
import { PhysicsComponent } from "../movement/PhysicsComponent";
import { HitStopComponent } from "../../components/HitStop";
import { AnimationKey } from "../../core/AssetKeys";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { InventoryComponent } from "../../components/Inventory";
import { WEAPONS } from "../../data/WeaponDefinitions";
import { AIControllerComponent } from "../ai/AIControllerComponent";
import { SkeletonKey } from "../../core/AssetKeys";
import { plantQuadrupedFeet } from "../../animation/data/QuadrupedPose";
import { QUADRUPED_LEGS } from "../../skeleton/data/QuadrupedSkeleton";
import { attackMotionOffset } from "../combat/AttackTiming";
import { avoidCarryOverlap, blendWeaponDirection, keepWeaponAboveSupport } from "./ContactPose";

function plantSupport(pose: BonePose, animation: Animation, clearance: number) {
  if (animation.skeletonId === SkeletonKey.QUADRUPED) plantQuadrupedFeet(pose, clearance);
  else plantFeet(pose, clearance);
}

interface SampleBuffer {
  bones: BonePose;
}

export class AnimationSystem {
  // Only the animation viewer supplies these overrides; gameplay uses authored settings.
  preview: { loop: boolean; emitEvents: boolean; time: number; delta: number } | null = null;
  private sampleBuffers = new WeakMap<AnimatorComponent, SampleBuffer>();
  private keyframeBones = new WeakMap<BonePose, WeakMap<BonePose, string[]>>();
  private guardBlends = new WeakMap<
    AnimatorComponent,
    { active: boolean; zone: number; elapsed: number; from: BonePose; direction: number }
  >();

  constructor(private world: World) {}

  update() {
    const timeState = this.world.getResource<TimeState>(TimeState);
    const entities = this.world.query("Animator", "Skeleton", "Transform");
    const dt = timeState.delta;

    for (const { id, components } of entities) {
      const animator = components[0] as AnimatorComponent;
      const skeleton = components[1] as SkeletonComponent;
      const transform = components[2] as TransformComponent;
      animator.pendingEvents.length = 0;

      // === Per-Entity HitStop Check ===
      const hitStop = this.world.getComponent<HitStopComponent>(id, "HitStop");
      if (hitStop) {
        // Skip animation progression
        continue;
      }

      const movement = this.world.getComponent<MovementStateComponent>(id, "MovementState");
      const combat = this.world.getComponent<CombatComponent>(id, "Combat");
      const enemyTag = this.world.getComponent<EnemyTagComponent>(id, "EnemyTag");
      const physics = this.world.getComponent<PhysicsComponent>(id, "Physics");
      const inventory = this.world.getComponent<InventoryComponent>(id, "Inventory");
      const actor = {
        skin: enemyTag?.enemyType ?? "player",
        weapon: combat?.attackTiming?.weapon?.id ?? inventory?.currentWeapon ?? "longsword",
      };
      const animationDt = this.preview?.delta ?? combat?.animationDelta ?? dt;

      if (!animator.eventState) animator.eventState = new Map();

      // === 0. Animation State Mapping ===
      let targetAnim: string = animator.currentAnim;

      // Prioritize Death animation (set by AISystem or Game logic)
      // If currently in death, do not override with combat or movement
      if (animator.currentAnim === "death") {
        targetAnim = "death";
      } else if (combat && combat.attackState !== "idle") {
        // Combat animations take precedence

        // Reactive Stagger: If state is stagger but anim isn't, force it.
        if (combat.attackState === "stagger") {
          const staggerAnim =
            combat.staggerType === "heavy"
              ? AnimationKey.STAGGER_HEAVY
              : AnimationKey.STAGGER_LIGHT;
          if (targetAnim !== staggerAnim) {
            targetAnim = staggerAnim;
          }
        }
      } else if (movement) {
        // Map movement state to animation
        let stateAnim = "idle";
        switch (movement.current) {
          case "idle":
            stateAnim = "idle";
            break;
          case "walk":
            stateAnim = "walk";
            break;
          case "run":
            stateAnim = "run";
            break;
          case "jump":
            stateAnim = "jump";
            break;
          case "fall":
            stateAnim = "fall";
            break;
          case "crouch":
            stateAnim = "crouch";
            break;
          case "crouchWalk":
            stateAnim = "crouchWalk";
            break;
          case "roll":
            stateAnim = "roll";
            break;
          case "slide":
            stateAnim = "slide";
            break;
          case "backstep":
            stateAnim = "backstep";
            break;
          case "climb":
            stateAnim = "climb";
            break;
          case "land":
            stateAnim = "land";
            break;
        }

        targetAnim = stateAnim;

        // Type-Specific Animation Overrides (Walk only for now as requested)
        if (enemyTag && movement.current === "walk") {
          const specific = `${enemyTag.enemyType}_walk`;
          if (AssetLoader.getAnimation(specific)) {
            targetAnim = specific;
          }
        }
      }

      // Capture the displayed pose for both mapped transitions and explicit restarts.
      // This makes interrupted/repeated attacks independent of a leftover blend.
      if (targetAnim !== animator.currentAnim) {
        const previous = AssetLoader.getAnimation(animator.currentAnim, actor);
        const phase = previous?.loop ? animator.time / previous.duration : 0;
        const gaitChange = /walk|run/.test(targetAnim) && /walk|run/.test(animator.currentAnim);
        beginAnimation(animator, targetAnim);
        if (gaitChange)
          animator.time = phase * (AssetLoader.getAnimation(targetAnim, actor)?.duration ?? 0);
        this.removeHitbox(id);
      }
      if (
        !this.preview &&
        (animator.transitionPending ||
          (animator.sampledAnimation && animator.sampledAnimation !== animator.currentAnim))
      ) {
        if (!animator.transitionPending) {
          animator.blendFrom = animator.sampledAnimation!;
          animator.blendElapsed = 0;
        }
        const from = AssetLoader.getAnimation(animator.blendFrom ?? "idle", actor);
        animator.blendFromPose = Object.keys(skeleton.currentPose).length
          ? structuredClone(skeleton.currentPose)
          : from
            ? this.sampleAnimation(from, animator.blendFromTime)
            : {};
        const enteringCombat =
          animator.currentAnim.includes("attack") || animator.currentAnim === "parry";
        animator.blendDuration = enteringCombat
          ? Math.min(50, Math.max(1, (combat?.attackTimer ?? 250) * 0.2))
          : animator.currentAnim.startsWith("stagger")
            ? 25
            : animator.currentAnim === "death"
              ? 60
              : animator.blendFrom?.includes("attack")
                ? 150
                : 120;
        animator.transitionPending = false;
      }
      if (this.preview) {
        animator.blendFrom = null;
        animator.blendFromPose = undefined;
        animator.transitionPending = false;
      }
      animator.sampledAnimation = animator.currentAnim;

      const authoredAnim = AssetLoader.getAnimation(animator.currentAnim, actor);
      const animDef =
        authoredAnim && this.preview ? { ...authoredAnim, loop: this.preview.loop } : authoredAnim;
      let playbackSpeed = 1;
      if (
        !this.preview &&
        animDef?.gaitSpeed &&
        physics &&
        movement &&
        ["walk", "run", "crouchWalk", "climb"].includes(movement.current)
      ) {
        const velocity =
          movement?.current === "climb"
            ? Math.abs(physics.velocity.y)
            : Math.abs(physics.velocity.x);
        playbackSpeed = velocity / (animDef.gaitSpeed * Math.abs(transform.scale.x));
      }
      const advance = animationDt * playbackSpeed;
      let poseTime = this.preview?.time ?? animator.time + advance;
      if (animDef) {
        if (animDef.loop && advance > 0) poseTime %= animDef.duration;
        else poseTime = Math.min(poseTime, animDef.duration);
        if (this.preview?.emitEvents ?? true)
          this.processEvents(
            id,
            animator,
            animDef,
            animator.time,
            advance,
            "main",
            transform.facing,
          );
      }

      const finalPose: BonePose = {};
      if (skeleton.definition) {
        for (const b in skeleton.definition.bindPose) {
          finalPose[b] = { ...skeleton.definition.bindPose[b] };
        }
      }

      let blendWeight = 1;
      if (animator.blendFrom) {
        const from =
          animator.blendFromPose ??
          this.sampleAnimation(
            AssetLoader.getAnimation(animator.blendFrom, actor) ?? {
              name: "empty",
              duration: 1,
              loop: false,
              keyframes: [],
            },
            animator.blendFromTime,
          );
        this.applyPose(finalPose, from);
        blendWeight = Math.min(1, animator.blendElapsed / Math.max(1, animator.blendDuration));
      }
      let sampledTime = poseTime;
      let nominalPose = finalPose;
      if (animDef) {
        if (
          !this.preview &&
          movement?.current === "jump" &&
          combat?.attackState === "idle" &&
          physics
        ) {
          sampledTime =
            (1 - Math.min(1, Math.max(0, -physics.velocity.y / PLAYER_STATS.jumpForce))) *
            animDef.duration;
        } else if (
          !this.preview &&
          movement?.current === "roll" &&
          movement.rollDirection &&
          movement.rollDirection !== transform.facing
        ) {
          sampledTime = Math.max(0, animDef.duration - poseTime);
        }
        let buffer = this.sampleBuffers.get(animator);
        if (!buffer) {
          buffer = { bones: {} };
          this.sampleBuffers.set(animator, buffer);
        }
        const toPose = this.sampleAnimation(animDef, sampledTime, buffer);
        nominalPose = toPose;
        const fromDirection = weaponDirection(finalPose);
        this.mixPose(finalPose, toPose, blendWeight, !!animator.blendFrom, !!animator.blendFrom);
        if (animator.blendFrom && blendWeight < 1 && animDef.skeletonId !== SkeletonKey.QUADRUPED)
          blendWeaponDirection(finalPose, fromDirection, weaponDirection(toPose), blendWeight);
      }

      // === BLOCKING OVERRIDE ===
      if (
        combat &&
        (combat.isBlocking || this.guardBlends.has(animator)) &&
        animator.currentAnim !== "death" &&
        animDef?.skeletonId !== SkeletonKey.QUADRUPED
      ) {
        const active = combat.isBlocking,
          old = this.guardBlends.get(animator);
        const parts = [
          "shoulder-front",
          "arm-front-upper",
          "arm-front-lower",
          "hand-front",
          "weapon-grip",
          "shoulder-back",
          "arm-back-upper",
          "arm-back-lower",
          "hand-back",
        ];
        let blend = old;
        if (active !== (old?.active ?? false) || (active && combat.blockZone !== old?.zone)) {
          blend = {
            active,
            zone: combat.blockZone,
            elapsed: 0,
            from: {},
            direction: weaponDirection(skeleton.currentPose),
          };
          for (const bone of parts)
            blend.from[bone] = structuredClone(skeleton.currentPose[bone] ?? finalPose[bone] ?? {});
          this.guardBlends.set(animator, blend);
        }
        const goal = Object.fromEntries(
          Object.entries(finalPose).map(([bone, p]) => [bone, { ...p }]),
        );
        if (active) {
          if (animDef?.offHandGrip) carryHeavyWeapon(goal, combat.blockZone);
          else this.applyBlockPose(goal, combat.blockZone);
        }
        if (blend) {
          blend.elapsed += animationDt;
          const weight = this.preview ? 1 : Math.min(1, blend.elapsed / 80);
          for (const bone of parts) {
            const from = blend.from[bone]?.rotate ?? 0,
              to = goal[bone]?.rotate ?? 0;
            finalPose[bone] = {
              ...goal[bone],
              rotate: lerp(from, from + ((((to - from + 540) % 360) + 360) % 360) - 180, weight),
            };
          }
          blendWeaponDirection(finalPose, blend.direction, weaponDirection(goal), weight);
          if (!active && weight >= 1) this.guardBlends.delete(animator);
        } else if (active) for (const bone of parts) finalPose[bone] = goal[bone];
      }

      // === DIEGETIC UI: STANCE INDICATORS ===
      // Modify pose based on Attack Zone when in Idle/Walk
      if (
        combat &&
        animator.currentAnim !== "death" &&
        animDef?.skeletonId !== SkeletonKey.QUADRUPED &&
        !combat.isBlocking &&
        combat.attackState === "idle" &&
        (movement?.current === "idle" || movement?.current === "walk")
      ) {
        this.applyStancePose(finalPose, combat.attackZone);
      }

      animator.layers.sort((a, b) => a.priority - b.priority);

      for (let i = 0; i < animator.layers.length; i++) {
        const layer = animator.layers[i];
        if (!layer.animation) continue;

        if (this.preview?.emitEvents ?? true)
          this.processEvents(
            id,
            animator,
            layer.animation,
            layer.time,
            animationDt,
            `layer_${i}`,
            transform.facing,
          );

        const nextLayerTime = layer.animation.loop
          ? (layer.time + animationDt) % layer.animation.duration
          : Math.min(layer.time + animationDt, layer.animation.duration);
        const layerPose = this.sampleAnimation(layer.animation, nextLayerTime);

        const filteredPose: BonePose = {};
        for (const boneId in layerPose) {
          if (layer.boneMask.has(boneId)) {
            filteredPose[boneId] = layerPose[boneId];
          }
        }

        if (layer.blendMode === "override") {
          this.mixPose(finalPose, filteredPose, layer.weight);
        } else {
          this.applyAdditive(finalPose, filteredPose, layer.weight);
        }
      }

      // Landing is an interruptible visual response, not a movement state lock.
      let landingResponse = false;
      if (
        !this.preview &&
        animator.currentAnim !== "death" &&
        movement?.landingTimer &&
        physics?.grounded &&
        (combat?.attackState === "idle" || combat?.attackType === "jump") &&
        !["roll", "slide", "backstep", "crouch", "crouchWalk", "climb"].includes(movement.current)
      ) {
        landingResponse = true;
        const land = AssetLoader.getAnimation("land", actor)!;
        const landing = this.sampleAnimation(land, land.duration - movement.landingTimer);
        const lowerBody: BonePose = {};
        const supportBones =
          animDef?.skeletonId === SkeletonKey.QUADRUPED
            ? [
                "body-pivot",
                "pelvis",
                "torso",
                "chest",
                ...QUADRUPED_LEGS.flatMap((leg) => [`${leg}-upper`, `${leg}-lower`, `${leg}-paw`]),
              ]
            : [
                "hip",
                "torso",
                "leg-front-upper",
                "leg-front-lower",
                "foot-front",
                "leg-back-upper",
                "leg-back-lower",
                "foot-back",
              ];
        for (const bone of supportBones) if (landing[bone]) lowerBody[bone] = landing[bone];
        this.mixPose(finalPose, lowerBody, Math.min(1, movement.landingTimer / 100));
      }
      if (!this.preview && combat?.impact) {
        const impact = combat.impact;
        if (combat.attackState !== "stagger") {
          const weight = impact.remaining / impact.duration,
            direction = impact.direction * transform.facing;
          const torso = (finalPose.torso ??= {});
          torso.rotate = (torso.rotate ?? 0) + direction * (impact.guard ? 5 : 3) * weight;
          const head = (finalPose.head ??= {});
          head.rotate = (head.rotate ?? 0) - direction * 2 * weight;
          if (impact.guard && finalPose["arm-front-lower"])
            finalPose["arm-front-lower"].rotate =
              (finalPose["arm-front-lower"].rotate ?? 0) + direction * 6 * weight;
          if (physics?.grounded) {
            // A short bracing step follows the contact; support planting keeps
            // the other foot anchored and the weapon remains attached to its hands.
            const step = Math.sin(Math.PI * (1 - weight)) * (impact.strength ?? 1);
            const legs =
              animDef?.skeletonId === SkeletonKey.QUADRUPED
                ? ["fore-near", "hind-far"]
                : [direction < 0 ? "leg-back" : "leg-front"];
            for (const leg of legs) {
              for (const [part, angle] of [
                ["upper", -8],
                ["lower", 14],
              ] as const) {
                const joint = (finalPose[`${leg}-${part}`] ??= {});
                joint.rotate = (joint.rotate ?? 0) + angle * step;
              }
            }
          }
          if (impact.recoil && animDef?.skeletonId !== SkeletonKey.QUADRUPED) {
            const grip = (finalPose["weapon-grip"] ??= {});
            grip.rotate =
              (grip.rotate ?? 0) +
              direction * 8 * Math.sin(Math.PI * (1 - weight)) * (impact.strength ?? 1);
          }
        }
        impact.remaining = Math.max(0, impact.remaining - animationDt);
        if (impact.remaining <= 0) combat.impact = undefined;
      }
      if (animDef?.grounded) {
        const toClearance =
          !this.preview && combat?.attackType === "jump" && physics?.grounded
            ? 0
            : this.sampleClearance(animDef, sampledTime);
        const from = animator.blendFrom
          ? AssetLoader.getAnimation(animator.blendFrom, actor)
          : undefined;
        const fromClearance = from?.grounded
          ? this.sampleClearance(from, animator.blendFromTime)
          : 0;
        const landedAirAttack = !this.preview && combat?.attackType === "jump" && physics?.grounded;
        plantSupport(
          finalPose,
          animDef,
          landingResponse || landedAirAttack
            ? 0
            : fromClearance * (1 - blendWeight) + toClearance * blendWeight,
        );
      }
      if (this.preview && animDef?.motion) {
        const offset = attackMotionOffset(animDef, sampledTime);
        const pivot = finalPose["body-pivot"] ?? {};
        finalPose["body-pivot"] = {
          ...pivot,
          translate: {
            x: (pivot.translate?.x ?? 0) + offset.x / Math.abs(transform.scale.x),
            y: (pivot.translate?.y ?? 0) + offset.y / transform.scale.y,
          },
        };
      }
      if (animDef?.bodyContact) {
        const paths = actor.skin === "player" ? PlayerBonePaths : EnemyBonePaths[actor.skin];
        const weaponPath = inventory ? WeaponPaths[WEAPONS[actor.weapon]?.svgAsset] : undefined;
        restBody(
          finalPose,
          { ...paths, ...(weaponPath ? { weapon: weaponPath } : {}) },
          skeleton.definition,
        );
      }
      if (
        !this.preview &&
        animator.currentAnim === "climb" &&
        movement?.current === "climb" &&
        movement.ladderTop !== undefined
      ) {
        const half = Math.floor((poseTime / (animDef?.duration ?? 800)) * 2);
        const side = half % 2 === 0 ? "back" : "front";
        const shoulder = poseMatrices(finalPose).get(`shoulder-${side}`)!;
        if (!animator.climbPlant || animator.climbPlant.halfCycle !== half) {
          const shoulderY = transform.position.y + shoulder.ty * transform.scale.y;
          const rung = movement.ladderTop + 8;
          animator.climbPlant = {
            halfCycle: half,
            side,
            y: rung + Math.round((shoulderY - 8 * transform.scale.y - rung) / 16) * 16,
          };
        }
        const anchor = animator.climbPlant;
        const worldX =
          (movement.ladderCenter ?? transform.position.x) +
          (side === "front" ? 4 : -4) * transform.facing;
        placeHand(finalPose, side, {
          x: (worldX - transform.position.x) / (transform.scale.x * transform.facing),
          y: (anchor.y - transform.position.y) / transform.scale.y,
        });
      } else animator.climbPlant = undefined;
      if (
        !this.preview &&
        combat?.attackState === "idle" &&
        !combat.isBlocking &&
        physics?.grounded &&
        ["idle", "walk", "run"].includes(movement?.current ?? "")
      )
        avoidCarryOverlap(this.world, id, finalPose, animationDt, nominalPose);
      if (animDef?.offHandGrip) holdWeapon(finalPose, animDef.offHandGrip);
      if (!this.preview && animDef && physics?.grounded && animator.currentAnim !== "death")
        keepWeaponAboveSupport(this.world, id, finalPose, animDef);
      skeleton.offHandGripActive = !!animDef?.offHandGrip;
      skeleton.currentPose = finalPose;
      animator.time = poseTime;

      if (animator.blendFrom) {
        animator.blendElapsed += animationDt;
        if (animator.blendElapsed >= animator.blendDuration) {
          animator.blendFrom = null;
          animator.blendFromPose = undefined;
        }
      }

      for (let i = 0; i < animator.layers.length; i++) {
        const layer = animator.layers[i];
        if (!layer.animation) continue;

        layer.time += animationDt;
        if (layer.animation.loop && layer.time >= layer.animation.duration) {
          layer.time %= layer.animation.duration;
        } else if (!layer.animation.loop && layer.time > layer.animation.duration) {
          layer.time = layer.animation.duration;
        }
      }
    }
  }

  private applyBlockPose(pose: BonePose, zone: 0 | 1 | 2 | 3) {
    let shoulderRot = 0;
    let elbowRot = 0;
    let gripRot = 90;

    switch (zone) {
      case 1: // High (Block Up)
        shoulderRot = -120;
        gripRot = 60;
        break;
      case 2: // Mid (Block Forward)
        shoulderRot = -90;
        gripRot = 0;
        break;
      case 3: // Low (Block Down)
        shoulderRot = -45;
        gripRot = 90;
        break;
      case 0: // Guard (Protective/Turtling)
        shoulderRot = 0;
        elbowRot = -90;
        gripRot = 0;
        break;
    }

    if (!pose["shoulder-front"]) pose["shoulder-front"] = {};
    pose["shoulder-front"].rotate = shoulderRot;

    if (!pose["arm-front-lower"]) pose["arm-front-lower"] = {};
    pose["arm-front-lower"].rotate = elbowRot;

    if (!pose["weapon-grip"]) pose["weapon-grip"] = {};
    pose["weapon-grip"].rotate = gripRot;
  }

  private applyStancePose(pose: BonePose, zone: 0 | 1 | 2 | 3) {
    if (zone === 2) return; // Mid is default

    let torsoRot = 0;
    let shoulderRot = 0;
    let gripRot = 0;

    // Apply additive rotation to existing pose
    if (zone === 1) {
      // High
      torsoRot = -5; // Lean back slightly
      shoulderRot = -20; // Raise arm
      gripRot = -10; // Angle up
    } else if (zone === 3) {
      // Low
      torsoRot = 5; // Lean forward
      shoulderRot = 20; // Lower arm
      gripRot = 10;
    } else if (zone === 0) {
      // Guard Stance (Passive)
      shoulderRot = 10;
      gripRot = 20; // Tucked
    }

    if (pose["torso"]) pose["torso"].rotate = (pose["torso"].rotate || 0) + torsoRot;
    if (pose["shoulder-front"])
      pose["shoulder-front"].rotate = (pose["shoulder-front"].rotate || 0) + shoulderRot;
    if (pose["weapon-grip"])
      pose["weapon-grip"].rotate = (pose["weapon-grip"].rotate ?? 90) + gripRot;
  }

  private processEvents(
    entityId: number,
    animator: AnimatorComponent,
    anim: Animation,
    currentTime: number,
    dt: number,
    layerId: string,
    facing: number,
  ) {
    if (!anim.events || anim.duration <= 0 || dt < 0) return;
    const key = `${layerId}_${anim.name}`;
    const transform = this.world.getComponent<TransformComponent>(entityId, "Transform")!;
    const prepareSweep = (hitbox: ActiveHitboxComponent, start = 0) => {
      hitbox.frameSweep = {
        from: hitboxShape(this.world, hitbox, transform),
        start,
        end: 1,
        expires: false,
      };
      const skeleton = this.world.getComponent<SkeletonComponent>(entityId, "Skeleton");
      if (skeleton?.worldPosition)
        hitbox.frameSweep.reset =
          skeleton.worldFacing !== transform.facing ||
          Math.hypot(
            skeleton.worldPosition.x - transform.position.x,
            skeleton.worldPosition.y - transform.position.y,
          ) > 128;
    };
    const existing = this.world.getComponent<ActiveHitboxComponent>(entityId, "ActiveHitbox");
    if (!this.preview && existing && layerId === "main") prepareSweep(existing);
    const dispatch = (start: number, end: number) => {
      for (let i = 0; i < anim.events!.length; i++) {
        const event = anim.events![i];
        const at = event.time * anim.duration;
        if (at < start || at > end || i <= (animator.eventState.get(key) ?? -1)) continue;
        animator.pendingEvents.push(event);
        animator.eventState.set(key, i);
        if (event.type === "sound") this.addSoundRequest(entityId, event.data);
        else if (event.type === "hitbox-start" && event.data) {
          const combat = this.world.getComponent<CombatComponent>(entityId, "Combat");
          // An interrupted recovery cannot spawn a later strike from its old clip.
          if (
            this.preview ||
            !combat ||
            combat.attackState === "windup" ||
            combat.attackState === "active" ||
            combat.attackTiming?.animation === anim.name
          ) {
            this.spawnHitbox(entityId, event.data, facing);
            const hitbox = this.world.getComponent<ActiveHitboxComponent>(
              entityId,
              "ActiveHitbox",
            )!;
            if (!this.preview)
              prepareSweep(hitbox, dt > 0 ? Math.max(0, Math.min(1, (at - currentTime) / dt)) : 1);
          }
        } else if (event.type === "hitbox-end") {
          const hitbox = this.world.getComponent<ActiveHitboxComponent>(entityId, "ActiveHitbox");
          if (!this.preview && hitbox?.frameSweep) {
            // Let hit detection consume the last active fraction of this step.
            hitbox.frameSweep.end = dt > 0 ? Math.max(0, Math.min(1, (at - currentTime) / dt)) : 0;
            hitbox.frameSweep.expires = true;
            let sweeps = this.world.getComponent<HitboxSweepComponent>(entityId, "HitboxSweep");
            if (!sweeps) {
              sweeps = { hitboxes: [] };
              this.world.addComponent(entityId, "HitboxSweep", sweeps);
            }
            sweeps.hitboxes.push(hitbox);
            this.world.removeComponent(entityId, "ActiveHitbox");
          } else this.removeHitbox(entityId);
        } else if (event.type === "effect") this.spawnEffect(entityId, event.data, facing);
      }
    };
    let start = currentTime;
    let end = currentTime + dt;
    while (anim.loop && end >= anim.duration) {
      dispatch(start, anim.duration);
      animator.eventState.delete(key);
      end -= anim.duration;
      start = 0;
    }
    dispatch(start, Math.min(end, anim.duration));
  }

  private spawnHitbox(entityId: number, data: any, _facing: number) {
    this.world.removeComponent(entityId, "ActiveHitbox");
    const combat = this.world.getComponent<CombatComponent>(entityId, "Combat");
    const inventory = this.world.getComponent<InventoryComponent>(entityId, "Inventory");
    const weapon =
      combat?.attackTiming?.weapon ?? (inventory ? WEAPONS[inventory.currentWeapon] : undefined);
    const ai = this.world.getComponent<AIControllerComponent>(entityId, "AIController");
    const heavy = data.attackType === "heavy" || !!combat?.isHeavyAttack;
    const resolved = resolveAttackHitbox(this.world, entityId, data, weapon);
    const damageScale = weapon
      ? weapon.baseDamage / WEAPONS.longsword.baseDamage
      : ai
        ? ai.behaviorParams.attackPower /
          (combat?.attackTiming?.baseHitDamage ?? (data.damage || 1))
        : 1;
    this.world.addComponent(entityId, "ActiveHitbox", {
      offset: resolved.offset,
      width: resolved.width,
      height: resolved.height,
      rotation: resolved.rotation,
      damage: data.damage * damageScale,
      poiseDamage: weapon
        ? heavy
          ? weapon.poiseDamageHeavy
          : weapon.poiseDamageLight
        : data.poiseDamage,
      knockback: data.knockback || { x: 0, y: 0 },
      zone: data.zone,
      attackType: heavy ? "heavy" : data.attackType,
      alreadyHit: new Set(),
      sourceEntityId: entityId,
      attachedToBone: data.attachedToBone,
    } as ActiveHitboxComponent);
  }

  private removeHitbox(entityId: number) {
    this.world.removeComponent(entityId, "HitboxSweep");
    if (this.world.hasComponent(entityId, "ActiveHitbox")) {
      this.world.removeComponent(entityId, "ActiveHitbox");
    }
  }

  private addSoundRequest(entityId: number, data: any) {
    if (!data) return;
    let soundReq = this.world.getComponent<SoundRequestComponent>(entityId, "SoundRequest");
    if (!soundReq) {
      soundReq = { requests: [] };
      this.world.addComponent(entityId, "SoundRequest", soundReq);
    }
    if (typeof data === "string") {
      soundReq.requests.push({ id: data });
    } else {
      soundReq.requests.push({
        id: data.id,
        volume: data.volume,
        pitch: data.pitch,
        position: data.position,
      });
    }
  }

  private spawnEffect(entityId: number, data: any, facing: number) {
    if (!data) return;
    const transform = this.world.getComponent<TransformComponent>(entityId, "Transform");
    if (!transform) return;

    const spawnPos = {
      x: transform.position.x + (data.offset?.x || 0) * facing,
      y: transform.position.y + (data.offset?.y || 0),
    };

    const id = this.world.createEntity();
    this.world.addComponent(id, "SpawnEffect", {
      type: data.type,
      position: spawnPos,
      direction: data.direction || { x: 0, y: 0 },
      scale: data.scale || 1.0,
    } as SpawnEffectComponent);
  }

  sampleAnimation(anim: Animation, time: number, buffer?: SampleBuffer): BonePose {
    // Fresh keys avoid stale sparse poses and dictionary deletion overhead;
    // the interpolated bone values and their vectors can still be reused.
    const pose: BonePose = {};
    if (anim.keyframes.length === 0) return pose;

    const normTime = Math.min(1, Math.max(0, time / anim.duration));
    let kfA = anim.keyframes[0];
    let kfB = anim.keyframes[anim.keyframes.length - 1];

    if (normTime <= kfA.time)
      return this.finishSample(anim, structuredClone(kfA.bones), kfA.clearance ?? 0);
    if (normTime >= kfB.time)
      return this.finishSample(anim, structuredClone(kfB.bones), kfB.clearance ?? 0);

    for (let i = 0; i < anim.keyframes.length - 1; i++) {
      if (normTime >= anim.keyframes[i].time && normTime < anim.keyframes[i + 1].time) {
        kfA = anim.keyframes[i];
        kfB = anim.keyframes[i + 1];
        break;
      }
    }

    const range = kfB.time - kfA.time;
    const localT = range === 0 ? 0 : (normTime - kfA.time) / range;
    const easedT = this.ease(localT, kfA.easing || "linear");

    let pairs = this.keyframeBones.get(kfA.bones);
    if (!pairs) {
      pairs = new WeakMap();
      this.keyframeBones.set(kfA.bones, pairs);
    }
    let allBones = pairs.get(kfB.bones);
    if (!allBones) {
      allBones = [...new Set([...Object.keys(kfA.bones), ...Object.keys(kfB.bones)])];
      pairs.set(kfB.bones, allBones);
    }
    for (const b of allBones) {
      const boneA = kfA.bones[b] || {};
      const boneB = kfB.bones[b] || {};
      const sampled = buffer
        ? (buffer.bones[b] ??= { rotate: 0, translate: { x: 0, y: 0 }, scale: { x: 1, y: 1 } })
        : { rotate: 0, translate: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
      sampled.rotate = lerp(boneA.rotate || 0, boneB.rotate || 0, easedT);
      sampled.translate!.x = lerp(boneA.translate?.x || 0, boneB.translate?.x || 0, easedT);
      sampled.translate!.y = lerp(boneA.translate?.y || 0, boneB.translate?.y || 0, easedT);
      sampled.scale!.x = lerp(boneA.scale?.x ?? 1, boneB.scale?.x ?? 1, easedT);
      sampled.scale!.y = lerp(boneA.scale?.y ?? 1, boneB.scale?.y ?? 1, easedT);
      pose[b] = sampled;
    }
    return this.finishSample(anim, pose, lerp(kfA.clearance ?? 0, kfB.clearance ?? 0, easedT));
  }

  private finishSample(anim: Animation, pose: BonePose, clearance: number): BonePose {
    if (anim.grounded) plantSupport(pose, anim, clearance);
    if (anim.offHandGrip) holdWeapon(pose, anim.offHandGrip);
    return pose;
  }

  private sampleClearance(anim: Animation, time: number): number {
    const t = Math.max(0, Math.min(1, time / anim.duration));
    const keys = anim.keyframes;
    if (!keys.length) return 0;
    if (t <= keys[0].time) return keys[0].clearance ?? 0;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i],
        b = keys[i + 1];
      if (t <= b.time)
        return lerp(
          a.clearance ?? 0,
          b.clearance ?? 0,
          this.ease((t - a.time) / (b.time - a.time), a.easing ?? "linear"),
        );
    }
    return keys.at(-1)?.clearance ?? 0;
  }

  private ease(t: number, type: EasingType): number {
    switch (type) {
      case "linear":
        return t;
      case "ease-in":
        return t * t;
      case "ease-out":
        return 1 - (1 - t) * (1 - t);
      case "ease-in-out":
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }
  }

  private applyPose(target: BonePose, source: BonePose) {
    for (const b in source) {
      target[b] = source[b];
    }
  }

  private mixPose(
    target: BonePose,
    source: BonePose,
    weight: number,
    complete = false,
    shortest = false,
  ) {
    const bones = complete
      ? new Set([...Object.keys(target), ...Object.keys(source)])
      : Object.keys(source);
    for (const b of bones) {
      const srcBone = source[b] ?? {};
      const tgtBone = target[b] || { rotate: 0, translate: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };

      const tRot = tgtBone.rotate ?? 0;
      const tTx = tgtBone.translate?.x ?? 0;
      const tTy = tgtBone.translate?.y ?? 0;
      const tSx = tgtBone.scale?.x ?? 1;
      const tSy = tgtBone.scale?.y ?? 1;

      const sRot = srcBone.rotate ?? 0;
      const sTx = srcBone.translate?.x ?? 0;
      const sTy = srcBone.translate?.y ?? 0;
      const sSx = srcBone.scale?.x ?? 1;
      const sSy = srcBone.scale?.y ?? 1;

      target[b] = {
        rotate: lerp(
          tRot,
          shortest ? tRot + ((((sRot - tRot + 540) % 360) + 360) % 360) - 180 : sRot,
          weight,
        ),
        translate: {
          x: lerp(tTx, sTx, weight),
          y: lerp(tTy, sTy, weight),
        },
        scale: {
          x: lerp(tSx, sSx, weight),
          y: lerp(tSy, sSy, weight),
        },
      };
    }
  }

  private applyAdditive(target: BonePose, source: BonePose, weight: number) {
    for (const b in source) {
      const srcBone = source[b];
      const tgtBone = target[b] || { rotate: 0, translate: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };

      const tRot = tgtBone.rotate ?? 0;
      const tTx = tgtBone.translate?.x ?? 0;
      const tTy = tgtBone.translate?.y ?? 0;
      const tSx = tgtBone.scale?.x ?? 1;
      const tSy = tgtBone.scale?.y ?? 1;

      const sRot = srcBone.rotate ?? 0;
      const sTx = srcBone.translate?.x ?? 0;
      const sTy = srcBone.translate?.y ?? 0;
      const sSx = srcBone.scale?.x ?? 1;
      const sSy = srcBone.scale?.y ?? 1;

      target[b] = {
        rotate: tRot + sRot * weight,
        translate: {
          x: tTx + sTx * weight,
          y: tTy + sTy * weight,
        },
        scale: {
          x: tSx + (sSx - 1) * weight,
          y: tSy + (sSy - 1) * weight,
        },
      };
    }
  }
}
