import { SkeletonDef } from "../features/animation/SkeletonTypes";
import { PlayerSkeleton } from "../skeleton/data/PlayerSkeleton";
import { Animation } from "../features/animation/AnimationTypes";
import { stancePose } from "../animation/data/PoseAuthoring";
import {
  PlayerIdle,
  PlayerWalk,
  PlayerRun,
  PlayerJump,
  PlayerFall,
  PlayerCrouch,
  PlayerRoll,
  PlayerSlide,
  LightAttackMid,
  LightAttackHigh,
  LightAttackLow,
  HeavyAttackMid,
  HeavyAttackHigh,
  HeavyAttackLow,
  SlideAttack,
  Parry,
  StaggerLight,
  PlayerLand,
  PlayerBackstep,
  PlayerCrouchWalk,
  PlayerDeath,
  JumpAttack,
  StaggerHeavy,
  PlayerClimb,
} from "../animation/data/PlayerAnimations";
import {
  HollowWalk,
  SoldierWalk,
  DuelistWalk,
  BruteWalk,
  BossWalk,
  RogueWalk,
  HollowAttackMid,
  HollowAttackLow,
  HollowAttackSpecial,
  SoldierAttackMid,
  SoldierAttackThrust,
  SoldierAttackHigh,
  SoldierAttackLow,
  SoldierAttackSpecial,
  DuelistAttackThrust,
  DuelistAttackHigh,
  DuelistAttackLow,
  DuelistAttackSpecial,
  BruteAttackSmash,
  BruteAttackSweep,
  BruteAttackRise,
  BossAttackSmash,
  BossAttackThrust,
  BossAttackSweep,
  BossAttackOverhead,
  BossAttackSpecialReap,
  BossAttackSpecialSkewer,
  RogueAttackMid,
  RogueAttackHigh,
  RogueAttackLow,
  RogueAttackSpecial,
} from "../animation/data/EnemyAnimations";
import { AnimationKey, SkeletonKey } from "../core/AssetKeys";
import { animationVariant } from "../animation/data/AnimationVariants";
import { QuadrupedSkeleton } from "../skeleton/data/QuadrupedSkeleton";
import { HellhoundAnimations } from "../animation/data/HellhoundAnimations";
import { isQuadruped } from "../data/EnemyTypes";
import { resetEnemyStats } from "../data/EnemyStats";
import { resetWeapons } from "../data/WeaponDefinitions";

export class AssetLoader {
  static animationRevision = 0;
  private static skeletons = new Map<string, SkeletonDef>();
  private static _animations = new Map<string, Animation>();
  private static actorAnimations = new Map<string, Animation>();
  private static baselineAnimations = new Map<string, Animation>();

