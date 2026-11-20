import { World } from "../core/World";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { TransformComponent } from "../components/Transform";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { ColliderComponent } from "../components/Collider";
import { DEBUG } from "./DebugFlags";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { CombatComponent } from "../features/combat/CombatComponent";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";

export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  skeleton: SkeletonComponent,
  transform: TransformComponent,
): void {
  if (!DEBUG.DRAW_SKELETONS && !DEBUG.DRAW_PIVOTS) return;

  ctx.save();
  ctx.translate(transform.position.x, transform.position.y);
  ctx.scale(transform.facing * transform.scale.x, transform.scale.y);

  // Flatten map for iteration if needed, or iterate directly
  for (const [boneId, worldMatrix] of skeleton.worldTransforms) {
    if (!skeleton.definition) continue;
    const bone = skeleton.definition.bones.get(boneId);
    if (!bone) continue;

    // Get bone position from matrix (tx, ty is the origin of the bone in world space relative to entity root)
    const boneX = worldMatrix.tx;
    const boneY = worldMatrix.ty;

    if (DEBUG.DRAW_PIVOTS) {
      // Draw pivot point
      ctx.fillStyle = "red";
      ctx.beginPath();
      ctx.arc(boneX, boneY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (DEBUG.DRAW_SKELETONS) {
      // Draw bone ID label
      ctx.fillStyle = "white";
      ctx.font = "8px monospace";
      ctx.fillText(boneId, boneX + 5, boneY - 5);

      // Draw line to each child's pivot
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 1;
      for (const child of bone.children) {
        const childMatrix = skeleton.worldTransforms.get(child.id);
        if (childMatrix) {
          ctx.beginPath();
          ctx.moveTo(boneX, boneY);
          ctx.lineTo(childMatrix.tx, childMatrix.ty);
          ctx.stroke();
        }
      }
    }
  }

  ctx.restore();
}

export function drawHitboxes(ctx: CanvasRenderingContext2D, world: World): void {
  // Draw active hitboxes (damage-dealing)
  if (DEBUG.DRAW_HITBOXES) {
    for (const { id, components } of world.query("ActiveHitbox", "Transform")) {
      const hitbox = components[0] as ActiveHitboxComponent;
      const transform = components[1] as TransformComponent;

      ctx.save();

      let drewBone = false;

      // Check if attached to bone
      if (hitbox.attachedToBone) {
        const skeleton = world.getComponent<SkeletonComponent>(id, "Skeleton");
        if (skeleton) {
          const boneMatrix = skeleton.worldTransforms.get(hitbox.attachedToBone);
          if (boneMatrix) {
            // Apply bone transformation directly
            // This puts the context at the bone's origin/orientation/scale
            ctx.transform(
              boneMatrix.a,
              boneMatrix.b,
              boneMatrix.c,
              boneMatrix.d,
              boneMatrix.tx,
              boneMatrix.ty,
            );

            // Apply hitbox offset relative to bone
            ctx.translate(hitbox.offset.x, hitbox.offset.y);

            // Apply hitbox local rotation
            ctx.rotate((hitbox.rotation * Math.PI) / 180);
            drewBone = true;
          }
        }
      }

      // Fallback or Entity-relative
      if (!drewBone) {
        ctx.translate(transform.position.x, transform.position.y);
        // Apply Scaling correctly (abs x because facing handles sign)
        ctx.scale(transform.facing * Math.abs(transform.scale.x), transform.scale.y);

        // Apply hitbox transform relative to entity
        ctx.translate(hitbox.offset.x, hitbox.offset.y);
        ctx.rotate((hitbox.rotation * Math.PI) / 180);
      }

      // Color by zone with Transparency for visibility
      // Brighten the colors slightly to make them pop against dark backgrounds
      const zoneColors: Record<number, string> = {
        1: "rgba(255, 50, 50, 0.6)",
        2: "rgba(50, 255, 50, 0.6)",
        3: "rgba(50, 100, 255, 0.6)",
      };
      const borderColor = "white";

      ctx.fillStyle = zoneColors[hitbox.zone] || "rgba(255, 255, 0, 0.6)";
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2; // Fixed width, not scaled

      // Use path to ensure stroke isn't affected by scale oddities if we wanted, but fillRect is fine here
      ctx.fillRect(-hitbox.width / 2, -hitbox.height / 2, hitbox.width, hitbox.height);
      ctx.strokeRect(-hitbox.width / 2, -hitbox.height / 2, hitbox.width, hitbox.height);

      // Draw facing indicator on hitbox
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(hitbox.width / 2, 0);
      ctx.stroke();

      ctx.restore();
    }
  }

  // Draw hurtboxes (damage-receiving)
  if (DEBUG.DRAW_HURTBOXES || DEBUG.DRAW_COLLISION) {
    for (const { id: _id, components } of world.query("Collider", "Transform")) {
      const collider = components[0] as ColliderComponent;
      const transform = components[1] as TransformComponent;

      ctx.save();
      ctx.translate(transform.position.x, transform.position.y);

      ctx.strokeStyle = "cyan";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);

      for (const hurtbox of collider.hurtboxes) {
        // Scale hurtbox drawing to match logic in CollisionSystem
        const scaledX = hurtbox.x * Math.abs(transform.scale.x);
        const scaledY = hurtbox.y * transform.scale.y;
        const scaledW = hurtbox.width * Math.abs(transform.scale.x);
        const scaledH = hurtbox.height * transform.scale.y;

        ctx.strokeRect(scaledX, scaledY, scaledW, scaledH);
      }

      ctx.restore();
    }
  }

  // Draw Nav Graph and AI
  if (DEBUG.DRAW_COLLISION || DEBUG.SHOW_STATE_INFO) {
    const nav = world.getResource<NavigationGraph>(NavigationGraph);
    if (nav && DEBUG.DRAW_COLLISION) {
      ctx.save();
      // Draw Edges
      ctx.lineWidth = 1;
      for (const [fromId, edges] of nav.edges) {
        const startNode = nav.nodes.get(fromId);
        if (!startNode) continue;

        for (const edge of edges) {
          const endNode = nav.nodes.get(edge.to);
          if (endNode) {
            ctx.beginPath();
            ctx.moveTo(startNode.position.x, startNode.position.y);
            ctx.lineTo(endNode.position.x, endNode.position.y);

            // Color by type
            if (edge.type === "jump")
              ctx.strokeStyle = "rgba(255, 255, 0, 0.5)"; // Yellow
            else if (edge.type === "fall")
              ctx.strokeStyle = "rgba(255, 0, 0, 0.5)"; // Red
            else ctx.strokeStyle = "rgba(0, 255, 0, 0.3)"; // Green

            ctx.stroke();
          }
        }
      }

      // Draw Nodes
      ctx.fillStyle = "blue";
      for (const node of nav.nodes.values()) {
        ctx.fillRect(node.position.x - 2, node.position.y - 2, 4, 4);
      }
      ctx.restore();
    }

    // Draw AI Lines & State Info
    if (DEBUG.SHOW_STATE_INFO) {
      ctx.save();
      const ais = world.query("AIController", "Transform");
      for (const { components } of ais) {
        const ai = components[0] as AIControllerComponent;
        const t = components[1] as TransformComponent;

        if (ai.target) {
          const targetTrans = world.getComponent<TransformComponent>(ai.target, "Transform");
          if (targetTrans) {
            ctx.strokeStyle = "rgba(255, 0, 255, 0.5)";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(t.position.x, t.position.y - 40);
            ctx.lineTo(targetTrans.position.x, targetTrans.position.y - 40);
            ctx.stroke();
          }
        }

        // Draw current path
        if (ai.currentPath.length > 0) {
          ctx.strokeStyle = "orange";
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(t.position.x, t.position.y);
          for (let i = ai.pathTargetIndex; i < ai.currentPath.length; i++) {
            ctx.lineTo(ai.currentPath[i].x, ai.currentPath[i].y);
          }
          ctx.stroke();
        }
      }

      // Draw Entity State Overlay (Player & AI)
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      interface DebugLabel {
        x: number;
        y: number; // Top-left Y
        w: number;
        h: number;
        anchorX: number;
        anchorY: number;
        lines: string[];
      }

      const labels: DebugLabel[] = [];
      const entities = world.query("Transform");

      // 1. Gather Labels
      for (const { id, components } of entities) {
        const transform = components[0] as TransformComponent;
        const info: string[] = [];

        // AI Info
        const ai = world.getComponent<AIControllerComponent>(id, "AIController");
        if (ai) info.push(`AI: ${ai.state} (T:${ai.stateTimer.toFixed(0)})`);

        // Movement Info
        const move = world.getComponent<MovementStateComponent>(id, "MovementState");
        if (move) info.push(`Move: ${move.current}`);

        // Combat Info
        const combat = world.getComponent<CombatComponent>(id, "Combat");
        if (combat) {
          info.push(`Combat: ${combat.attackState} [${combat.attackZone}]`);
          if (combat.isBlocking) info.push(`BLOCKING [${combat.blockZone}]`);
          info.push(`Poise: ${Math.floor(combat.poise)}/${combat.maxPoise}`);
        }

        // Vitals
        const health = world.getComponent<HealthComponent>(id, "Health");
        const stamina = world.getComponent<StaminaComponent>(id, "Stamina");
        if (health || stamina) {
          const hp = health ? Math.floor(health.current) : "?";
          const st = stamina ? Math.floor(stamina.current) : "?";
          info.push(`HP: ${hp} | STM: ${st}`);
        }

        // Create label if info exists
        if (info.length > 0) {
          const w = 120;
          const h = info.length * 14 + 4;
          const anchorX = transform.position.x;
          const anchorY = transform.position.y - 80; // Start above head

          // rect Y is top. Bottom anchor is anchorY.
          labels.push({
            x: anchorX - w / 2,
            y: anchorY - h,
            w: w,
            h: h,
            anchorX: anchorX,
            anchorY: anchorY,
            lines: info,
          });
        }
      }

      // 2. Sort by Y descending (Process bottom-most/front-most entities first)
      labels.sort((a, b) => b.anchorY - a.anchorY);

      // 3. Resolve Overlaps (Simple greedy stacking)
      for (let i = 0; i < labels.length; i++) {
        const l1 = labels[i];
        // Check against already processed labels (which are fixed in place now)
        for (let j = 0; j < i; j++) {
          const l2 = labels[j];
          if (rectIntersect(l1, l2)) {
            // Collision detected. Push l1 UP.
            // l1.y (Top) should be l2.y (Top) - l1.h (Height) - padding
            l1.y = l2.y - l1.h - 2;
          }
        }
      }

      // 4. Render
      for (const l of labels) {
        // Draw connector line if moved far from anchor
        if (Math.abs(l.y + l.h - l.anchorY) > 5) {
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(l.anchorX, l.anchorY); // Original anchor (above head)
          ctx.lineTo(l.x + l.w / 2, l.y + l.h); // Bottom of current box
          ctx.stroke();
        }

        // Background box
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(l.x, l.y, l.w, l.h);

        // Text
        ctx.fillStyle = "#0f0";
        let textY = l.y + l.h - 4; // Bottom of box - padding
        for (let i = l.lines.length - 1; i >= 0; i--) {
          ctx.fillText(l.lines[i], l.x + l.w / 2, textY);
          textY -= 14;
        }
      }

      ctx.restore();
    }
  }
}

export function drawPoseInspector(
  ctx: CanvasRenderingContext2D,
  skeleton: SkeletonComponent,
  screenX: number,
  screenY: number,
): void {
  if (!DEBUG.SHOW_POSE_VALUES) return;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  const lineCount = Object.keys(skeleton.currentPose).length;
  ctx.fillRect(screenX, screenY, 200, lineCount * 16 + 40);

  ctx.fillStyle = "white";
  ctx.font = "12px monospace";
  ctx.fillText("Bone Rotations:", screenX + 5, screenY + 14);

  let y = screenY + 30;
  for (const [boneId, pose] of Object.entries(skeleton.currentPose)) {
    const rotation = pose.rotate?.toFixed(1) || "0.0";
    ctx.fillText(`${boneId}: ${rotation}°`, screenX + 10, y);
    y += 16;
  }

  ctx.restore();
}

function rectIntersect(
  r1: { x: number; y: number; w: number; h: number },
  r2: { x: number; y: number; w: number; h: number },
) {
  return !(
    r2.x >= r1.x + r1.w ||
    r2.x + r2.w <= r1.x ||
    r2.y >= r1.y + r1.h ||
    r2.y + r2.h <= r1.y
  );
}
