export type InteractionType = "bonfire" | "chest" | "lever" | "door";

export interface InteractableComponent {
  type: InteractionType;
  prompt: string;
  range: number;
  isInteracted: boolean; // State (e.g., chest open, lever pulled)
  data?: any; // e.g., weapon ID for chest, target ID for lever
  persistenceId?: string;
  cooldown: number; // Prevent spam
}