  static async loadAll(): Promise<void> {
    // Register Skeletons
    this.skeletons.set(SkeletonKey.PLAYER, PlayerSkeleton);
    this.skeletons.set(SkeletonKey.QUADRUPED, QuadrupedSkeleton);

    // Register Player Animations
    this.registerAnimation(AnimationKey.IDLE, PlayerIdle);
    this.registerAnimation(AnimationKey.WALK, PlayerWalk);
    this.registerAnimation(AnimationKey.RUN, PlayerRun);
    this.registerAnimation(AnimationKey.JUMP, PlayerJump);
    this.registerAnimation(AnimationKey.FALL, PlayerFall);
    this.registerAnimation(AnimationKey.CROUCH, PlayerCrouch);
    this.registerAnimation(AnimationKey.ROLL, PlayerRoll);
    this.registerAnimation(AnimationKey.SLIDE, PlayerSlide);

    this.registerAnimation(AnimationKey.LIGHT_ATTACK_MID, LightAttackMid);
    this.registerAnimation(AnimationKey.LIGHT_ATTACK_HIGH, LightAttackHigh);
    this.registerAnimation(AnimationKey.LIGHT_ATTACK_LOW, LightAttackLow);

    this.registerAnimation(AnimationKey.HEAVY_ATTACK_MID, HeavyAttackMid);
    this.registerAnimation(AnimationKey.HEAVY_ATTACK_HIGH, HeavyAttackHigh);
    this.registerAnimation(AnimationKey.HEAVY_ATTACK_LOW, HeavyAttackLow);

    this.registerAnimation(AnimationKey.SLIDE_ATTACK, SlideAttack);
    this.registerAnimation("slide_attack_heavy", {
      ...SlideAttack,
      name: "slide_attack_heavy",
      keyframes: SlideAttack.keyframes.map((key) => {
        if (key.time < 0.18) {
          return {
            ...key,
            bones: {
              ...key.bones,
              torso: { rotate: (key.bones.torso?.rotate ?? 0) - 8 },
              "shoulder-front": { rotate: (key.bones["shoulder-front"]?.rotate ?? 0) + 14 },
              "arm-front-lower": { rotate: (key.bones["arm-front-lower"]?.rotate ?? 0) - 12 },
              "weapon-grip": { rotate: (key.bones["weapon-grip"]?.rotate ?? 0) + 10 },
            },
          };
        }
        if (key.time <= 0.36) {
          return {
            ...key,
            bones: {
              ...key.bones,
              torso: { rotate: (key.bones.torso?.rotate ?? 0) + 5 },
              "shoulder-front": { rotate: (key.bones["shoulder-front"]?.rotate ?? 0) - 8 },
              "weapon-grip": { rotate: (key.bones["weapon-grip"]?.rotate ?? 0) + 6 },
            },
          };
        }
        if (key.time < 1) {
          return {
            ...key,
            bones: {
              ...key.bones,
              torso: { rotate: (key.bones.torso?.rotate ?? 0) + 6 },
              "shoulder-front": { rotate: (key.bones["shoulder-front"]?.rotate ?? 0) - 10 },
            },
          };
        }
        return key;
      }),
      events: SlideAttack.events?.map((event) =>
        event.type === "hitbox-start"
          ? {
              ...event,
              data: { ...event.data, damage: event.data.damage * 2, attackType: "heavy" },
            }
          : { ...event },
      ),
    });
    this.registerAnimation(AnimationKey.PARRY, Parry);
    this.registerAnimation(AnimationKey.STAGGER_LIGHT, StaggerLight);

    this.registerAnimation(AnimationKey.LAND, PlayerLand);
    this.registerAnimation(AnimationKey.BACKSTEP, PlayerBackstep);
    this.registerAnimation(AnimationKey.CROUCH_WALK, PlayerCrouchWalk);
    this.registerAnimation(AnimationKey.DEATH, PlayerDeath);
    this.registerAnimation(AnimationKey.JUMP_ATTACK, JumpAttack);
    this.registerAnimation("jump_attack_heavy", {
      ...JumpAttack,
      name: "jump_attack_heavy",
      keyframes: [
        {
          time: 0,
          bones: stancePose({
            torso: { rotate: -18 },
            head: { rotate: 6 },
            "shoulder-front": { rotate: -168 },
            "arm-front-lower": { rotate: -75 },
            "shoulder-back": { rotate: 18 },
            "arm-back-lower": { rotate: -40 },
            "weapon-grip": { rotate: 38 },
            "leg-front-upper": { rotate: -18, translate: { x: 2, y: 0 } },
            "leg-front-lower": { rotate: 52 },
            "leg-back-upper": { rotate: 28, translate: { x: -2, y: 0 } },
            "leg-back-lower": { rotate: 54 },
          }),
          easing: "ease-out",
          clearance: 6,
        },
        {
          time: 0.13,
          bones: stancePose({
            torso: { rotate: 2 },
            head: { rotate: 0 },
            "shoulder-front": { rotate: -135 },
            "arm-front-lower": { rotate: -20 },
            "shoulder-back": { rotate: 26 },
            "arm-back-lower": { rotate: -48 },
            "weapon-grip": { rotate: 80 },
            "leg-front-upper": { rotate: -24, translate: { x: 2, y: 0 } },
            "leg-front-lower": { rotate: 58 },
            "leg-back-upper": { rotate: 24, translate: { x: -2, y: 0 } },
            "leg-back-lower": { rotate: 50 },
          }),
          easing: "linear",
          clearance: 6,
        },
        {
          time: 0.24,
          bones: stancePose({
            torso: { rotate: 12 },
            head: { rotate: -4 },
            "shoulder-front": { rotate: -92 },
            "arm-front-lower": { rotate: 0 },
            "shoulder-back": { rotate: 34 },
            "arm-back-lower": { rotate: -54 },
            "weapon-grip": { rotate: 88 },
            "leg-front-upper": { rotate: -28, translate: { x: 2, y: 0 } },
            "leg-front-lower": { rotate: 64 },
            "leg-back-upper": { rotate: 24, translate: { x: -2, y: 0 } },
            "leg-back-lower": { rotate: 48 },
          }),
          easing: "linear",
          clearance: 6,
        },
        {
          time: 0.34,
          bones: stancePose({
            torso: { rotate: 18 },
            head: { rotate: -6 },
            "shoulder-front": { rotate: -52 },
            "arm-front-lower": { rotate: 0 },
            "shoulder-back": { rotate: 40 },
            "arm-back-lower": { rotate: -60 },
            "weapon-grip": { rotate: 56 },
            "leg-front-upper": { rotate: -28, translate: { x: 2, y: 0 } },
            "leg-front-lower": { rotate: 64 },
            "leg-back-upper": { rotate: 22, translate: { x: -2, y: 0 } },
            "leg-back-lower": { rotate: 52 },
          }),
          easing: "ease-out",
          clearance: 6,
        },
        {
          time: 0.58,
          bones: stancePose({
            torso: { rotate: 20 },
            head: { rotate: -6 },
            "shoulder-front": { rotate: -44 },
            "arm-front-lower": { rotate: -6 },
            "shoulder-back": { rotate: 38 },
            "arm-back-lower": { rotate: -58 },
            "weapon-grip": { rotate: 48 },
            "leg-front-upper": { rotate: -24, translate: { x: 2, y: 0 } },
            "leg-front-lower": { rotate: 56 },
            "leg-back-upper": { rotate: 22, translate: { x: -2, y: 0 } },
            "leg-back-lower": { rotate: 48 },
          }),
          easing: "ease-in-out",
          clearance: 6,
        },
        {
          time: 1,
          bones: stancePose({
            torso: { rotate: 4 },
            head: { rotate: -1 },
            "shoulder-front": { rotate: 0 },
            "arm-front-lower": { rotate: -45 },
            "shoulder-back": { rotate: 10 },
            "arm-back-lower": { rotate: -25 },
            "weapon-grip": { rotate: 50 },
            "leg-front-upper": { rotate: -22, translate: { x: 2, y: 0 } },
            "leg-front-lower": { rotate: 52 },
            "leg-back-upper": { rotate: 22, translate: { x: -2, y: 0 } },
            "leg-back-lower": { rotate: 48 },
          }),
          easing: "ease-in-out",
          clearance: 5,
        },
      ],
      events: JumpAttack.events?.map((event) =>
        event.type === "hitbox-start"
          ? {
              ...event,
              data: {
                ...event.data,
                damage: event.data.damage * 1.5,
                poiseDamage: 50,
                attackType: "heavy",
              },
            }
          : { ...event },
      ),
    });
    this.registerAnimation(AnimationKey.STAGGER_HEAVY, StaggerHeavy);
    this.registerAnimation(AnimationKey.CLIMB, PlayerClimb);

    // Register Enemy Animations
    this.registerAnimation(AnimationKey.HOLLOW_WALK, HollowWalk);
    this.registerAnimation(AnimationKey.SOLDIER_WALK, SoldierWalk);
    this.registerAnimation(AnimationKey.DUELIST_WALK, DuelistWalk);
    this.registerAnimation(AnimationKey.BRUTE_WALK, BruteWalk);
    this.registerAnimation(AnimationKey.BOSS_WALK, BossWalk);
    this.registerAnimation(AnimationKey.ROGUE_WALK, RogueWalk);

    this.registerAnimation(AnimationKey.HOLLOW_ATTACK_MID, HollowAttackMid);
    this.registerAnimation(AnimationKey.HOLLOW_ATTACK_LOW, HollowAttackLow);
    this.registerAnimation(AnimationKey.HOLLOW_ATTACK_SPECIAL, HollowAttackSpecial);

    this.registerAnimation(AnimationKey.SOLDIER_ATTACK_MID, SoldierAttackMid);
    this.registerAnimation(AnimationKey.SOLDIER_ATTACK_THRUST, SoldierAttackThrust);
    this.registerAnimation(AnimationKey.SOLDIER_ATTACK_HIGH, SoldierAttackHigh);
    this.registerAnimation(AnimationKey.SOLDIER_ATTACK_LOW, SoldierAttackLow);
    this.registerAnimation(AnimationKey.SOLDIER_ATTACK_SPECIAL, SoldierAttackSpecial);

    this.registerAnimation(AnimationKey.DUELIST_ATTACK_THRUST, DuelistAttackThrust);
    this.registerAnimation(AnimationKey.DUELIST_ATTACK_HIGH, DuelistAttackHigh);
    this.registerAnimation(AnimationKey.DUELIST_ATTACK_LOW, DuelistAttackLow);
    this.registerAnimation(AnimationKey.DUELIST_ATTACK_SPECIAL, DuelistAttackSpecial);

    this.registerAnimation(AnimationKey.BRUTE_ATTACK_SMASH, BruteAttackSmash);
    this.registerAnimation(AnimationKey.BRUTE_ATTACK_SWEEP, BruteAttackSweep);
    this.registerAnimation(AnimationKey.BRUTE_ATTACK_RISE, BruteAttackRise);

    this.registerAnimation(AnimationKey.ROGUE_ATTACK_MID, RogueAttackMid);
    this.registerAnimation(AnimationKey.ROGUE_ATTACK_HIGH, RogueAttackHigh);
    this.registerAnimation(AnimationKey.ROGUE_ATTACK_LOW, RogueAttackLow);
    this.registerAnimation(AnimationKey.ROGUE_ATTACK_SPECIAL, RogueAttackSpecial);

    // Boss
    this.registerAnimation(AnimationKey.BOSS_ATTACK_SMASH, BossAttackSmash);
    this.registerAnimation(AnimationKey.BOSS_ATTACK_THRUST, BossAttackThrust);
    this.registerAnimation(AnimationKey.BOSS_ATTACK_SWEEP, BossAttackSweep);
    this.registerAnimation(AnimationKey.BOSS_ATTACK_OVERHEAD, BossAttackOverhead);
    this.registerAnimation(AnimationKey.BOSS_ATTACK_SPECIAL_REAP, BossAttackSpecialReap);
    this.registerAnimation(AnimationKey.BOSS_ATTACK_SPECIAL_SKEWER, BossAttackSpecialSkewer);
    for (const animation of HellhoundAnimations) this.registerAnimation(animation.name, animation);

    if (this.baselineAnimations.size === 0) {
      for (const [name, anim] of this.animations.entries()) {
        this.baselineAnimations.set(name, structuredClone(anim));
      }
    }
    this.restoreBaselineAnimations();

    return Promise.resolve();
  }

