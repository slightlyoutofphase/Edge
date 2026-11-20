import { World } from "../core/World";
import { SoundRequestComponent } from "../components/SoundRequest";
import { CameraState } from "../core/Resources";
import { ObjectPool } from "../utils/ObjectPool";
import { AudioDefinitions } from "../assets/audio/AudioDefinitions";
import { clamp } from "../utils/Math";

class AudioVoice {
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
  active: boolean = false;
  startTime: number = 0;

  // Priority tracking
  currentPriority: number = 5; // Default Low
  baseVolume: number = 1.0;

  constructor(ctx: AudioContext) {
    this.gainNode = ctx.createGain();
    if (ctx.createStereoPanner) {
      this.pannerNode = ctx.createStereoPanner();
    } else {
      this.pannerNode = (ctx as any).createStereoPanner
        ? (ctx as any).createStereoPanner()
        : ctx.createPanner();
    }

    this.gainNode.connect(this.pannerNode);
    this.pannerNode.connect(ctx.destination);
  }

  source: AudioScheduledSourceNode | null = null;
  filter: AudioNode | null = null;
  generation = 0;

  reset() {
    this.active = false;
    this.gainNode.gain.cancelScheduledValues(0);
    this.gainNode.gain.value = 0;
    this.currentPriority = 5;
  }
  stopSource() {
    this.generation++;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* Already ended. */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.filter?.disconnect();
    this.filter = null;
  }

  disconnect() {
    this.stopSource();
    this.reset();
    this.gainNode.disconnect();
    this.pannerNode.disconnect();
  }
}

export class AudioSystem {
  ctx: AudioContext | null = null;
  public recentPlayed: string[] = []; // For testing validation
  public recentParams: Record<string, any> = {}; // For testing param validation

