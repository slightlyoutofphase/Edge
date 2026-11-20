export const WeaponPaths: Record<
  string,
  {
    path: string;
    fill: string;
    stroke?: string;
    strokeWidth?: number;
    tipOffset?: { x: number; y: number };
  }
> = {
  "weapon-longsword": {
    tipOffset: { x: 30, y: 0 },
    // Standard blade
    path: "M 0 -2 L 28 -1 L 30 0 L 28 1 L 0 2 Z",
    fill: "#E0E0E0",
    stroke: "#808080",
    strokeWidth: 1,
  },
  "weapon-rapier": {
    tipOffset: { x: 35, y: 0 },
    // Thin, long blade, intricate guard implied by handle visuals (simplified here)
    path: "M 0 -1 L 35 -0.5 L 35 0.5 L 0 1 Z",
    fill: "#F0F0F0",
    stroke: "#A0A0A0",
    strokeWidth: 1,
  },
  "weapon-greatsword": {
    tipOffset: { x: 40, y: 0 },
    // Wide, heavy blade
    path: "M 0 -4 L 35 -5 L 40 0 L 35 5 L 0 4 Z",
    fill: "#505050",
    stroke: "#303030",
    strokeWidth: 1,
  },
  "weapon-dagger": {
    tipOffset: { x: 20, y: 0 },
    // Short, sharp
    path: "M 0 -2 L 18 -1 L 20 0 L 18 1 L 0 2 Z",
    fill: "#CCCCCC",
    stroke: "#666666",
    strokeWidth: 1,
  },
};
