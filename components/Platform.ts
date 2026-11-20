export interface PlatformComponent {
  type: "solid" | "semisolid" | "hazard" | "ladder";
  friction: number;
  damage: number; // For hazards
  damageInterval: number; // ms
  damageTimer: number; // Runtime tracker
  asset?: string;
  collidable?: boolean;
}
