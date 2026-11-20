import { beginAnimation } from "../animation/AnimationTransition";
import { World } from "../../core/World";
import { CombatComponent } from "./CombatComponent";
import { TransformComponent } from "../../components/Transform";
import { PlayerInputComponent } from "../../components/PlayerInput";
import { MovementStateComponent } from "../movement/MovementStateComponent";
import { StaminaComponent } from "../../components/Stamina";
import { InputState, CameraState, TimeState } from "../../core/Resources";
import { COMBAT_SETTINGS, PLAYER_STATS } from "../../core/Constants";
import { WEAPONS } from "../../data/WeaponDefinitions";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { InputAction } from "../../core/InputDefinitions";
import { InventoryComponent } from "../../components/Inventory";
import { HealthComponent } from "../../components/Health";
import { AssetLoader } from "../../assets/AssetLoader";
import { createAttackTiming, sampleAttackTiming } from "./AttackTiming";

export class CombatSystem {
  constructor(private world: World) {}

  update() {
    const input = this.world.getResource<InputState>(InputState);
    const camera = this.world.getResource<CameraState>(CameraState);
    const time = this.world.getResource<TimeState>(TimeState);
    const dtMs = time.delta;

    const entities = this.world.query(
      "Combat",
      "Transform",
      "Stamina",
      "MovementState",
      "Animator",
    );

    for (const { id, components } of entities) {
      if (this.world.hasComponent(id, "HitStop")) continue;
      const combat = components[0] as CombatComponent;
      const transform = components[1] as TransformComponent;
      const stamina = components[2] as StaminaComponent;
      const movement = components[3] as MovementStateComponent;
      const animator = components[4] as AnimatorComponent;

      const playerInput = this.world.getComponent<PlayerInputComponent>(id, "PlayerInput");
      const inventory = this.world.getComponent<InventoryComponent>(id, "Inventory");
      const health = this.world.getComponent<HealthComponent>(id, "Health");
      if (health?.isDead || (health && health.current <= 0)) {
        this.resetAttack(combat);
        combat.isBlocking = false;
        this.world.removeComponent(id, "ActiveHitbox");
        if (playerInput) playerInput.buffer = null;
        continue;
      }
      combat.animationDelta = undefined;
      if (
        combat.attackTiming &&
        (combat.attackTiming.animation !== animator.currentAnim ||
          combat.attackTiming.phase !== combat.attackState)
      ) {
        combat.attackTiming = undefined;
        this.world.removeComponent(id, "ActiveHitbox");
      }

      // === 0. Poise Regeneration ===
      if (combat.poise < combat.maxPoise && combat.attackState !== "stagger") {
        combat.poiseRegenTimer -= dtMs;
        if (combat.poiseRegenTimer <= 0) {
          combat.poise = Math.min(combat.maxPoise, combat.poise + (20 * dtMs) / 1000);
        }
      }

      // === 1. Zone Calculation (Player Only) ===
      if (playerInput && combat.attackState === "idle") {
        this.updateZone(transform, input, camera, combat, time.elapsed);
      }

      // === 2. Blocking Logic (Player Only) ===
      if (playerInput) {
        const wantsBlock = input.isActionDown(InputAction.BLOCK);
        const canBlock =
          !stamina.isExhausted &&
          stamina.current > 0 &&
          combat.attackState === "idle" &&
          (movement.current === "idle" ||
            movement.current === "walk" ||
            movement.current === "crouch");

        if (wantsBlock && canBlock) {
          combat.isBlocking = true;
          combat.blockZone = combat.attackZone;
          stamina.regenPaused = true;
        } else {
          combat.isBlocking = false;
        }
      }

      // === 3. Counter Window Logic ===
      if (combat.counterWindowActive) {
        combat.counterWindowTimer -= dtMs;
        if (combat.counterWindowTimer <= 0) {
          combat.counterWindowActive = false;
        }
      }

      // === 4. Parry Input (Player Only) ===
      if (playerInput) {
        const wantsParry = input.isActionPressed(InputAction.PARRY);
        const canParry =
          combat.attackState === "idle" &&
          !combat.isBlocking &&
          !stamina.isExhausted &&
          stamina.current >= PLAYER_STATS.parryCost;

        if (wantsParry && canParry) {
          stamina.current -= PLAYER_STATS.parryCost;
          combat.attackState = "parry";
          // "Player Privilege": 12 frames (200ms) instead of 6
          combat.attackTimer = 12 * 16.66;
          beginAnimation(animator, "parry");

          if (animator.eventState) animator.eventState.delete("main_parry");

          // BYPASS HYSTERESIS: Force immediate zone update on parry start
          this.updateZone(transform, input, camera, combat, time.elapsed, true);
        }
      }

      // === 5. Combat State Machine ===
      if (stamina.isExhausted) {
        combat.isBlocking = false;
      }

      switch (combat.attackState) {
        case "idle":
          if (playerInput) {
            if (
              !combat.isBlocking &&
              !stamina.isExhausted &&
              movement.current !== "roll" &&
              movement.current !== "backstep" &&
              movement.current !== "climb" &&
              !(movement.aerialLandingRecovery && movement.aerialLandingRecovery > 0)
            ) {
              this.checkAttackInput(
                combat,
                playerInput,
                stamina,
                animator,
                movement.current === "slide",
                inventory,
                movement.current === "jump" || movement.current === "fall",
              );
              if ((combat.attackState as string) === "windup")
                this.advanceAttack(combat, animator, inventory, 0);
            }
          }
          break;

        case "windup":
          if (movement.current === "roll") {
            this.resetAttack(combat);
            break;
          }
          this.advanceAttack(combat, animator, inventory, dtMs);
          break;

        case "active":
          this.advanceAttack(combat, animator, inventory, dtMs);
          break;

        case "recovery":
          stamina.regenPaused = true;
          if (movement.current === "roll") {
            this.resetAttack(combat);
            break;
          }
          if (combat.attackTiming) this.advanceAttack(combat, animator, inventory, dtMs);
          else {
            combat.attackTimer -= dtMs;
            if (combat.attackTimer <= 0) this.resetAttack(combat);
          }
          break;

        case "parry":
          combat.attackTimer -= dtMs;
          if (combat.attackTimer <= 0) {
            combat.attackState = "recovery";
            // Recovery frames for whiffed parry
            combat.attackTimer = 20 * 16.66;
          }
          break;

        case "stagger":
          combat.attackTimer -= dtMs;
          stamina.regenPaused = true;
          if (combat.attackTimer <= 0) {
            combat.attackState = "idle";
            combat.staggerType = null;
          }
          break;
      }

      if (combat.attackState === "idle" && !combat.isBlocking) {
        stamina.regenPaused = false;
      }
    }
  }

