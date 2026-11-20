export const ENEMY_TYPES = [
  "hollow",
  "soldier",
  "duelist",
  "brute",
  "rogue",
  "boss",
  "hellhound",
  "alpha_hellhound",
] as const;
export type EnemyType = (typeof ENEMY_TYPES)[number];

export function isQuadruped(type: string) {
  return type === "hellhound" || type === "alpha_hellhound";
}

export function isBossEnemy(type: string) {
  return type === "boss" || type === "alpha_hellhound";
}
