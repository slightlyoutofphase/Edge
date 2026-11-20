export interface MovementStateComponent {
  current:
    | "idle"
    | "walk"
    | "run"
    | "jump"
    | "fall"
    | "crouch"
    | "crouchWalk"
    | "roll"
    | "slide"
    | "backstep"
    | "climb"
    | "land";
  previousGrounded: boolean;
  coyoteTimer: number;
  slideTimer: number;
  slideCooldown: number;
  rollTimer: number;
  rollDirection?: -1 | 1;
  backstepTimer: number;
  jumpBufferTimer: number;
  dropThroughTimer: number; // For semi-solid drop
  landingTimer?: number; // Visual response, independent of movement/input permission.
  aerialAttackLanding?: number;
  aerialLandingRecovery?: number;
  ladderTop?: number;
  ladderCenter?: number;
}
