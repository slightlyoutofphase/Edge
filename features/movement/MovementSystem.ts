import { World } from "../../core/World";
import { MovementStateComponent } from "./MovementStateComponent";
import { PhysicsComponent } from "./PhysicsComponent";
import { TransformComponent } from "../../components/Transform";
import { InputState, TimeState } from "../../core/Resources";
import { PlayerInputComponent } from "../../components/PlayerInput";
import { ColliderComponent } from "../../components/Collider";
import { StaminaComponent } from "../../components/Stamina";
import { HealthComponent } from "../../components/Health";
import { CombatComponent } from "../combat/CombatComponent";
import { PlatformComponent } from "../../components/Platform";
import { PLAYER_STATS } from "../../core/Constants";
import { SoundRequestComponent } from "../../components/SoundRequest";
import { SpawnEffectComponent } from "../../components/SpawnEffect";
import { aabbIntersects } from "../../utils/AABB";
import { InputAction } from "../../core/InputDefinitions";
import { AnimatorComponent } from "../animation/AnimatorComponent";
import { AssetLoader } from "../../assets/AssetLoader";

export class MovementSystem {
  constructor(private world: World) {}

  update() {
    const time = this.world.getResource<TimeState>(TimeState);
    const input = this.world.getResource<InputState>(InputState);

    const entities = this.world.query(
      "MovementState",
      "Physics",
      "Transform",
      "Collider",
      "Stamina",
      "Health",
      "Combat",
    );
    const ladders = this.world
      .query("Platform", "Collider", "Transform")
      .filter((e) => (e.components[0] as PlatformComponent).type === "ladder");

    const dtMs = time.delta;

    for (const { id, components } of entities) {
      const state = components[0] as MovementStateComponent;
      const physics = components[1] as PhysicsComponent;
      const transform = components[2] as TransformComponent;
      const collider = components[3] as ColliderComponent;
      const stamina = components[4] as StaminaComponent;
      const health = components[5] as HealthComponent;
      const combat = components[6] as CombatComponent;

      const playerInput = this.world.getComponent<PlayerInputComponent>(id, "PlayerInput");

      if (health.isDead || this.world.hasComponent(id, "HitStop")) continue;
      const impactControl = (physics.impactControlMs ?? 0) > 0;
      physics.impactControlMs = Math.max(0, (physics.impactControlMs ?? 0) - dtMs);

      // Detect Landing
      state.landingTimer = Math.max(0, (state.landingTimer ?? 0) - dtMs);
      state.aerialLandingRecovery = Math.max(0, (state.aerialLandingRecovery ?? 0) - dtMs);
      if (
        !physics.grounded &&
        combat.attackType === "jump" &&
        (combat.attackState === "windup" || combat.attackState === "active")
      )
        state.aerialAttackLanding = combat.isHeavyAttack ? 160 : 90;
      if (physics.grounded && !state.previousGrounded) {
        this.addSound(id, "land");
        state.landingTimer = 250;
        if (state.aerialAttackLanding) {
          state.aerialLandingRecovery = state.aerialAttackLanding;
          state.aerialAttackLanding = undefined;
        }
        if (combat.attackType === "jump" && combat.attackTiming) {
          const attack = combat.attackTiming;
          // Landing closes airborne damage and enters the weapon's existing
          // recovery. Roll cancellation and later input buffering still work.
          if (attack.elapsed < attack.windup + attack.active) {
            attack.elapsed = attack.windup + attack.active;
            attack.phase = "recovery";
            combat.attackState = "recovery";
            combat.attackTimer = attack.recovery;
            combat.animationDelta = 0;
            this.world.removeComponent(id, "ActiveHitbox");
            const animator = this.world.getComponent<AnimatorComponent>(id, "Animator");
            if (animator) {
              animator.time = attack.hitEnd;
              const events = AssetLoader.getAnimation(animator.currentAnim)?.events ?? [];
              let last = -1;
              for (let i = 0; i < events.length; i++)
                if (events[i].time * attack.duration <= attack.hitEnd) last = i;
              animator.eventState.set(`main_${animator.currentAnim}`, last);
            }
          }
        }
      }

      // === 1. Timers (Universal) ===
      if (physics.grounded) {
        state.coyoteTimer = PLAYER_STATS.coyoteTime;
        state.previousGrounded = true;
      } else {
        state.previousGrounded = false;
        state.coyoteTimer = Math.max(0, state.coyoteTimer - dtMs);
      }

      state.slideTimer = Math.max(0, state.slideTimer - dtMs);
      state.slideCooldown = Math.max(0, state.slideCooldown - dtMs);
      state.rollTimer = Math.max(0, state.rollTimer - dtMs);
      state.backstepTimer = Math.max(0, state.backstepTimer - dtMs);
      state.jumpBufferTimer = Math.max(0, state.jumpBufferTimer - dtMs);
      state.dropThroughTimer = Math.max(0, state.dropThroughTimer - dtMs);
      health.invulnTimer = Math.max(0, health.invulnTimer - dtMs);

      // Motion Blur for Roll
      if (state.current === "roll" && state.rollTimer % 100 < 20) {
        this.spawnEffect("motion_blur", transform.position, { x: 0, y: 0 });
      }

      // === 2. Input Processing (Player Only) ===
      let moveLeft = false;
      let moveRight = false;

      let moveDown = false;
      let run = false;
      let attemptJump = false;
      let attemptRoll = false;
      let attemptSlide = false;
      let attemptBackstep = false;

      const isAttacking =
        combat.attackState === "windup" ||
        combat.attackState === "active" ||
        combat.attackState === "recovery";
      const isLockedAnimation =
        state.rollTimer > 0 || state.backstepTimer > 0 || state.slideTimer > 0;

      // Authored attack motion is physical, so walls, gravity, landing, hitstop
      // and stagger still govern pounces/charges. It launches once per attack.
      const animator = this.world.getComponent<AnimatorComponent>(id, "Animator");
      const clip =
        animator && isAttacking ? AssetLoader.getAnimation(animator.currentAnim) : undefined;
      const attack = combat.attackTiming;
      const motion = clip?.motion;
      const clipTime = animator ? animator.time + (combat.animationDelta ?? 0) : 0;
      if (
        clip &&
        motion &&
        attack &&
        clipTime >= motion.start * clip.duration &&
        clipTime < motion.end * clip.duration
      ) {
        if (!attack.motionStarted) {
          attack.motionStarted = true;
          if (motion.lift && physics.grounded) {
            physics.velocity.y = -motion.lift;
            physics.grounded = false;
          }
        }
        physics.velocity.x = transform.facing * motion.speed;
      }

      if (playerInput) {
        // ATTACK COMMITMENT: Disable movement inputs during attack
        // Exception: Roll is allowed (handled by buffer priority later)
        if (!isAttacking && !isLockedAnimation) {
          moveLeft = input.isActionDown(InputAction.MOVE_LEFT);
          moveRight = input.isActionDown(InputAction.MOVE_RIGHT);

          moveDown = input.isActionDown(InputAction.CROUCH);
          run = input.isActionDown(InputAction.RUN);
        } else if (isAttacking && physics.grounded && !impactControl) {
          physics.velocity.x *= 0.8;
        }

        attemptJump = playerInput.buffer?.action === "jump";
        attemptRoll = playerInput.buffer?.action === "roll";
        attemptSlide = input.isActionPressed(InputAction.SLIDE);
        attemptBackstep = input.isActionPressed(InputAction.BACKSTEP);
      }

      // --- LADDER LOGIC ---
      let touchingLadder = false;
      let ladderX = 0;

      if (playerInput) {
        const playerRect = {
          x: transform.position.x + collider.hurtboxes[0].x,
          y: transform.position.y + collider.hurtboxes[0].y,
          width: collider.hurtboxes[0].width,
          height: collider.hurtboxes[0].height,
        };

        for (const lad of ladders) {
          const lTrans = lad.components[2] as TransformComponent;
          const lCol = lad.components[1] as ColliderComponent;
          const lRect = {
            x: lTrans.position.x + lCol.hurtboxes[0].x,
            y: lTrans.position.y + lCol.hurtboxes[0].y,
            width: lCol.hurtboxes[0].width,
            height: lCol.hurtboxes[0].height,
          };

          if (aabbIntersects(playerRect, lRect)) {
            touchingLadder = true;
            ladderX = lRect.x + lRect.width / 2;
            state.ladderTop = lRect.y;
            state.ladderCenter = ladderX;
            break;
          }
        }

        if (state.current === "climb") {
          physics.velocity.y = 0;
          physics.velocity.x = 0;

          if (attemptJump) {
            state.current = "jump";
            playerInput.buffer = null;
            if (input.isActionDown(InputAction.MOVE_LEFT)) {
              physics.velocity.x = -150;
              physics.velocity.y = -PLAYER_STATS.jumpForce * 0.8;
            } else if (input.isActionDown(InputAction.MOVE_RIGHT)) {
              physics.velocity.x = 150;
              physics.velocity.y = -PLAYER_STATS.jumpForce * 0.8;
            } else {
              physics.velocity.y = -PLAYER_STATS.jumpForce * 0.5;
            }
          } else if (!touchingLadder) {
            state.current = "fall";
          } else {
            if (input.isActionDown(InputAction.MOVE_UP)) physics.velocity.y = -100;
            if (input.isActionDown(InputAction.MOVE_DOWN)) physics.velocity.y = 100;
            transform.position.x += (ladderX - transform.position.x) * 0.2;
          }
          continue;
        } else {
          if (
            touchingLadder &&
            input.isActionDown(InputAction.MOVE_UP) &&
            state.current !== "jump"
          ) {
            state.current = "climb";
            physics.velocity.x = 0;
            continue;
          }
        }
      }

      // --- GROUND MOVEMENT ---

      if (playerInput && !isAttacking && !isLockedAnimation) {
        if (moveLeft && !moveRight) transform.facing = -1;
        if (moveRight && !moveLeft) transform.facing = 1;
      }

      let reduceHitbox = false;

      if (isLockedAnimation) {
        physics.impactControlMs = 0;
        if (state.rollTimer > 0) {
          state.current = "roll";
          physics.impactControlMs = 0;
          const rollDir = state.rollDirection ?? transform.facing;
          physics.velocity.x =
            rollDir * (PLAYER_STATS.rollDistance / (PLAYER_STATS.rollDuration / 1000));
        } else if (state.backstepTimer > 0) {
          state.current = "backstep";
          physics.impactControlMs = 0;
          physics.velocity.x =
            -transform.facing *
            (PLAYER_STATS.backstepDistance / (PLAYER_STATS.backstepDuration / 1000));
        } else if (state.slideTimer > 0) {
          state.current = "slide";
          physics.impactControlMs = 0;
          reduceHitbox = true;
          physics.velocity.x =
            transform.facing * (PLAYER_STATS.slideDistance / (PLAYER_STATS.slideDuration / 1000));
        }
      } else {
        if (state.current === "roll" || state.current === "backstep" || state.current === "slide") {
          state.current = state.current === "slide" ? "crouch" : "idle";
          state.rollDirection = undefined;
          if (!playerInput) physics.velocity.x = 0;
        }
        if (
          attemptRoll &&
          physics.grounded &&
          !stamina.isExhausted &&
          stamina.current >= PLAYER_STATS.rollStaminaCost
        ) {
          state.current = "roll";
          state.rollTimer = PLAYER_STATS.rollDuration;
          stamina.current -= PLAYER_STATS.rollStaminaCost;
          health.invulnTimer = 200;
          physics.impactControlMs = 0;

          let rollDir: -1 | 1 = transform.facing;
          if (playerInput) {
            const rawLeft =
              playerInput.buffer?.moveLeft ?? input.isActionDown(InputAction.MOVE_LEFT);
            const rawRight =
              playerInput.buffer?.moveRight ?? input.isActionDown(InputAction.MOVE_RIGHT);
            const forwardsHeld =
              transform.facing === 1 ? rawRight && !rawLeft : rawLeft && !rawRight;
            rollDir = forwardsHeld ? transform.facing : (-transform.facing as -1 | 1);
            state.rollDirection = rollDir;
          } else {
            state.rollDirection = undefined;
          }

          physics.velocity.x =
            rollDir * (PLAYER_STATS.rollDistance / (PLAYER_STATS.rollDuration / 1000));

          if (playerInput) playerInput.buffer = null;
          this.spawnEffect("dust", transform.position, { x: 0, y: -1 });
        } else if (
          attemptBackstep &&
          physics.grounded &&
          !stamina.isExhausted &&
          stamina.current >= PLAYER_STATS.backstepStaminaCost
        ) {
          state.current = "backstep";
          state.backstepTimer = PLAYER_STATS.backstepDuration;
          stamina.current -= PLAYER_STATS.backstepStaminaCost;
          health.invulnTimer = 100;
          physics.velocity.x =
            -transform.facing *
            (PLAYER_STATS.backstepDistance / (PLAYER_STATS.backstepDuration / 1000));
        } else if (
          attemptSlide &&
          physics.grounded &&
          Math.abs(physics.velocity.x) > 1 &&
          state.slideCooldown <= 0 &&
          !stamina.isExhausted &&
          stamina.current >= PLAYER_STATS.slideStaminaCost
        ) {
          state.current = "slide";
          state.slideTimer = PLAYER_STATS.slideDuration;
          state.slideCooldown = PLAYER_STATS.slideCooldown + PLAYER_STATS.slideDuration;
          stamina.current -= PLAYER_STATS.slideStaminaCost;
          const slideSpeed = PLAYER_STATS.slideDistance / (PLAYER_STATS.slideDuration / 1000);
          physics.velocity.x = transform.facing * slideSpeed;

          reduceHitbox = true;
          this.spawnEffect("dust", transform.position, { x: 0, y: -1 });
        } else if (
          attemptJump &&
          !isAttacking &&
          !(state.aerialLandingRecovery && state.aerialLandingRecovery > 0)
        ) {
          if (moveDown && physics.grounded) {
            state.dropThroughTimer = 200;
            state.current = "fall";
            if (playerInput) playerInput.buffer = null;
            physics.grounded = false;
            physics.velocity.y = 100;
          } else if (physics.grounded || state.coyoteTimer > 0) {
            physics.velocity.y = -PLAYER_STATS.jumpForce;
            state.coyoteTimer = 0;
            physics.grounded = false;
            state.current = "jump";
            if (playerInput) playerInput.buffer = null;
          }
        } else if (
          playerInput &&
          state.current === "jump" &&
          input.isActionDown(InputAction.JUMP) &&
          physics.velocity.y < 0
        ) {
          physics.velocity.y -= PLAYER_STATS.jumpHoldBonus * (dtMs / 1000);
        } else {
          if (playerInput) {
            let targetSpeed = 0;
            if (moveLeft) targetSpeed -= 1;
            if (moveRight) targetSpeed += 1;

            let speed = PLAYER_STATS.walkSpeed;

            if (moveDown) {
              speed = PLAYER_STATS.crouchSpeed;
              reduceHitbox = true;
            } else if (run && !stamina.isExhausted) {
              speed = PLAYER_STATS.runSpeed;
              if (moveLeft || moveRight) {
                stamina.current -= PLAYER_STATS.runStaminaCostPerSec * (dtMs / 1000);
              }
            }

            if (!impactControl && targetSpeed !== 0) {
              physics.velocity.x = targetSpeed * speed;
            } else if (!impactControl) {
              physics.velocity.x = 0;
            }
          }

          if (!physics.grounded) {
            state.current = physics.velocity.y < 0 ? "jump" : "fall";
          } else {
            if (playerInput && moveDown) {
              state.current = Math.abs(physics.velocity.x) > 10 ? "crouchWalk" : "crouch";
            } else {
              if (Math.abs(physics.velocity.x) > 10) {
                state.current =
                  Math.abs(physics.velocity.x) > PLAYER_STATS.runSpeed * 0.8 ? "run" : "walk";
              } else {
                state.current = "idle";
              }
            }
          }
        }
      }

      if (reduceHitbox) {
        if (collider.hurtboxes[0]) {
          collider.hurtboxes[0].height = 38;
          collider.hurtboxes[0].y = -38;
        }
      } else {
        if (collider.hurtboxes[0]) {
          const height = clip?.bodyHeight ?? collider.standingHeight ?? 64;
          collider.hurtboxes[0].height = height;
          collider.hurtboxes[0].y = -height;
        }
      }

      if (
        state.current !== "run" &&
        state.current !== "roll" &&
        state.current !== "slide" &&
        !combat.isBlocking &&
        combat.attackState === "idle"
      ) {
        stamina.current = Math.min(
          stamina.max,
          stamina.current + PLAYER_STATS.staminaRegen * (dtMs / 1000),
        );
      }

      if (stamina.current <= 0) {
        stamina.isExhausted = true;
        stamina.current = 0;
      }
      if (stamina.isExhausted && stamina.current > 30) {
        stamina.isExhausted = false;
      }
    }
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
    direction: { x: number; y: number },
  ) {
    const id = this.world.createEntity();
    this.world.addComponent(id, "SpawnEffect", {
      type: type,
      position: { ...position },
      direction: direction,
    } as SpawnEffectComponent);
  }
}
