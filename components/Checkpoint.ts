import { Vec2 } from "../utils/Vec2";

export interface CheckpointComponent {
  id: string;
  respawnPosition: Vec2;
  respawnFacing: -1 | 1;
  isActive: boolean;
}
