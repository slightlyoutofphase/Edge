import { Vec2 } from "../utils/Vec2";

export interface TransformComponent {
  position: Vec2;
  rotation: number;
  scale: Vec2;
  facing: -1 | 1;
}
