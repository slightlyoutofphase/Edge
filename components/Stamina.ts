export interface StaminaComponent {
  current: number;
  max: number;
  regenRate: number;
  regenPaused: boolean;
  isExhausted: boolean;
}
