// Final SVG paths for Player
export const PlayerBonePaths: Record<
  string,
  { path: string; fill: string; stroke?: string; strokeWidth?: number }
> = {
  // Head: Helmet shape
  head: {
    path: "M -5 -8 C -5 -12, 5 -12, 5 -8 L 5 0 C 5 4, -5 4, -5 0 Z",
    fill: "#C0C0C0",
    stroke: "#404040",
    strokeWidth: 1,
  },
  // Torso: Armor plate
  torso: {
    path: "M -7 -22 L 7 -22 L 5 0 L -5 0 Z",
    fill: "#808080",
    stroke: "#303030",
    strokeWidth: 1,
  },
  // Shoulders
  "shoulder-front": { path: "M -3 -3 L 3 -3 L 3 3 L -3 3 Z", fill: "#707070" },
  "shoulder-back": { path: "M -3 -3 L 3 -3 L 3 3 L -3 3 Z", fill: "#505050" },
  // Legs: Greaves
  "leg-front-upper": { path: "M -3 0 L 3 0 L 2 12 L -2 12 Z", fill: "#505050" },
  "leg-front-lower": { path: "M -2 0 L 2 0 L 1 12 L -1 12 Z", fill: "#606060" },
  "leg-back-upper": { path: "M -3 0 L 3 0 L 2 12 L -2 12 Z", fill: "#404040" },
  "leg-back-lower": { path: "M -2 0 L 2 0 L 1 12 L -1 12 Z", fill: "#505050" },
  // Feet: Boots
  "foot-front": { path: "M -2 0 L 4 0 L 4 4 L -2 4 Z", fill: "#303030" },
  "foot-back": { path: "M -2 0 L 4 0 L 4 4 L -2 4 Z", fill: "#202020" },
  // Arms: Gauntlets/Vambraces
  "arm-front-upper": { path: "M -2 0 L 2 0 L 2 10 L -2 10 Z", fill: "#707070" },
  "arm-front-lower": { path: "M -2 0 L 2 0 L 2 8 L -2 8 Z", fill: "#808080" },
  "arm-back-upper": { path: "M -2 0 L 2 0 L 2 10 L -2 10 Z", fill: "#606060" },
  "arm-back-lower": { path: "M -2 0 L 2 0 L 2 8 L -2 8 Z", fill: "#707070" },
  // Hands
  "hand-front": { path: "M -2 0 L 2 0 L 2 4 L -2 4 Z", fill: "#303030" },
  "hand-back": { path: "M -2 0 L 2 0 L 2 4 L -2 4 Z", fill: "#202020" },

  // Weapon: Longsword
  // Reduced length from 40 to 28 for realistic scale
  weapon: {
    path: "M 0 -2 L 28 -1 L 30 0 L 28 1 L 0 2 Z",
    fill: "#E0E0E0",
    stroke: "#808080",
    strokeWidth: 1,
  },
};
