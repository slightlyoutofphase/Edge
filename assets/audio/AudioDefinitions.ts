import { AudioKey } from "../../core/AssetKeys";

export type AudioSynthType = "oscillator" | "noise";

export interface AudioDefinition {
  id: AudioKey;
  type: AudioSynthType;
  oscType?: OscillatorType; // 'sine' | 'square' | 'sawtooth' | 'triangle'
  duration: number; // ms
  frequencyStart?: number;
  frequencyEnd?: number;
  volume: number;
  envelope?: {
    attack: number;
    decay: number;
    sustain: number;
    release: number;
  };
  filter?: {
    type: BiquadFilterType;
    frequency: number;
  };
  pitchVariance?: number; // 0 to 1 range
  volumeVariance?: number; // 0 to 1 range
  priority: number; // 1 (High) to 5 (Low)
}

export const AudioDefinitions: Record<string, AudioDefinition> = {
  // Priority 4: Movement
  [AudioKey.FOOTSTEP_RIGHT]: {
    id: AudioKey.FOOTSTEP_RIGHT,
    type: "noise",
    duration: 100,
    volume: 0.3,
    envelope: { attack: 0.01, decay: 0.05, sustain: 0, release: 0.04 },
    filter: { type: "lowpass", frequency: 600 },
    pitchVariance: 0.2,
    priority: 4,
  },
  [AudioKey.FOOTSTEP_LEFT]: {
    id: AudioKey.FOOTSTEP_LEFT,
    type: "noise",
    duration: 100,
    volume: 0.3,
    envelope: { attack: 0.01, decay: 0.05, sustain: 0, release: 0.04 },
    filter: { type: "lowpass", frequency: 500 },
    pitchVariance: 0.2,
    priority: 4,
  },
  [AudioKey.JUMP]: {
    id: AudioKey.JUMP,
    type: "oscillator",
    oscType: "sine",
    duration: 200,
    frequencyStart: 150,
    frequencyEnd: 300,
    volume: 0.2,
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 },
    pitchVariance: 0.1,
    priority: 4,
  },
  [AudioKey.LAND]: {
    id: AudioKey.LAND,
    type: "noise",
    duration: 150,
    volume: 0.4,
    envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.04 },
    filter: { type: "lowpass", frequency: 200 },
    priority: 4,
  },
  [AudioKey.ROLL]: {
    id: AudioKey.ROLL,
    type: "noise",
    duration: 400,
    volume: 0.2,
    envelope: { attack: 0.1, decay: 0.1, sustain: 0.8, release: 0.2 },
    filter: { type: "bandpass", frequency: 400 },
    priority: 4,
  },
  [AudioKey.SLIDE]: {
    id: AudioKey.SLIDE,
    type: "noise",
    duration: 500,
    volume: 0.2,
    envelope: { attack: 0.05, decay: 0, sustain: 1, release: 0.1 },
    filter: { type: "lowpass", frequency: 300 },
    priority: 4,
  },

  // Priority 2: Player Combat
  [AudioKey.SWING_WHOOSH]: {
    id: AudioKey.SWING_WHOOSH,
    type: "noise",
    duration: 150,
    volume: 0.3,
    envelope: { attack: 0.02, decay: 0.1, sustain: 0, release: 0.03 },
    filter: { type: "bandpass", frequency: 800 },
    pitchVariance: 0.1,
    priority: 2,
  },
  [AudioKey.BLOCK]: {
    id: AudioKey.BLOCK,
    type: "noise",
    duration: 100,
    volume: 0.5,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    filter: { type: "highpass", frequency: 1000 },
    priority: 2,
  },
  [AudioKey.PARRY]: {
    id: AudioKey.PARRY,
    type: "oscillator",
    oscType: "sine",
    duration: 400,
    frequencyStart: 800,
    frequencyEnd: 1200,
    volume: 0.6,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    priority: 2,
  },

  // Priority 3: Hits / Enemy
  [AudioKey.HIT_FLESH]: {
    id: AudioKey.HIT_FLESH,
    type: "noise",
    duration: 100,
    volume: 0.5,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 },
    filter: { type: "lowpass", frequency: 400 },
    priority: 3,
  },
  [AudioKey.HIT_METAL]: {
    id: AudioKey.HIT_METAL,
    type: "oscillator",
    oscType: "square",
    duration: 150,
    frequencyStart: 200,
    frequencyEnd: 100,
    volume: 0.4,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    filter: { type: "highpass", frequency: 800 },
    priority: 3,
  },
  [AudioKey.STAGGER]: {
    id: AudioKey.STAGGER,
    type: "noise",
    duration: 200,
    volume: 0.4,
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.2, release: 0.1 },
    filter: { type: "lowpass", frequency: 200 },
    priority: 3,
  },
  [AudioKey.ENEMY_TELL]: {
    id: AudioKey.ENEMY_TELL,
    type: "oscillator",
    oscType: "sawtooth",
    duration: 300,
    frequencyStart: 400,
    frequencyEnd: 200,
    volume: 0.4,
    envelope: { attack: 0.05, decay: 0.2, sustain: 0, release: 0.05 },
    priority: 3,
  },
  [AudioKey.ENEMY_HIT]: {
    id: AudioKey.ENEMY_HIT,
    type: "noise",
    duration: 120,
    volume: 0.5,
    envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.02 },
    filter: { type: "lowpass", frequency: 500 },
    priority: 3,
  },
  [AudioKey.ENEMY_DEATH]: {
    id: AudioKey.ENEMY_DEATH,
    type: "noise",
    duration: 500,
    volume: 0.5,
    envelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.1 },
    filter: { type: "lowpass", frequency: 100 },
    priority: 3,
  },

  // Priority 1: Player Status (High)
  [AudioKey.PLAYER_DAMAGE]: {
    id: AudioKey.PLAYER_DAMAGE,
    type: "noise",
    duration: 300,
    volume: 0.8,
    envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
    filter: { type: "highpass", frequency: 200 },
    priority: 1,
  },
  [AudioKey.DEATH]: {
    id: AudioKey.DEATH,
    type: "oscillator",
    oscType: "sawtooth",
    duration: 1500,
    frequencyStart: 100,
    frequencyEnd: 20,
    volume: 0.8,
    envelope: { attack: 0.01, decay: 1.0, sustain: 0, release: 0.5 },
    priority: 1,
  },
  [AudioKey.RESPAWN]: {
    id: AudioKey.RESPAWN,
    type: "oscillator",
    oscType: "sine",
    duration: 1000,
    frequencyStart: 200,
    frequencyEnd: 600,
    volume: 0.6,
    envelope: { attack: 0.1, decay: 0.5, sustain: 0, release: 0.4 },
    priority: 1,
  },

  // UI (Priority 5 - implicitly ambient/low)
  [AudioKey.UI_MENU]: {
    id: AudioKey.UI_MENU,
    type: "oscillator",
    oscType: "sine",
    duration: 50,
    frequencyStart: 800,
    frequencyEnd: 800,
    volume: 0.1,
    envelope: { attack: 0.005, decay: 0.045, sustain: 0, release: 0 },
    priority: 5,
  },
  [AudioKey.UI_CHECKPOINT]: {
    id: AudioKey.UI_CHECKPOINT,
    type: "oscillator",
    oscType: "triangle",
    duration: 1000,
    frequencyStart: 200,
    frequencyEnd: 600,
    volume: 0.3,
    envelope: { attack: 0.1, decay: 0.5, sustain: 0, release: 0.4 },
    priority: 5,
  },
};