  private updateZone(
    transform: TransformComponent,
    input: InputState,
    camera: CameraState,
    combat: CombatComponent,
    time: number,
    force: boolean = false,
  ) {
    const screenCenterX = camera.viewport.x / 2;
    const screenCenterY = camera.viewport.y / 2;

    const mouseWorldX = (input.mousePosition.x - screenCenterX) / camera.zoom + camera.position.x;
    const mouseWorldY = (input.mousePosition.y - screenCenterY) / camera.zoom + camera.position.y;

    const dx = (mouseWorldX - transform.position.x) * transform.facing;
    const dy = mouseWorldY - transform.position.y;

    if (!force && time - combat.lastZoneChangeTime < COMBAT_SETTINGS.zoneHysteresis) {
      return;
    }

    let newZone = combat.attackZone;

    if (combat.attackZone === 0) {
      if (dx > COMBAT_SETTINGS.guardExitThreshold) {
        newZone = this.calculateAngleZone(dx, dy);
      }
    } else {
      if (dx < COMBAT_SETTINGS.guardEnterThreshold) {
        newZone = 0;
      } else {
        newZone = this.calculateAngleZone(dx, dy);
      }
    }

    if (newZone !== combat.attackZone) {
      combat.attackZone = newZone;
      combat.lastZoneChangeTime = time;
    }
  }

