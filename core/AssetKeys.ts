export enum AudioKey {
  FOOTSTEP_RIGHT = "footstep-right",
  FOOTSTEP_LEFT = "footstep-left",
  JUMP = "jump",
  LAND = "land",
  ROLL = "roll",
  SLIDE = "slide",
  SWING_WHOOSH = "swing-whoosh",
  BLOCK = "block",
  PARRY = "parry",
  HIT_FLESH = "hit-flesh",
  HIT_METAL = "hit-metal",
  STAGGER = "stagger",
  ENEMY_TELL = "enemy-tell",
  ENEMY_HIT = "enemy-hit",
  ENEMY_DEATH = "enemy-death",
  PLAYER_DAMAGE = "player-damage",
  DEATH = "death",
  RESPAWN = "respawn",
  UI_MENU = "ui-menu",
  UI_CHECKPOINT = "ui-checkpoint",
}

export enum AnimationKey {
  IDLE = "idle",
  WALK = "walk",
  RUN = "run",
  JUMP = "jump",
  FALL = "fall",
  CROUCH = "crouch",
  CROUCH_WALK = "crouchWalk",
  ROLL = "roll",
  SLIDE = "slide",
  LAND = "land",
  BACKSTEP = "backstep",
  CLIMB = "climb",
  DEATH = "death",

  // Player Attacks
  LIGHT_ATTACK_HIGH = "light_attack_high",
  LIGHT_ATTACK_MID = "light_attack_mid",
  LIGHT_ATTACK_LOW = "light_attack_low",
  HEAVY_ATTACK_HIGH = "heavy_attack_high",
  HEAVY_ATTACK_MID = "heavy_attack_mid",
  HEAVY_ATTACK_LOW = "heavy_attack_low",
  SLIDE_ATTACK = "slide_attack",
  JUMP_ATTACK = "jump_attack",
  PARRY = "parry",
  STAGGER_LIGHT = "stagger_light",
  STAGGER_HEAVY = "stagger_heavy",

  // Enemy Walks
  HOLLOW_WALK = "hollow_walk",
  SOLDIER_WALK = "soldier_walk",
  DUELIST_WALK = "duelist_walk",
  BRUTE_WALK = "brute_walk",
  BOSS_WALK = "boss_walk",
  /* Fix: Add ROGUE_WALK key */
  ROGUE_WALK = "rogue_walk",

  // Enemy Specific (Prefix with type for safety, though strings match)
  HOLLOW_ATTACK_MID = "hollow_light_attack_mid",
  HOLLOW_ATTACK_LOW = "hollow_light_attack_low", // NEW
  HOLLOW_ATTACK_SPECIAL = "hollow_special_attack",

  SOLDIER_ATTACK_MID = "soldier_light_attack_mid",
  SOLDIER_ATTACK_HIGH = "soldier_light_attack_high",
  SOLDIER_ATTACK_LOW = "soldier_light_attack_low",
  SOLDIER_ATTACK_THRUST = "soldier_light_attack_thrust", // NEW
  SOLDIER_ATTACK_SPECIAL = "soldier_special_attack",

  DUELIST_ATTACK_THRUST = "duelist_light_attack_mid",
  DUELIST_ATTACK_HIGH = "duelist_light_attack_high", // NEW
  DUELIST_ATTACK_LOW = "duelist_light_attack_low",
  DUELIST_ATTACK_SPECIAL = "duelist_special_attack",

  BRUTE_ATTACK_SMASH = "brute_heavy_attack_mid",
  BRUTE_ATTACK_SWEEP = "brute_heavy_attack_sweep", // NEW
  BRUTE_ATTACK_RISE = "brute_heavy_attack_high",

  /* Fix: Add Rogue specific attack keys */
  ROGUE_ATTACK_MID = "rogue_light_attack_mid",
  ROGUE_ATTACK_HIGH = "rogue_light_attack_high",
  ROGUE_ATTACK_LOW = "rogue_light_attack_low",
  ROGUE_ATTACK_SPECIAL = "rogue_special_attack",

  // Boss
  BOSS_ATTACK_SMASH = "boss_heavy_attack_mid",
  BOSS_ATTACK_THRUST = "boss_heavy_attack_thrust", // NEW
  BOSS_ATTACK_SWEEP = "boss_heavy_attack_low",
  BOSS_ATTACK_OVERHEAD = "boss_heavy_attack_high",
  BOSS_ATTACK_SPECIAL_REAP = "boss_special_attack_reap",
  BOSS_ATTACK_SPECIAL_SKEWER = "boss_special_attack_skewer",

  HELLHOUND_ATTACK_LOW = "hellhound_light_attack_low",
  HELLHOUND_ATTACK_MID = "hellhound_light_attack_mid",
  HELLHOUND_ATTACK_HIGH = "hellhound_light_attack_high",
  ALPHA_HELLHOUND_ATTACK_LOW = "alpha_hellhound_heavy_attack_low",
  ALPHA_HELLHOUND_ATTACK_MID = "alpha_hellhound_heavy_attack_mid",
  ALPHA_HELLHOUND_ATTACK_HIGH = "alpha_hellhound_heavy_attack_high",
  ALPHA_HELLHOUND_SPECIAL_MAUL = "alpha_hellhound_special_attack_maul",
  ALPHA_HELLHOUND_SPECIAL_SLAM = "alpha_hellhound_special_attack_slam",
}

export enum SkeletonKey {
  PLAYER = "player-skeleton",
  QUADRUPED = "quadruped-skeleton",
}
