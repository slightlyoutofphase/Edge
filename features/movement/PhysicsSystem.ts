import { World } from "../../core/World";
import { PhysicsComponent } from "./PhysicsComponent";
import { TransformComponent } from "../../components/Transform";
import { GRAVITY, TERMINAL_VELOCITY } from "../../core/Constants";
import { TimeState } from "../../core/Resources";
import { lerp } from "../../utils/Math";
import { MovementStateComponent } from "./MovementStateComponent";

const activeMoveStates = new Set(["walk", "run", "crouchWalk", "roll", "slide", "backstep"]);

export class PhysicsSystem {
  constructor(private world: World) {}

  update() {
    const time = this.world.getResource<TimeState>(TimeState);
    const dt = time.delta / 1000; // ms to sec

    const entities = this.world.query("Physics", "Transform");

    for (const { id, components } of entities) {
      // Skip physics if in HitStop
      if (this.world.hasComponent(id, "HitStop")) continue;

      const physics = components[0] as PhysicsComponent;
      const transform = components[1] as TransformComponent;
      const movement = this.world.getComponent<MovementStateComponent>(id, "MovementState");
      const previous = (physics.previousPosition ??= { x: 0, y: 0 });
      previous.x = transform.position.x;
      previous.y = transform.position.y;

      // Apply Gravity
      if (!physics.grounded && movement?.current !== "climb") {
        physics.velocity.y += GRAVITY * dt;
      } else {
        // Apply Friction on ground
        const isActive = movement && activeMoveStates.has(movement.current);

        if (!isActive) {
          const frictionFactor = 8.0;
          const f = Math.min(1, physics.friction * frictionFactor * dt);

          physics.velocity.x = lerp(physics.velocity.x, 0, f);

          if (Math.abs(physics.velocity.x) < 5) physics.velocity.x = 0;
        }
      }

      // Clamp Terminal Velocity
      physics.velocity.y = Math.min(physics.velocity.y, TERMINAL_VELOCITY);

      // Apply Velocity (Mutable op could be used here but simple scalars are fine for now)
      transform.position.x += physics.velocity.x * dt;
      transform.position.y += physics.velocity.y * dt;
    }
  }
}
