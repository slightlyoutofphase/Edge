import { World } from "../core/World";
import { isBossEnemy } from "../data/EnemyTypes";
import { CameraState, TimeState, BattleState } from "../core/Resources";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { CAMERA } from "../core/Constants";
import { lerp, clamp } from "../utils/Math";
import { TriggerComponent } from "../components/Trigger";
import { aabbIntersects } from "../utils/AABB";
import { HealthComponent } from "../components/Health";
import { actorBounds } from "../features/ai/CombatReach";

export class CameraSystem {
  constructor(private world: World) {}

  update() {
    const camera = this.world.getResource<CameraState>(CameraState);

    // In manual mode (Editor), skip logic updates, just update viewport rect
    if (camera.isManual) {
      // Still apply viewport size
      // We assume position is set externally
      return;
    }

    const time = this.world.getResource<TimeState>(TimeState);
    const dt = time.delta / 1000;
    const dtMs = time.delta;
    const arena = this.world.getResource<BattleState>(BattleState)?.isActive ?? false;

    // --- Shake Decay ---
    if (camera.shake.duration > 0) {
      camera.shake.elapsed += dtMs;
      if (camera.shake.elapsed >= camera.shake.duration) {
        camera.shake.amplitude = 0;
        camera.shake.duration = 0;
      } else {
        camera.shake.amplitude = Math.max(
          0,
          camera.shake.amplitude -
            camera.shake.amplitude * (dtMs / (camera.shake.duration - camera.shake.elapsed + dtMs)),
        );
      }
    }

    const players = this.world.query("Transform", "Physics", "PlayerInput", "Collider");

    let desiredX = camera.position.x;
    let desiredY = camera.position.y;
    let spectatorBounds: { minX: number; maxX: number; minY: number; maxY: number } | undefined;

    if (players.length > 0) {
      // === PLAYER TRACKING MODE ===
      const playerTransform = players[0].components[0] as TransformComponent;
      const playerPhysics = players[0].components[1] as PhysicsComponent;

      // --- Trigger Checks (Camera Locks & POI) ---
      const triggers = this.world.query("Trigger", "Transform", "Collider");
      const pRect = actorBounds(this.world, players[0].id);

      camera.pointOfInterest = null; // Reset POI

      if (pRect) {
        for (const { id: trigId, components } of triggers) {
          const trig = components[0] as TriggerComponent;
          const tRect = actorBounds(this.world, trigId);
          if (!tRect) continue;

          if (aabbIntersects(pRect, tRect)) {
            if (trig.type === "camera_lock" || trig.type === "boss_start") {
              if (trig.bounds) {
                camera.bounds = trig.bounds;
              }
            }
            // Boss Framing
            if (trig.type === "boss_start") {
              const bosses = this.world.query("EnemyTag", "Transform", "Health");
              for (const b of bosses) {
                const tag = b.components[0] as any;
                if (isBossEnemy(tag.enemyType)) {
                  const bTrans = b.components[1] as TransformComponent;
                  const bHealth = b.components[2] as HealthComponent;
                  if (!bHealth.isDead) {
                    camera.pointOfInterest = { x: bTrans.position.x, y: bTrans.position.y };
                  }
                }
              }
            }
          }
        }
      }

      // --- Dead Zone Logic ---
      let targetBaseX = camera.targetPosition.x;
      let targetBaseY = camera.targetPosition.y;

      const dx = playerTransform.position.x - targetBaseX;
      const dy = playerTransform.position.y - targetBaseY;

      const deadZoneHalf = CAMERA.deadZoneSize / 2;

      if (Math.abs(dx) > deadZoneHalf) {
        targetBaseX += dx - Math.sign(dx) * deadZoneHalf;
      }
      if (Math.abs(dy) > deadZoneHalf) {
        targetBaseY += dy - Math.sign(dy) * deadZoneHalf;
      }

      camera.targetPosition.x = targetBaseX;
      camera.targetPosition.y = targetBaseY;

      // --- Look Ahead Logic (Damped) ---
      const targetLookAheadX = playerPhysics.velocity.x * 0.4;
      const lookAheadFactor = 1.0 - Math.exp(-2.0 * dt);
      camera.lookAhead.x = lerp(camera.lookAhead.x, targetLookAheadX, lookAheadFactor);

      desiredX = camera.targetPosition.x + camera.lookAhead.x;
      desiredY = camera.targetPosition.y;

      // --- Framing POI ---
      if (camera.pointOfInterest) {
        // Blend player target with POI (60% Player, 40% POI)
        const poiBlend = 0.4;
        desiredX = lerp(desiredX, camera.pointOfInterest.x, poiBlend);
        desiredY = lerp(desiredY, camera.pointOfInterest.y, poiBlend);
      }
    } else {
      // === BATTLE MODE / AI SPECTATOR ===
      // When no player is present, track the center of all active combatants
      const fighters = this.world.query("Transform", "Health", "AIController");

      if (fighters.length > 0) {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;

        for (const { components } of fighters) {
          const t = components[0] as TransformComponent;
          const h = components[1] as HealthComponent;
          if (!h.isDead) {
            sumX += t.position.x;
            sumY += t.position.y;
            count++;
            minX = Math.min(minX, t.position.x - 100 * Math.abs(t.scale.x));
            maxX = Math.max(maxX, t.position.x + 100 * Math.abs(t.scale.x));
            minY = Math.min(minY, t.position.y - 150 * t.scale.y);
            maxY = Math.max(maxY, t.position.y + 40);
          }
        }

        if (count > 0) {
          const centerX = arena ? (minX + maxX) / 2 : sumX / count;
          const centerY = arena ? (minY + maxY) / 2 : sumY / count;
          if (arena) {
            spectatorBounds = { minX, maxX, minY, maxY };
            const targetZoom = Math.min(
              3,
              camera.viewport.x / (maxX - minX + 80),
              camera.viewport.y / (maxY - minY + 80),
            );
            // Zoom out immediately to retain fighters; zoom in gently as they converge.
            const zoomFactor = 1 - Math.exp(-2 * dt);
            camera.zoom =
              targetZoom < camera.zoom ? targetZoom : lerp(camera.zoom, targetZoom, zoomFactor);
          }

          // Smoothly pan to the center of action
          const panFactor = arena ? 1 - Math.exp(-3 * dt) : dt * 3.0;
          camera.targetPosition.x = lerp(camera.targetPosition.x, centerX, panFactor);
          camera.targetPosition.y = lerp(camera.targetPosition.y, centerY, panFactor);

          desiredX = camera.targetPosition.x;
          desiredY = camera.targetPosition.y;
        }
      }
    }

    // --- Main Camera Lerp ---
    const factor = 1.0 - Math.exp(-CAMERA.lerpSpeed * dt);

    camera.position.x = lerp(camera.position.x, desiredX, factor);
    camera.position.y = lerp(camera.position.y, desiredY, factor);

    // --- Bounds ---
    if (camera.bounds && !arena) {
      // Calculate viewport size in world units
      const viewportHalfW = camera.viewport.x / camera.zoom / 2;
      const viewportHalfH = camera.viewport.y / camera.zoom / 2;

      const minX = camera.bounds.min.x + viewportHalfW;
      const maxX = camera.bounds.max.x - viewportHalfW;
      const minY = camera.bounds.min.y + viewportHalfH;
      const maxY = camera.bounds.max.y - viewportHalfH;

      // Check if bounds are smaller than viewport (center if so)
      if (minX < maxX) camera.position.x = clamp(camera.position.x, minX, maxX);
      else camera.position.x = (camera.bounds.min.x + camera.bounds.max.x) / 2;

      if (minY < maxY) camera.position.y = clamp(camera.position.y, minY, maxY);
      else camera.position.y = (camera.bounds.min.y + camera.bounds.max.y) / 2;
    }

    if (spectatorBounds) {
      // Keep the padded fighters visible while panning, including fights at arena edges.
      const halfW = camera.viewport.x / camera.zoom / 2;
      const halfH = camera.viewport.y / camera.zoom / 2;
      camera.position.x = clamp(
        camera.position.x,
        spectatorBounds.maxX - halfW,
        spectatorBounds.minX + halfW,
      );
      camera.position.y = clamp(
        camera.position.y,
        spectatorBounds.maxY - halfH,
        spectatorBounds.minY + halfH,
      );
    }
  }
}
