export const EffectPaths: Record<
  string,
  { path: string; fill?: string; stroke?: string; strokeWidth?: number }
> = {
  flesh_hit: {
    path: "M -3 -1 Q 0 -3 3 0 Q 0 2 -3 1 Z",
    fill: "#d47b53",
  },
  block_spark: {
    path: "M -1 0 L 5 -1 L 1 1 Z",
    fill: "#a9e5ff",
  },
  clash_spark: {
    path: "M -5 0 L 0 -1 L 5 0 L 0 1 Z M 0 -4 L 1 0 L 0 4 L -1 0 Z",
    fill: "#ffe2a4",
  },
  "hellhound-shockwave": {
    path: "M -56 0 C -40 -8 40 -8 56 0 C 35 5 -35 5 -56 0 Z M -48 0 C -30 -4 30 -4 48 0 C 30 2 -30 2 -48 0 Z",
    fill: "#b5412c",
    stroke: "#e4ab72",
    strokeWidth: 0.7,
  },
  spark: {
    path: "M 0 -8 L 2 -2 L 8 0 L 2 2 L 0 8 L -2 2 L -8 0 L -2 -2 Z",
    fill: "#FFFFCC",
  },
  dust: {
    path: "M -4 0 A 4 4 0 0 1 4 0 A 4 4 0 0 1 -4 0",
    fill: "#888888",
  },
  burst: {
    path: "M 0 -15 L 3 -5 L 15 0 L 3 5 L 0 15 L -3 5 L -15 0 L -3 -5 Z",
    fill: "#FFFFFF",
  },
};