  private calculateAngleZone(dx: number, dy: number): 1 | 2 | 3 {
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angleDeg < -30) return 1;
    if (angleDeg > 30) return 3;
    return 2;
  }

  private checkAttackInput(
    combat: CombatComponent,
    input: PlayerInputComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    isSliding: boolean,
    inventory?: InventoryComponent,
    isAirborne = false,
  ) {
    const buffer = input.buffer;

    // Resolve Weapon
    const weaponId = inventory ? inventory.currentWeapon : "longsword";
    const weapon = WEAPONS[weaponId] || WEAPONS["longsword"];

    if (
      isSliding &&
      buffer &&
      (buffer.action === "lightAttack" || buffer.action === "heavyAttack")
    ) {
      const isHeavy = buffer.action === "heavyAttack";
      const cost = isHeavy ? weapon.staminaCostHeavy : weapon.staminaCostLight;

      if (stamina.current >= cost) {
        this.initiateAttack(combat, stamina, animator, "slide", isHeavy, weaponId);
        input.buffer = null;
      }
      return;
    }

    if (!buffer) return;

    if (isAirborne && (buffer.action === "lightAttack" || buffer.action === "heavyAttack")) {
      const heavy = buffer.action === "heavyAttack";
      if (stamina.current >= (heavy ? weapon.staminaCostHeavy : weapon.staminaCostLight)) {
        this.initiateAttack(combat, stamina, animator, "jump", heavy, weaponId);
        input.buffer = null;
      }
      return;
    }

    if (buffer.action === "lightAttack") {
      if (stamina.current >= weapon.staminaCostLight) {
        this.initiateAttack(combat, stamina, animator, "light", false, weaponId);
        input.buffer = null;
      }
    } else if (buffer.action === "heavyAttack") {
      if (stamina.current >= weapon.staminaCostHeavy) {
        this.initiateAttack(combat, stamina, animator, "heavy", false, weaponId);
        input.buffer = null;
      }
    }
  }

  private initiateAttack(
    combat: CombatComponent,
    stamina: StaminaComponent,
    animator: AnimatorComponent,
    type: "light" | "heavy" | "slide" | "jump",
    isSlideHeavy: boolean = false,
    weaponId: string = "longsword",
  ) {
    const weapon = WEAPONS[weaponId] || WEAPONS["longsword"];
    const zones = { 0: "mid", 1: "high", 2: "mid", 3: "low" };

    combat.attackState = "windup";
    combat.attackSerial = (combat.attackSerial ?? 0) + 1;
    combat.attackTiming = undefined;
    combat.isHeavyAttack = type === "heavy" || isSlideHeavy;
    combat.attackType = type as any;

    let anticipation = 0;
    let cost = 0;
    let animName = "";

    if (type === "jump") {
      const timing = isSlideHeavy ? weapon.heavyAttack : weapon.lightAttack;
      anticipation = timing.anticipation;
      cost = isSlideHeavy ? weapon.staminaCostHeavy : weapon.staminaCostLight;
      animName = isSlideHeavy ? "jump_attack_heavy" : "jump_attack";
      combat.attackZone = 2;
    } else if (type === "slide") {
      anticipation = isSlideHeavy ? 6 : 4;
      cost = isSlideHeavy ? weapon.staminaCostHeavy : weapon.staminaCostLight;
      animName = isSlideHeavy ? "slide_attack_heavy" : "slide_attack";
    } else if (type === "heavy") {
      anticipation = weapon.heavyAttack.anticipation;
      cost = weapon.staminaCostHeavy;
      animName = `heavy_attack_${zones[combat.attackZone]}`;
    } else {
      anticipation = weapon.lightAttack.anticipation;
      cost = weapon.staminaCostLight;
      animName = `light_attack_${zones[combat.attackZone]}`;
    }

    stamina.current -= cost;
    combat.attackTimer = (anticipation / 60) * 1000;

    beginAnimation(animator, animName);

    if (animator.eventState) {
      animator.eventState.delete(`main_${animName}`);
    }
  }

  private advanceAttack(
    combat: CombatComponent,
    animator: AnimatorComponent,
    inventory: InventoryComponent | undefined,
    dt: number,
  ) {
    if (!combat.attackTiming) {
      const anim = AssetLoader.getAnimation(animator.currentAnim);
      const weapon = inventory
        ? WEAPONS[inventory.currentWeapon] || WEAPONS["longsword"]
        : undefined;
      combat.attackTiming = anim
        ? createAttackTiming(
            anim,
            combat.attackTimer,
            combat.attackType,
            !!combat.isHeavyAttack,
            weapon,
          )
        : undefined;
      if (!combat.attackTiming) {
        combat.attackTimer -= dt;
        if (combat.attackTimer <= 0) {
          if (combat.attackState === "windup") this.enterActive(combat, inventory);
          else if (combat.attackState === "active") this.enterRecovery(combat, inventory);
          else this.resetAttack(combat);
        }
        return;
      }
      combat.attackTiming.animation = animator.currentAnim;
    }
    const attack = combat.attackTiming;
    const total = attack.windup + attack.active + attack.recovery;
    if (attack.elapsed >= total) {
      this.resetAttack(combat);
      return;
    }
    attack.elapsed = Math.min(total, attack.elapsed + dt);
    const sample = sampleAttackTiming(attack, attack.elapsed);
    combat.attackState = sample.phase;
    combat.attackTimer = sample.remaining;
    attack.phase = combat.attackState;
    combat.animationDelta = Math.max(0, sample.time - animator.time);
  }

  private enterActive(combat: CombatComponent, inventory?: InventoryComponent) {
    combat.attackState = "active";
    const weaponId = inventory ? inventory.currentWeapon : "longsword";
    const weapon = WEAPONS[weaponId] || WEAPONS["longsword"];

    if (combat.attackType === "slide") {
      combat.attackTimer = (4 / 60) * 1000;
    } else if (combat.attackType === "heavy") {
      combat.attackTimer = (weapon.heavyAttack.active / 60) * 1000;
    } else {
      combat.attackTimer = (weapon.lightAttack.active / 60) * 1000;
    }
  }

  private enterRecovery(combat: CombatComponent, inventory?: InventoryComponent) {
    combat.attackState = "recovery";
    const weaponId = inventory ? inventory.currentWeapon : "longsword";
    const weapon = WEAPONS[weaponId] || WEAPONS["longsword"];

    if (combat.attackType === "slide") {
      combat.attackTimer = (14 / 60) * 1000;
    } else if (combat.attackType === "heavy") {
      combat.attackTimer = (weapon.heavyAttack.recovery / 60) * 1000;
    } else {
      combat.attackTimer = (weapon.lightAttack.recovery / 60) * 1000;
    }
  }

  private resetAttack(combat: CombatComponent) {
    combat.attackState = "idle";
    combat.attackTiming = undefined;
    combat.animationDelta = undefined;
    combat.attackType = null;
    combat.attackTimer = 0;
  }
}
