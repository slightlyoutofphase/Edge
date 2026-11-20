import { Vec2 } from "../utils/Vec2";

export interface SoundRequest {
  id: string;
  volume?: number;
  pitch?: number;
  position?: Vec2;
}

export interface SoundRequestComponent {
  requests: SoundRequest[];
}
