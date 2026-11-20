export interface BufferedInput {
  action: "lightAttack" | "heavyAttack" | "roll" | "jump";
  timestamp: number;
  priority: number;
  moveLeft?: boolean;
  moveRight?: boolean;
}

export interface PlayerInputComponent {
  buffer: BufferedInput | null;
}
