import { Vec2 } from "../utils/Vec2";
import { EnemyType } from "./EnemyTypes";

export interface TileData {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "solid" | "semisolid" | "hazard" | "ladder";
  asset?: string;
  damage?: number;
}

export interface EnemySpawn {
  type: EnemyType;
  x: number;
  y: number;
}

export interface CheckpointData {
  id: string;
  x: number;
  y: number;
  facing: -1 | 1;
}

export interface TriggerData {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "transition" | "boss_start" | "camera_lock" | "victory";
  target?: string;
  bounds?: { min: Vec2; max: Vec2 };
}

export interface InteractableData {
  x: number;
  y: number;
  type: "bonfire" | "chest" | "lever" | "door";
  prompt: string;
  data?: any;
}

export interface LevelData {
  id: string;
  width: number;
  height: number;
  tiles: TileData[];
  enemies: EnemySpawn[];
  checkpoints: CheckpointData[];
  triggers: TriggerData[];
  interactables: InteractableData[];
  startPos: Vec2;
}

const TOWER_COALESCED_TILES: TileData[] = [
  { x: 1504, y: 0, width: 96, height: 1600, type: "solid", asset: "stone-wall" },
  { x: -96, y: 192, width: 160, height: 224, type: "solid", asset: "stone-wall" },
  { x: 672, y: 384, width: 288, height: 32, type: "solid", asset: "stone-floor" },
  { x: 960, y: 384, width: 32, height: 128, type: "solid", asset: "stone-wall" },
  { x: -128, y: 416, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: 480, y: 416, width: 32, height: 192, type: "ladder", asset: "ladder" },
  { x: 512, y: 416, width: 160, height: 32, type: "ladder", asset: "stone-floor" },
  { x: -96, y: 448, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: 224, y: 448, width: 64, height: 32, type: "solid", asset: "stone-floor" },
  { x: -128, y: 480, width: 160, height: 160, type: "solid", asset: "stone-wall" },
  { x: 1056, y: 480, width: 32, height: 1024, type: "ladder", asset: "ladder" },
  { x: 896, y: 512, width: 160, height: 672, type: "solid", asset: "stone-wall" },
  { x: 416, y: 608, width: 32, height: 192, type: "ladder", asset: "ladder" },
  { x: 448, y: 608, width: 64, height: 32, type: "solid", asset: "stone-floor" },
  { x: -96, y: 640, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: -160, y: 672, width: 160, height: 64, type: "solid", asset: "stone-wall" },
  { x: 256, y: 672, width: 64, height: 32, type: "solid", asset: "stone-floor" },
  { x: 608, y: 672, width: 288, height: 32, type: "semisolid", asset: "stone-platform" },
  { x: -128, y: 736, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: 32, y: 736, width: 288, height: 32, type: "semisolid", asset: "stone-platform" },
  { x: -160, y: 768, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: -128, y: 800, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: 416, y: 800, width: 96, height: 32, type: "solid", asset: "stone-floor" },
  { x: -160, y: 832, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: -128, y: 864, width: 160, height: 32, type: "solid", asset: "stone-wall" },
  { x: -160, y: 896, width: 160, height: 192, type: "solid", asset: "stone-wall" },
  { x: 672, y: 896, width: 64, height: 32, type: "hazard", damage: 15, asset: "hazard-spikes" },
  { x: 864, y: 896, width: 32, height: 608, type: "ladder", asset: "ladder" },
  { x: 576, y: 928, width: 288, height: 32, type: "semisolid", asset: "stone-platform" },
  { x: 96, y: 1024, width: 64, height: 32, type: "hazard", damage: 15, asset: "hazard-spikes" },
  { x: 0, y: 1056, width: 288, height: 32, type: "semisolid", asset: "stone-platform" },
  { x: 384, y: 1056, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: -160, y: 1088, width: 192, height: 32, type: "solid", asset: "stone-wall" },
  { x: -192, y: 1120, width: 224, height: 64, type: "solid", asset: "stone-wall" },
  { x: 512, y: 1120, width: 288, height: 32, type: "semisolid", asset: "stone-platform" },
  { x: 480, y: 1152, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 576, y: 1152, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: -224, y: 1184, width: 256, height: 64, type: "solid", asset: "stone-wall" },
  { x: 352, y: 1184, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 544, y: 1184, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1184, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 384, y: 1216, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1216, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: -192, y: 1248, width: 224, height: 160, type: "solid", asset: "stone-wall" },
  { x: 416, y: 1248, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1248, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 32, y: 1280, width: 288, height: 32, type: "semisolid", asset: "stone-platform" },
  { x: 448, y: 1280, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 672, y: 1280, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1280, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 800, y: 1312, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1312, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 576, y: 1344, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1344, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 544, y: 1376, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1376, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: -160, y: 1408, width: 192, height: 64, type: "solid", asset: "stone-wall" },
  { x: 512, y: 1408, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1408, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 480, y: 1440, width: 32, height: 32, type: "solid", asset: "stone-floor" },
  { x: 896, y: 1440, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: -128, y: 1472, width: 160, height: 96, type: "solid", asset: "stone-wall" },
  { x: 416, y: 1472, width: 64, height: 32, type: "hazard", damage: 100, asset: "hazard-spikes" },
  { x: 800, y: 1472, width: 64, height: 32, type: "hazard", damage: 100, asset: "hazard-spikes" },
  { x: 896, y: 1472, width: 160, height: 32, type: "solid", asset: "stone-floor" },
  { x: 0, y: 1504, width: 1600, height: 96, type: "solid", asset: "stone-floor" },
];

