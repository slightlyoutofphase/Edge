export const ENEMY_JUMP_SPEED = 500;
export const GRAVITY = 1600; // px/sec²
export const TERMINAL_VELOCITY = 1200;

export const PLAYER_STATS = {
  walkSpeed: 150, // px/sec
  runSpeed: 250, // px/sec
  crouchSpeed: 75, // px/sec
  jumpForce: 750, // initial velocity (px/sec)
  jumpHoldBonus: 150, // additional velocity if held (px/sec)

  rollDistance: 180,
  rollDuration: 500, // ms

  backstepDistance: 80,
  backstepDuration: 300, // ms

  slideDistance: 200,
  slideDuration: 500, // ms
  slideCooldown: 500, // ms
  slideStaminaCost: 15,

  coyoteTime: 100, // ms
  jumpBuffer: 100, // ms
  inputBuffer: 133, // ms

  staminaMax: 100,
  staminaRegen: 25,
  runStaminaCostPerSec: 10,
  rollStaminaCost: 20,
  backstepStaminaCost: 10,

  // Combat Stats
  lightAttackCost: 15,
  heavyAttackCost: 30,
  blockBaseCost: 10,
  parryCost: 5,
  recoilStaminaCost: 10, // Cost for hitting a wall

  exhaustionDuration: 1500, // ms
  exhaustionRecoveryThreshold: 30, // stamina
};

export const COMBAT_SETTINGS = {
  zoneHysteresis: 50, // ms
  guardEnterThreshold: -10,
  guardExitThreshold: 10,

  perfectBlockReduction: 0.9,
  adjacentBlockReduction: 0.7,
  mismatchBlockReduction: 0.3,
  guardStanceReduction: 0.45,
  guardStanceStabilityBonus: 0.2,
  guardStanceCostMalus: 1.5,
};

export const CAMERA = {
  lerpSpeed: 5.0,
  deadZoneSize: 64,
  lookAhead: 100, // approx based on logic description (10% zoom or velocity based)
};