  private voicePool: ObjectPool<AudioVoice>;
  private activeVoices: AudioVoice[] = [];
  private voices = new Set<AudioVoice>();
  private unlockHandler: (() => void) | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private world: World) {
    if (
      typeof window !== "undefined" &&
      (window.AudioContext || (window as any).webkitAudioContext)
    ) {
      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
      try {
        this.ctx = new AudioCtor();
      } catch {
        this.ctx = null;
      }
    }

    this.voicePool = new ObjectPool<AudioVoice>(
      () => {
        const voice = new AudioVoice(this.ctx!);
        this.voices.add(voice);
        return voice;
      },
      (voice) => voice.reset(),
      this.ctx ? 10 : 0, // No-op backend when Web Audio is unavailable
    );

    if (typeof window !== "undefined" && this.ctx) {
      const resumeHandler = async () => {
        if (!this.ctx) return;
        if (this.ctx.state === "suspended") {
          try {
            await this.ctx.resume();
          } catch {
            // Keep listeners attached if resume fails or stays suspended
          }
        }
        if (this.ctx && (this.ctx.state as string) === "running") {
          window.removeEventListener("click", resumeHandler);
          window.removeEventListener("keydown", resumeHandler);
          if (this.unlockHandler === resumeHandler) this.unlockHandler = null;
        }
      };
      this.unlockHandler = resumeHandler;
      window.addEventListener("click", resumeHandler);
      window.addEventListener("keydown", resumeHandler);
    }
  }

  reset() {
    for (const voice of this.activeVoices) {
      voice.stopSource();
      voice.reset();
      this.voicePool.release(voice);
    }
    this.activeVoices = [];
    this.recentPlayed = [];
    this.recentParams = {};
  }

  dispose() {
    this.reset();
    if (this.unlockHandler) {
      window.removeEventListener("click", this.unlockHandler);
      window.removeEventListener("keydown", this.unlockHandler);
      this.unlockHandler = null;
    }
    for (const voice of this.voices) voice.disconnect();
    this.voices.clear();
    if (this.ctx && typeof this.ctx.close === "function") void this.ctx.close().catch(() => {});
    this.ctx = null;
    this.noiseBuffer = null;
  }

  update() {
    this.recentPlayed = [];
    this.recentParams = {};

    // --- Process Sound Requests ---
    const entities = this.world.query("SoundRequest");
    for (const { id, components } of entities) {
      const soundReq = components[0] as SoundRequestComponent;

      for (const req of soundReq.requests) {
        // Support both string data (legacy) and object data from AnimationEvents
        if (typeof req === "string") {
          this.playSound(req);
        } else {
          this.playSound(req.id, req.volume, req.pitch, req.position);
        }
      }

      this.world.removeComponent(id, "SoundRequest");
      if (this.world.isEmptyEntity(id)) this.world.destroyEntity(id);
    }
  }

  playSound(
    id: string,
    volumeScale: number = 1.0,
    pitchScale: number = 1.0,
    position?: { x: number; y: number },
  ) {
    // Track history for tests (and logic if needed later)
    this.recentPlayed.push(id);
    this.recentParams[id] = { volume: volumeScale, pitch: pitchScale, position };

    if (!this.ctx) return;

    const def = AudioDefinitions[id];
    if (!def) return;

    // --- Priority Check ---
    // If pool is full, try to steal from lower priority
    let voice: AudioVoice | null = null;

    if (this.voicePool.getStats().free > 0) {
      voice = this.voicePool.acquire();
    } else {
      // Find lowest priority active voice
      let lowestPriorityVoice: AudioVoice | null = null;
      let lowestPriorityVal = -1;

      for (const v of this.activeVoices) {
        if (v.currentPriority > lowestPriorityVal) {
          lowestPriorityVal = v.currentPriority;
          lowestPriorityVoice = v;
        }
      }

      // Can we steal?
      if (lowestPriorityVoice && lowestPriorityVal > def.priority) {
        // Steal it
        lowestPriorityVoice.gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
        lowestPriorityVoice.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        lowestPriorityVoice.stopSource();
        this.voicePool.release(lowestPriorityVoice);
        this.activeVoices.splice(this.activeVoices.indexOf(lowestPriorityVoice), 1);
        voice = this.voicePool.acquire();
      } else {
        return;
      }
    }

    if (!voice) return;

    this.activeVoices.push(voice);
    voice.active = true;
    voice.currentPriority = def.priority;
    voice.baseVolume = def.volume * volumeScale;

    const now = this.ctx.currentTime;
    const durationSec = def.duration / 1000;

    // --- Variance ---
    let playbackRate = pitchScale;
    if (def.pitchVariance) {
      playbackRate *= 1.0 + (Math.random() * 2 - 1) * def.pitchVariance;
    }

    let finalVolume = voice.baseVolume;
    if (def.volumeVariance) {
      finalVolume *= 1.0 + (Math.random() * 2 - 1) * def.volumeVariance;
    }
    finalVolume = clamp(finalVolume, 0, 1);

    // --- Synthesis ---
    let source: AudioScheduledSourceNode;

    if (def.type === "noise") {
      source = this.createNoiseBuffer();
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = def.oscType || "sine";
      if (def.frequencyStart) {
        const startFreq = Math.max(0.01, def.frequencyStart * playbackRate);
        osc.frequency.setValueAtTime(startFreq, now);
        if (def.frequencyEnd !== undefined) {
          const endFreq = def.frequencyEnd * playbackRate;
          if (endFreq > 0) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + durationSec);
          } else {
            osc.frequency.linearRampToValueAtTime(0, now + durationSec);
          }
        }
      }
      source = osc;
    }

    // --- Filter ---
    voice.source = source;
    const generation = ++voice.generation;
    let lastNode: AudioNode = source;
    if (def.filter) {
      const filter = this.ctx.createBiquadFilter();
      voice.filter = filter;
      filter.type = def.filter.type;
      filter.frequency.setValueAtTime(def.filter.frequency, now);
      source.connect(filter);
      lastNode = filter;
    }

    lastNode.connect(voice.gainNode);

    // --- Envelope ---
    const env = def.envelope || { attack: 0.01, decay: 0, sustain: 1, release: 0.01 };
    const gain = voice.gainNode.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(finalVolume, now + env.attack);
    gain.linearRampToValueAtTime(finalVolume * env.sustain, now + env.attack + env.decay);
    gain.linearRampToValueAtTime(0, now + durationSec);

    if (voice.pannerNode.pan) {
      let pan = 0;
      if (position) {
        const camera = this.world.getResource<CameraState>(CameraState);
        if (camera && camera.zoom > 0 && camera.viewport.x > 0) {
          const halfViewW = camera.viewport.x / camera.zoom / 2;
          if (halfViewW > 0) {
            pan = clamp((position.x - camera.position.x) / halfViewW, -1, 1);
          }
        }
      }
      voice.pannerNode.pan.setValueAtTime(pan, now);
    }

    source.start(now);
    source.stop(now + durationSec + 0.1);

    source.onended = () => {
      if (voice!.generation !== generation) return;
      source.disconnect();
      voice!.source = null;
      voice!.filter?.disconnect();
      voice!.filter = null;
      this.voicePool.release(voice!);
      const idx = this.activeVoices.indexOf(voice!);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    };
  }

  private createNoiseBuffer(): AudioBufferSourceNode {
    const bufferSize = this.ctx!.sampleRate * 2;
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.ctx!.createBuffer(1, bufferSize, this.ctx!.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    }
    const buffer = this.noiseBuffer;

    const noise = this.ctx!.createBufferSource();
    noise.buffer = buffer;
    return noise;
  }

  getPoolStats() {
    return this.voicePool.getStats();
  }

  getContextState() {
    return this.ctx?.state;
  }

  mockResume() {
    if (this.ctx) {
      Object.defineProperty(this.ctx, "state", { value: "running", writable: true });
    }
  }

  // Test helper to check active priorities
  getActivePriorities() {
    return this.activeVoices.map((v) => v.currentPriority);
  }
}
