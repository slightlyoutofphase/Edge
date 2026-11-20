import { AABB } from "../utils/AABB";

export enum CollisionLayer {
  PLAYER = 1 << 0,
  ENEMY = 1 << 1,
  PLAYER_ATTACK = 1 << 2,
  ENEMY_ATTACK = 1 << 3,
  ENVIRONMENT = 1 << 4,
  TRIGGER = 1 << 5,
}

export interface ColliderComponent {
  hitboxes: AABB[];
  hurtboxes: AABB[];
  layer: CollisionLayer;
  standingHeight?: number; // Local actor height restored after crouch/rearing.
}
