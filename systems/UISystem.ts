import { World } from "../core/World";
import { HealthComponent } from "../components/Health";
import { TransformComponent } from "../components/Transform";
import { CameraState, TimeState } from "../core/Resources";
import { EnemyTagComponent } from "../components/EnemyTag";
import { isBossEnemy, isQuadruped } from "../data/EnemyTypes";
import { QUADRUPED_HURTBOX } from "../skeleton/data/QuadrupedSkeleton";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { FactionComponent } from "../components/Faction";

export class UISystem {
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(private world: World) {}

  setCanvas(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  update() {
    if (!this.ctx) return;

    const time = this.world.getResource<TimeState>(TimeState);
    const camera = this.world.getResource<CameraState>(CameraState);

    // --- Floating Health Bars (World Space UI) ---
    // We keep this here or move to RenderSystem because it requires world coordinate transformation
    // and synchronizing it with HTML DOM elements is expensive for many moving entities.

    this.ctx.save();
    this.ctx.translate(this.ctx.canvas.width / 2, this.ctx.canvas.height / 2);
    this.ctx.scale(camera.zoom, camera.zoom);
    this.ctx.translate(-camera.position.x, -camera.position.y);

    // Query all entities with Health and Transform
    const entities = this.world.query("Health", "Transform");
    const placedBars: { x: number; y: number; width: number; height: number }[] = [];

    for (const { id, components } of entities) {
      const health = components[0] as HealthComponent;
      const transform = components[1] as TransformComponent;

      // Skip if this entity has PlayerInput (Main HUD handles it via React now)
      if (this.world.hasComponent(id, "PlayerInput")) continue;

      // Skip dead
      if (health.isDead) continue;

      const faction = this.world.getComponent<FactionComponent>(id, "Faction");
      const tag = this.world.getComponent<EnemyTagComponent>(id, "EnemyTag");
      const ai = this.world.getComponent<AIControllerComponent>(id, "AIController");

      // --- VISIBILITY LOGIC ---
      let show = false;
      let barColor = "#d00"; // Default Red

      // 1. Battle Mode Override: If Faction Team is 3 or 4 (Red/Blue), ALWAYS SHOW.
      if (faction && (faction.team === 3 || faction.team === 4)) {
        show = true;
        barColor = faction.team === 3 ? "#ff3333" : "#3333ff";
      }
      // 2. Standard Game Mode: Show if damaged AND not a Boss (Boss has main bar)
      else {
        if (tag && isBossEnemy(tag.enemyType)) continue; // Bosses are handled by the HUD bar.
        if (health.current < health.max) {
          // Fade logic: Check AI lastHitTime
          if (ai) {
            if (time.elapsed - (ai.lastDamageTime ?? -Infinity) < 3000) {
              show = true;
            }
          } else {
            // Fallback for non-AI entities (dummies): Always show if damaged
            show = true;
          }
        }
      }

      if (show) {
        const arena = faction?.team === 3 || faction?.team === 4;
        const unit = arena ? 1 / camera.zoom : 1;
        const barWidth = 60 * unit;
        const barHeight = 8 * unit;
        const border = 2 * unit;
        const x = transform.position.x - barWidth / 2;

        // Height adjustment based on entity type
        let yOffset = 80;
        if (tag) {
          if (isQuadruped(tag.enemyType))
            yOffset = QUADRUPED_HURTBOX.height * transform.scale.y + 14;
          else if (tag.enemyType === "boss" || tag.enemyType === "brute") yOffset = 110;
          else if (tag.enemyType === "hollow") yOffset = 70;
        }
        const anchorY = transform.position.y - yOffset;
        let y = anchorY;
        if (arena) {
          const overlaps = () =>
            placedBars.some(
              (bar) =>
                x - border < bar.x + bar.width + 4 * unit &&
                x + barWidth + border > bar.x &&
                y - border < bar.y + bar.height + 4 * unit &&
                y + barHeight + border > bar.y,
            );
          while (overlaps()) y -= 16 * unit;
          placedBars.push({
            x: x - border,
            y: y - border,
            width: barWidth + border * 2,
            height: barHeight + border * 2,
          });
          if (y !== anchorY) {
            this.ctx.strokeStyle = barColor;
            this.ctx.lineWidth = unit;
            this.ctx.beginPath();
            this.ctx.moveTo(transform.position.x, y + barHeight + border);
            this.ctx.lineTo(transform.position.x, anchorY + barHeight + border);
            this.ctx.stroke();
          }
        }

        // Border/Background
        this.ctx.fillStyle = "#000000";
        this.ctx.fillRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);

        // Fill
        this.ctx.fillStyle = barColor;
        const pct = Math.max(0, health.current / health.max);
        this.ctx.fillRect(x, y, barWidth * pct, barHeight);

        // White Border Outline
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 2 / camera.zoom; // Inverse scale line width
        this.ctx.strokeRect(x - border, y - border, barWidth + border * 2, barHeight + border * 2);
      }
    }
    this.ctx.restore();
  }
}
