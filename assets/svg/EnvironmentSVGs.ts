export const TilePaths: Record<
  string,
  { path: string; fill: string; stroke?: string; strokeWidth?: number }
> = {
  // Basic filler block (used for underground/interior)
  "stone-block": {
    path: "M 0 0 L 32 0 L 32 32 L 0 32 Z",
    fill: "#1a1a1a",
    stroke: "#222222",
    strokeWidth: 1,
  },
  // Walkable floor (Top has detail, bottom is filler)
  "stone-floor": {
    // Detailed top surface
    path: "M 0 0 L 32 0 L 32 32 L 0 32 Z M 0 0 L 32 0 L 32 4 L 0 4 Z M 4 2 L 28 2",
    fill: "#262626",
    stroke: "#333333",
    strokeWidth: 1,
  },
  // Vertical wall (Brick pattern)
  "stone-wall": {
    path: "M 0 0 L 32 0 L 32 32 L 0 32 Z M 0 8 L 32 8 M 0 24 L 32 24 M 16 8 L 16 24 M 8 0 L 8 8 M 24 0 L 24 8 M 8 24 L 8 32 M 24 24 L 24 32",
    fill: "#202020",
    stroke: "#303030",
    strokeWidth: 1,
  },
  // Floating platform (Lighter, detailed)
  "stone-platform": {
    path: "M 0 0 L 32 0 L 32 10 L 28 14 L 4 14 L 0 10 Z M 0 0 L 32 0 L 32 4 L 0 4 Z",
    fill: "#3a3a3a",
    stroke: "#555555",
    strokeWidth: 1,
  },
  // Spikes (Hazard)
  "hazard-spikes": {
    path: "M 0 32 L 6 0 L 12 32 L 18 0 L 24 32 L 32 0 L 32 32 Z",
    fill: "#4a0000",
    stroke: "#800000",
    strokeWidth: 1,
  },
  // Ladder
  ladder: {
    path: "M 6 0 L 6 32 M 26 0 L 26 32 M 6 8 L 26 8 M 6 24 L 26 24",
    fill: "transparent",
    stroke: "#5c4033",
    strokeWidth: 2,
  },
  // Decoration
  "grass-tuft": {
    path: "M 0 32 Q 5 20 10 32 M 8 32 Q 12 15 16 32",
    fill: "transparent",
    stroke: "#2d4d2d",
    strokeWidth: 1,
  },
  // Interactables
  bonfire: {
    path: "M -10 0 L 10 0 L 5 -5 L -5 -5 Z M -3 -5 L 0 -15 L 3 -5 Z",
    fill: "#ff5500",
    stroke: "#884400",
    strokeWidth: 2,
  },
  chest: {
    path: "M -16 -16 L 16 -16 L 16 0 L -16 0 Z M -16 0 L -16 -10 L 16 -10 L 16 0",
    fill: "#8b4513",
    stroke: "#5c3317",
    strokeWidth: 2,
  },
  "chest-open": {
    path: "M -16 -16 L 16 -16 L 16 0 L -16 0 Z M -16 -16 L -20 -30 L 20 -30 L 16 -16",
    fill: "#8b4513",
    stroke: "#5c3317",
    strokeWidth: 2,
  },
};

export const BackgroundPaths: Record<string, { path: string; fill: string; stroke?: string }> = {
  "mountain-far": {
    path: "M 0 600 L 200 200 L 400 500 L 500 400 L 800 600 Z",
    fill: "#0d0d0d",
  },
  "mountain-near": {
    path: "M 0 600 L 150 300 L 300 600 L 450 400 L 600 600 Z",
    fill: "#111111",
  },
};
