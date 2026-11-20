import { World } from "../core/World";
import { SpawnEffectComponent } from "../components/SpawnEffect";
import {
  VisualEffectComponent,
  HitFlashComponent,
} from "../features/visuals/VisualEffectComponent";
import { TimeState } from "../core/Resources";
import { vec2ScaleMut, vec2Set } from "../utils/Vec2";

export class EffectSystem {
  constructor(private world: World) {}

  update() {
    const time = this.world.getResource<TimeState>(TimeState);
    const dt = time.delta / 1000;
    const dtMs = time.delta;

    // 1. Process Spawn Requests
    const spawners = this.world.query("SpawnEffect");
    for (const { id, components } of spawners) {
      const spawn = components[0] as SpawnEffectComponent;
      this.spawnEffect(spawn);
      this.world.removeComponent(id, "SpawnEffect");
      if (this.world.isEmptyEntity(id)) this.world.destroyEntity(id);
    }

    // 2. Update Active Visual Effects
    const effects = this.world.query("VisualEffect");
    for (const { id, components } of effects) {
      const effect = components[0] as VisualEffectComponent;

      // Age
      effect.life -= dtMs;
      if (effect.life <= 0) {
        this.world.destroyEntity(id);
        continue;
      }

      // Physics (Simplified)
      effect.position.x += effect.velocity.x * dt;
      effect.position.y += effect.velocity.y * dt;

      effect.rotation += effect.rotationSpeed * dt;

      // Fade out
      effect.alpha = effect.life / effect.maxLife;
    }

    // 3. Update Hit Flashes
    const flashers = this.world.query("HitFlash");
    for (const { id, components } of flashers) {
      const flash = components[0] as HitFlashComponent;
      if (time.hitStopFrames > 0 || this.world.hasComponent(id, "HitStop")) continue;
      if (flash.remainingMs === undefined) {
        flash.remainingMs = (flash.frames * 1000) / 60;
      }
      flash.remainingMs = Math.max(0, flash.remainingMs - dtMs);
      flash.frames = Math.max(0, Math.ceil((flash.remainingMs * 60) / 1000 - 1e-6));
      if (flash.remainingMs <= 0 || flash.frames <= 0) {
        this.world.removeComponent(id, "HitFlash");
      }
    }

    // 4. Update Time Scale
    if (time.timeScaleDuration > 0) {
      time.timeScaleDuration -= dtMs / time.timeScale; // Real time decrement
      if (time.timeScaleDuration <= 0) {
        time.timeScale = 1.0;
      }
    }
  }

  private spawnEffect(spawn: SpawnEffectComponent) {
    if (spawn.type === "hellhound-shockwave") {
      const id = this.world.createEntity();
      this.world.addComponent(id, "VisualEffect", {
        type: "hellhound-shockwave",
        position: { ...spawn.position },
        velocity: { x: 0, y: 0 },
        rotation: 0,
        rotationSpeed: 0,
        scale: spawn.scale ?? 1,
        alpha: 1,
        life: 450,
        maxLife: 450,
      } as VisualEffectComponent);
      return;
    }
    if (spawn.type === "motion_blur") {
      // Spawn Ghost
      const id = this.world.createEntity();
      this.world.addComponent(id, "VisualEffect", {
        type: "ghost",
        position: { ...spawn.position },
        velocity: { x: 0, y: 0 },
        rotation: 0,
        rotationSpeed: 0,
        scale: spawn.scale || 1.0,
        alpha: 0.5,
        life: 200,
        maxLife: 200,
        spritePath: "ghost-path",
      } as VisualEffectComponent);
      return;
    }

    let count = 1;
    let type = "spark";
    let life = 300;
    let speedBase = 50;

    if (spawn.type === "parry_burst") {
      count = 10;
      type = "spark";
      life = 500;
      speedBase = 150;
    } else if (spawn.type === "block_spark") {
      count = 5;
      type = "block_spark";
      life = 140;
      speedBase = 55;
    } else if (spawn.type === "clash_spark") {
      count = 4;
      type = "clash_spark";
      life = 170;
      speedBase = 75;
    } else if (spawn.type === "flesh_hit") {
      count = 3;
      type = "flesh_hit";
      life = 110;
      speedBase = 20;
    } else if (spawn.type === "dust") {
      type = "dust";
      life = 500;
    }

    for (let i = 0; i < count; i++) {
      const id = this.world.createEntity();
      const angle = Math.random() * Math.PI * 2;
      const speed = speedBase + Math.random() * 100;

      const velocity = { x: 0, y: 0 };

      if (spawn.direction) {
        // Copy & Scale in place
        vec2Set(velocity, spawn.direction.x, spawn.direction.y);
        vec2ScaleMut(velocity, velocity, speed);
      } else {
        vec2Set(velocity, Math.cos(angle) * speed, Math.sin(angle) * speed);
      }

      if (spawn.type === "dust") {
        velocity.y = -20 - Math.random() * 30; // Float up
      } else if (spawn.type === "parry_burst") {
        velocity.x *= 2;
        velocity.y *= 2;
      }

      this.world.addComponent(id, "VisualEffect", {
        type: type,
        position: { ...spawn.position },
        velocity: velocity,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 720,
        scale: spawn.scale || 1.0,
        alpha: 1.0,
        life: life,
        maxLife: life,
      } as VisualEffectComponent);
    }
  }
}
