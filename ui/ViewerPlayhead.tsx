import { ChangeEvent, useSyncExternalStore } from "react";

// Only moving playback readouts subscribe; playback does not rerender the app.
export function createViewerClock() {
  let time = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => time,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setTime: (next: number) => {
      if (Object.is(time, next)) return;
      time = next;
      for (const listener of listeners) listener();
    },
  };
}

type Clock = ReturnType<typeof createViewerClock>;

export function ViewerTimeLabel({ clock, duration }: { clock: Clock; duration: number }) {
  const time = useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  return (
    <span className="font-mono text-[9px] md:text-xs text-neutral-400">
      {Math.floor(time)}ms / {Math.floor(duration)}ms
    </span>
  );
}

export function ViewerTimeSlider({
  clock,
  duration,
  onChange,
}: {
  clock: Clock;
  duration: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const time = useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  return (
    <input
      type="range"
      min="0"
      max={duration}
      value={time}
      onChange={onChange}
      className="w-full accent-blue-500 h-1.5 md:h-2 bg-black/50 rounded-lg appearance-none cursor-pointer"
    />
  );
}

export function ViewerPhaseLabel({
  clock,
  getPhase,
}: {
  clock: Clock;
  getPhase: () => string | undefined;
}) {
  useSyncExternalStore(clock.subscribe, clock.getSnapshot);
  return (
    <span className="text-[9px] text-neutral-400">
      {getPhase()} · green: hit windows · yellow: sound
    </span>
  );
}
