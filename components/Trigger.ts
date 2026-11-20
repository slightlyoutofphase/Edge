import { Vec2 } from "../utils/Vec2";

export interface TriggerComponent {
  type: "transition" | "boss_start" | "cutscene" | "camera_lock" | "victory";
  targetId?: string; // e.g., level ID or boss entity ID
  bounds?: { min: Vec2; max: Vec2 }; // For camera lock
  isActive: boolean;
  oneshot: boolean;
  triggered: boolean;
}