  static restoreBaselineAnimations() {
    if (this.baselineAnimations.size === 0) return;
    this.animationRevision++;
    this.actorAnimations.clear();
    this._animations.clear();
    for (const [name, baseline] of this.baselineAnimations.entries()) {
      this._animations.set(name, structuredClone(baseline));
    }
  }

  static resetAll() {
    resetEnemyStats();
    resetWeapons();
    this.restoreBaselineAnimations();
  }

  static getSkeleton(id: string): SkeletonDef | undefined {
    return this.skeletons.get(id);
  }

  static getAnimation(
    name: string,
    actor?: { skin?: string; weapon?: string },
  ): Animation | undefined {
    if (actor?.skin && isQuadruped(actor.skin)) {
      const explicit = this.animations.get(name);
      return explicit?.skeletonId === SkeletonKey.QUADRUPED
        ? explicit
        : this.animations.get(`${actor.skin}_${name}`);
    }
    const base = this.animations.get(name);
    const skin = actor?.skin ?? "player",
      weapon = actor?.weapon ?? "longsword";
    if (
      !base ||
      !actor ||
      (skin === "player" && weapon === "longsword") ||
      name.startsWith(skin + "_")
    )
      return base;
    const key = `${skin}:${weapon}:${name}`;
    let variant = this.actorAnimations.get(key);
    if (!variant) {
      variant = animationVariant(base, skin, weapon);
      this.actorAnimations.set(key, variant);
    }
    variant.events = base.events; // Event edits in the viewer retain the same timing source.
    return variant;
  }

  static registerAnimation(name: string, anim: Animation) {
    this.animationRevision++;
    this.actorAnimations.clear();
    anim.events?.sort((a, b) => a.time - b.time);
    this.animations.set(name, anim);
  }

  static clearAnimations() {
    this.animationRevision++;
    this.actorAnimations.clear();
    this.animations.clear();
  }

  static get animations(): Map<string, Animation> {
    return this._animations;
  }
  static set animations(val: Map<string, Animation>) {
    this.animationRevision++;
    this.actorAnimations.clear();
    this._animations = val;
  }
}
