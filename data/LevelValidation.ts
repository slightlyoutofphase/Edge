import { LevelData, LEVELS } from "./Levels";
import { WEAPONS } from "./WeaponDefinitions";
import { ENEMY_TYPES } from "./EnemyTypes";

export function validateLevelData(value: unknown): LevelData {
  const fail = (field: string): never => {
    throw new Error("Invalid level: " + field);
  };
  if (!value || typeof value !== "object") fail("expected an object");
  const data = value as LevelData;
  const number = (value: unknown, field: string, positive = false) => {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      Math.abs(value) > 100000 ||
      (positive && value <= 0)
    )
      fail(field);
  };
  const point = (value: { x: number; y: number } | undefined, field: string) => {
    if (!value || typeof value !== "object") fail(field);
    number(value!.x, field + ".x");
    number(value!.y, field + ".y");
  };
  if (typeof data.id !== "string" || !data.id.trim()) fail("id");
  number(data.width, "width", true);
  number(data.height, "height", true);
  point(data.startPos, "startPos");
  for (const key of ["tiles", "enemies", "checkpoints", "triggers"] as const) {
    if (!Array.isArray(data[key]) || data[key].length > 5000) fail(key);
  }
  if (
    data.interactables !== undefined &&
    (!Array.isArray(data.interactables) || data.interactables.length > 5000)
  )
    fail("interactables");
  let cells = 0;
  const rectangle = (
    item: { x: number; y: number; width: number; height: number },
    field: string,
  ) => {
    point(item, field);
    number(item.width, field + ".width", true);
    number(item.height, field + ".height", true);
    if (item.width > 32768 || item.height > 32768) fail(field + " dimensions");
    cells += (Math.ceil(item.width / 128) + 1) * (Math.ceil(item.height / 128) + 1);
    if (cells > 250000) fail("geometry exceeds spatial-grid limits");
  };
  data.tiles.forEach((tile, i) => {
    rectangle(tile, "tiles[" + i + "]");
    if (!["solid", "semisolid", "hazard", "ladder"].includes(tile.type)) fail("tile type");
    if (tile.asset !== undefined && typeof tile.asset !== "string") fail("tile asset");
    if (tile.damage !== undefined) {
      number(tile.damage, "tile damage");
      if (tile.damage < 0) fail("tile damage");
    }
  });
  data.enemies.forEach((enemy, i) => {
    point(enemy, "enemies[" + i + "]");
    if (!ENEMY_TYPES.includes(enemy.type)) fail("enemy type");
  });
  const checkpoints = new Set<string>();
  data.checkpoints.forEach((checkpoint, i) => {
    point(checkpoint, "checkpoints[" + i + "]");
    if (typeof checkpoint.id !== "string" || !checkpoint.id || checkpoints.has(checkpoint.id))
      fail("checkpoint id");
    checkpoints.add(checkpoint.id);
    if (checkpoint.facing !== 1 && checkpoint.facing !== -1) fail("checkpoint facing");
  });
  data.triggers.forEach((trigger, i) => {
    rectangle(trigger, "triggers[" + i + "]");
    if (!["transition", "boss_start", "camera_lock", "victory"].includes(trigger.type))
      fail("trigger type");
    if (
      trigger.type === "transition" &&
      (typeof trigger.target !== "string" ||
        !Object.hasOwn(LEVELS, trigger.target) ||
        trigger.target === data.id)
    )
      fail("transition target");
    if (trigger.bounds) {
      point(trigger.bounds.min, "bounds.min");
      point(trigger.bounds.max, "bounds.max");
      if (
        trigger.bounds.min.x >= trigger.bounds.max.x ||
        trigger.bounds.min.y >= trigger.bounds.max.y
      )
        fail("bounds");
    }
  });
  data.interactables?.forEach((item, i) => {
    point(item, "interactables[" + i + "]");
    if (
      !["bonfire", "chest", "lever", "door"].includes(item.type) ||
      typeof item.prompt !== "string"
    )
      fail("interactable");
    if (
      item.data !== undefined &&
      (!item.data || typeof item.data !== "object" || Array.isArray(item.data))
    )
      fail("interactable data");
    if (
      item.type === "chest" &&
      item.data?.weaponId !== undefined &&
      (typeof item.data.weaponId !== "string" || !Object.hasOwn(WEAPONS, item.data.weaponId))
    )
      fail("chest weapon");
  });
  return { ...data, interactables: data.interactables ?? [] };
}
