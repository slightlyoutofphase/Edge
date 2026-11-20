import { World } from "../core/World";
import { isBossEnemy } from "../data/EnemyTypes";
import { TriggerComponent } from "../components/Trigger";
import { PlayerProgress, CameraState } from "../core/Resources";
import { aabbIntersects } from "../utils/AABB";
import { HealthComponent } from "../components/Health";
import { LEVELS } from "../data/Levels";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { actorBounds } from "../features/ai/CombatReach";

export class TriggerSystem {
  constructor(private world: World) {}

  update() {
    const players = this.world.query("Transform", "Collider", "PlayerInput");
    if (players.length === 0) return;

    const playerEntity = players[0];
    if (this.world.getComponent<HealthComponent>(playerEntity.id, "Health")?.isDead) return;
    const pRect = actorBounds(this.world, playerEntity.id);
    if (!pRect) return;

    const triggers = this.world.query("Trigger", "Transform", "Collider");

    for (const { id: trigId, components } of triggers) {
      const trigger = components[0] as TriggerComponent;

      if (!trigger.isActive) continue;
      if (trigger.triggered && trigger.oneshot) continue;

      const tRect = actorBounds(this.world, trigId);
      if (!tRect) continue;

      if (aabbIntersects(pRect, tRect)) {
        if (
          trigger.type === "victory" &&
          this.world
            .query("EnemyTag", "Health")
            .some(
              ({ components: [tag, health] }) =>
                isBossEnemy(tag.enemyType) && !(health as HealthComponent).isDead,
            )
        )
          continue;
        this.executeTrigger(trigger, playerEntity.id);
        trigger.triggered = true;

        // Only disable isActive for non-persistent triggers.
        if (trigger.oneshot && trigger.type !== "boss_start") {
          trigger.isActive = false;
        }
      }
    }
  }

  private executeTrigger(trigger: TriggerComponent, playerId: number) {
    switch (trigger.type) {
      case "transition":
        if (
          trigger.targetId &&
          Object.hasOwn(LEVELS, trigger.targetId) &&
          trigger.targetId !== this.world.getResource<PlayerProgress>(PlayerProgress).currentLevelId
        ) {
          console.log(`[Trigger] Transitioning to level: ${trigger.targetId}`);
          const progress = this.world.getResource<PlayerProgress>(PlayerProgress);

          if (progress.transitionState === "none") {
            progress.nextLevelId = trigger.targetId;
            progress.transitionState = "fade-out";
            progress.transitionTimer = 1000;
          }
        }
        break;

      case "victory":
        this.world.getResource<PlayerProgress>(PlayerProgress).isVictory = true;
        this.world.getResource<CameraState>(CameraState).bounds = null;
        break;

      case "boss_start":
        console.log(`[Trigger] Boss Start!`);
        if (trigger.bounds) {
          const camera = this.world.getResource<CameraState>(CameraState);
          camera.bounds = trigger.bounds;
        }

        const enemies = this.world.query("EnemyTag", "AIController");
        for (const enemy of enemies) {
          const tag = enemy.components[0] as any;
          const ai = enemy.components[1] as AIControllerComponent;

          if (isBossEnemy(tag.enemyType)) {
            ai.state = "combat";
            ai.target = playerId; // Ensure AI targets the player immediately
          }
        }
        break;

      case "camera_lock":
        if (trigger.bounds) {
          const camera = this.world.getResource<CameraState>(CameraState);
          camera.bounds = trigger.bounds;
        }
        break;
    }
  }
}
