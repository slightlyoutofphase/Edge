import { Vec2 } from "../../utils/Vec2";

export interface PhysicsComponent {
  velocity: Vec2;
  acceleration: Vec2;
  grounded: boolean;
  friction: number;
  previousPosition?: Vec2;
  impactControlMs?: number; // Briefly preserve contact momentum against locomotion input.
}