export const LEVELS: Record<string, LevelData> = {
  level1: {
    id: "level1",
    width: 5440,
    height: 1216,
    startPos: {
      x: 96,
      y: 1088,
    },
    tiles: [
      {
        x: -96,
        y: 0,
        width: 96,
        height: 1216,
        type: "solid",
        asset: "stone-wall",
      },
      {
        x: 0,
        y: 1088,
        width: 800,
        height: 128,
        type: "solid",
        asset: "stone-floor",
      },
      {
        x: 416,
        y: 1056,
        width: 64,
        height: 64,
        type: "solid",
        asset: "stone-block",
      },
      {
        x: 800,
        y: 1152,
        width: 512,
        height: 32,
        type: "hazard",
        damage: 25,
        asset: "hazard-spikes",
      },
      {
        x: 864,
        y: 992,
        width: 96,
        height: 32,
        type: "semisolid",
        asset: "stone-platform",
      },
      {
        x: 1056,
        y: 928,
        width: 96,
        height: 32,
        type: "semisolid",
        asset: "stone-platform",
      },
      {
        x: 1248,
        y: 992,
        width: 96,
        height: 32,
        type: "semisolid",
        asset: "stone-platform",
      },
      {
        x: 1312,
        y: 1088,
        width: 512,
        height: 128,
        type: "solid",
        asset: "stone-floor",
      },
      {
        x: 1792,
        y: 608,
        width: 192,
        height: 608,
        type: "solid",
        asset: "stone-wall",
      },
      {
        x: 1760,
        y: 608,
        width: 32,
        height: 512,
        type: "ladder",
        asset: "ladder",
      },
      {
        x: 1696,
        y: 864,
        width: 64,
        height: 32,
        type: "semisolid",
        asset: "stone-platform",
      },
      {
        x: 1696,
        y: 608,
        width: 1216,
        height: 64,
        type: "semisolid",
        asset: "stone-floor",
      },
      {
        x: 2304,
        y: 608,
        width: 192,
        height: 32,
        type: "semisolid",
        asset: "stone-platform",
      },
      {
        x: 2912,
        y: 608,
        width: 64,
        height: 608,
        type: "solid",
        asset: "stone-wall",
      },
      {
        x: 2944,
        y: 1088,
        width: 1504,
        height: 128,
        type: "solid",
        asset: "stone-floor",
      },
      {
        x: 3200,
        y: 1056,
        width: 64,
        height: 64,
        type: "solid",
        asset: "stone-block",
      },
      {
        x: 3808,
        y: 1056,
        width: 64,
        height: 64,
        type: "solid",
        asset: "stone-block",
      },
      {
        x: 4448,
        y: 1088,
        width: 1024,
        height: 128,
        type: "solid",
        asset: "stone-floor",
      },
      {
        x: 4448,
        y: 800,
        width: 64,
        height: 288,
        type: "solid",
        asset: "stone-wall",
      },
      {
        x: 5440,
        y: 0,
        width: 96,
        height: 1216,
        type: "solid",
        asset: "stone-wall",
      },
      {
        type: "solid",
        width: 32,
        height: 32,
        asset: "stone-block",
        x: 4320,
        y: 1056,
      },
      {
        type: "solid",
        width: 32,
        height: 32,
        asset: "stone-block",
        x: 4352,
        y: 992,
      },
      {
        type: "solid",
        width: 32,
        height: 32,
        asset: "stone-block",
        x: 4384,
        y: 928,
      },
      {
        type: "solid",
        width: 32,
        height: 32,
        asset: "stone-block",
        x: 4416,
        y: 864,
      },
    ],
    enemies: [
      {
        type: "hollow",
        x: 608,
        y: 1088,
      },
      {
        type: "soldier",
        x: 1600,
        y: 1088,
      },
      {
        type: "duelist",
        x: 2112,
        y: 608,
      },
      {
        type: "hollow",
        x: 2624,
        y: 608,
      },
      {
        type: "brute",
        x: 3520,
        y: 1088,
      },
      {
        type: "soldier",
        x: 4000,
        y: 1088,
      },
      {
        type: "boss",
        x: 5024,
        y: 1088,
      },
    ],
    checkpoints: [
      {
        id: "cp_start",
        x: 192,
        y: 1088,
        facing: 1,
      },
      {
        id: "cp_ramparts",
        x: 1760,
        y: 608,
        facing: 1,
      },
      {
        id: "cp_bridge",
        x: 3008,
        y: 1088,
        facing: 1,
      },
    ],
    triggers: [
      {
        x: 4512,
        y: 0,
        width: 64,
        height: 1216,
        type: "boss_start",
        bounds: {
          min: {
            x: 4512,
            y: 0,
          },
          max: {
            x: 5536,
            y: 1216,
          },
        },
      },
      {
        x: 5344,
        y: 896,
        width: 96,
        height: 192,
        type: "transition",
        target: "level2",
      },
    ],
    interactables: [],
  },

  level2: {
    id: "level2",
    width: 1600,
    height: 1600,
    startPos: {
      x: 96,
      y: 1504,
    },
    tiles: TOWER_COALESCED_TILES.map((t) => ({ ...t })),
    enemies: [
      {
        type: "hollow",
        x: 192,
        y: 1280,
      },
      {
        type: "soldier",
        x: 224,
        y: 1056,
      },
      {
        type: "soldier",
        x: 608,
        y: 928,
      },
      {
        type: "duelist",
        x: 192,
        y: 736,
      },
      {
        type: "soldier",
        x: 640,
        y: 1120,
      },
      {
        type: "brute",
        x: 608,
        y: 416,
      },
      {
        type: "brute",
        x: 1248,
        y: 1504,
      },
    ],
    checkpoints: [
      {
        id: "cp_l2_start",
        x: 96,
        y: 1504,
        facing: 1,
      },
      {
        id: "cp_l2_mid",
        x: 864,
        y: 896,
        facing: -1,
      },
      {
        id: "cp_l2_top",
        x: 704,
        y: 384,
        facing: 1,
      },
      {
        id: "cp_1775932437130",
        x: 64,
        y: 1056,
        facing: 1,
      },
      {
        id: "cp_1775932817355",
        x: 128,
        y: 736,
        facing: 1,
      },
    ],
    triggers: [
      {
        x: 1440,
        y: 1408,
        width: 64,
        height: 96,
        type: "transition",
        target: "level3",
      },
    ],
    interactables: [],
  },
  level3: {
    id: "level3",
    width: 1600,
    height: 1600,
    startPos: {
      x: 96,
      y: 1504,
    },
    tiles: TOWER_COALESCED_TILES.map((t) => ({ ...t })),
    enemies: [
      {
        type: "hollow",
        x: 192,
        y: 1280,
      },
      {
        type: "soldier",
        x: 224,
        y: 1056,
      },
      {
        type: "soldier",
        x: 608,
        y: 928,
      },
      {
        type: "duelist",
        x: 192,
        y: 736,
      },
      {
        type: "soldier",
        x: 640,
        y: 1120,
      },
      {
        type: "brute",
        x: 608,
        y: 416,
      },
      {
        type: "boss",
        x: 1376,
        y: 1504,
      },
    ],
    checkpoints: [
      {
        id: "cp_l2_start",
        x: 96,
        y: 1504,
        facing: 1,
      },
      {
        id: "cp_l2_mid",
        x: 864,
        y: 896,
        facing: -1,
      },
      {
        id: "cp_l2_top",
        x: 704,
        y: 384,
        facing: 1,
      },
      {
        id: "cp_1775932437130",
        x: 64,
        y: 1056,
        facing: 1,
      },
      {
        id: "cp_1775932817355",
        x: 128,
        y: 736,
        facing: 1,
      },
    ],
    triggers: [
      {
        x: 1440,
        y: 1408,
        width: 64,
        height: 96,
        type: "victory",
      },
      {
        type: "boss_start",
        width: 256,
        height: 512,
        x: 1056,
        y: 992,
        bounds: {
          min: {
            x: 1056,
            y: 992,
          },
          max: {
            x: 1312,
            y: 1504,
          },
        },
      },
    ],
    interactables: [],
  },
  arena: {
    id: "arena",
    width: 1216,
    height: 800,
    startPos: { x: 192, y: 704 },
    tiles: [
      { x: -96, y: 0, width: 96, height: 800, type: "solid", asset: "stone-wall" },
      { x: 1216, y: 0, width: 96, height: 800, type: "solid", asset: "stone-wall" },
      { x: 0, y: 704, width: 1216, height: 96, type: "solid", asset: "stone-floor" },
    ],
    enemies: [],
    checkpoints: [],
    triggers: [
      {
        x: 0,
        y: 0,
        width: 1216,
        height: 800,
        type: "camera_lock",
        bounds: { min: { x: 0, y: 0 }, max: { x: 1216, y: 800 } },
      },
    ],
    interactables: [],
  },
};
