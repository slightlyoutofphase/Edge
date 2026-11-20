import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AssetLoader } from "../assets/AssetLoader";
import { ENEMY_TYPES } from "../data/EnemyTypes";
import { WEAPONS } from "../data/WeaponDefinitions";
import { AnimationEvent } from "../features/animation/AnimationTypes";
import { AnimationViewer, getAnimationGroups } from "../tools/AnimationViewer";
import {
  createViewerClock,
  ViewerPhaseLabel,
  ViewerTimeLabel,
  ViewerTimeSlider,
} from "./ViewerPlayhead";

interface AnimationViewerPanelProps {
  viewerRef: React.MutableRefObject<AnimationViewer | null>;
  initialAnim: string;
  onQuitToMenu: () => void;
  onToast: (text: string, variant?: "info" | "success" | "error") => void;
}

export const AnimationViewerPanel: React.FC<AnimationViewerPanelProps> = ({
  viewerRef,
  initialAnim,
  onQuitToMenu,
  onToast,
}) => {
  const viewerToolbarRef = useRef<HTMLDivElement>(null);
  const viewerEventsRef = useRef<HTMLDivElement>(null);

  const [viewerEntity, setViewerEntity] = useState("player");
  const [viewerAnim, setViewerAnim] = useState(initialAnim);
  const [viewerPlaying, setViewerPlaying] = useState(() => viewerRef.current?.isPlaying ?? true);
  const [viewerLoop, setViewerLoop] = useState(() => viewerRef.current?.loop ?? true);
  const [viewerSpeed, setViewerSpeed] = useState(() => viewerRef.current?.playbackSpeed ?? 1.0);
  const [viewerClock] = useState(createViewerClock);
  const setViewerTime = viewerClock.setTime;
  const [viewerDuration, setViewerDuration] = useState(() => viewerRef.current?.duration ?? 2000);
  const [viewerAllClips, setViewerAllClips] = useState(false);
  const [viewerMode, setViewerMode] = useState<"clip" | "combat">("clip");
  const [viewerZoom, setViewerZoom] = useState(() => viewerRef.current?.zoom ?? 6);
  const [viewerFacing, setViewerFacing] = useState(() => viewerRef.current?.facing ?? 1);
  const [viewerWeapon, setViewerWeapon] = useState(() => viewerRef.current?.weapon ?? "longsword");
  const [viewerHitboxes, setViewerHitboxes] = useState(
    () => viewerRef.current?.showHitboxes ?? true,
  );
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [animEvents, setAnimEvents] = useState<AnimationEvent[]>(() => {
    const anim = AssetLoader.getAnimation(initialAnim);
    return anim?.events ? [...anim.events] : [];
  });

  const entities = ["player", ...ENEMY_TYPES];

  const animationGroups = useMemo(
    () => getAnimationGroups(viewerEntity, viewerAllClips),
    [viewerEntity, viewerAllClips, AssetLoader.animationRevision],
  );

  const loadAnimEvents = (animName: string) => {
    const anim = AssetLoader.getAnimation(animName);
    if (anim && anim.events) setAnimEvents([...anim.events]);
    else setAnimEvents([]);
    setSelectedEventIndex(null);
  };

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let rafId = 0;
    let lastTime = performance.now();

    const loop = (time: number) => {
      if (viewerRef.current !== viewer) return;
      const dt = Math.min(100, time - lastTime);
      lastTime = time;
      viewer.update(dt);
      setViewerTime(viewer.currentTime);
      setViewerPlaying(viewer.isPlaying);
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [viewerRef, setViewerTime]);

  useLayoutEffect(() => {
    const measure = () => {
      const panel = viewerEventsRef.current?.getBoundingClientRect();
      const toolbar = viewerToolbarRef.current?.getBoundingClientRect();
      if (panel && toolbar) {
        viewerRef.current?.setViewportInsets({
          left: window.innerWidth >= 768 ? panel.right + 12 : 0,
          top: window.innerWidth < 768 ? panel.bottom + 12 : 0,
          bottom: window.innerHeight - toolbar.top,
        });
      }
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    if (viewerEventsRef.current) observer?.observe(viewerEventsRef.current);
    if (viewerToolbarRef.current) observer?.observe(viewerToolbarRef.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [viewerRef]);

  const handleViewerEntityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value;
    setViewerEntity(type);
    if (viewerRef.current) {
      viewerRef.current.spawnEntity(type);
      const name = viewerRef.current.currentAnimName;
      setViewerAnim(name);
      setViewerTime(0);
      setViewerDuration(viewerRef.current.duration);
      loadAnimEvents(name);
    }
  };

  const handleViewerAnimChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    setViewerAnim(name);
    if (viewerRef.current) {
      viewerRef.current.setAnimation(name);
      setViewerDuration(viewerRef.current.duration);
      setViewerTime(0);
      loadAnimEvents(name);
    }
  };

  const handleTimelineScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setViewerTime(t);
    setSelectedEventIndex(null);
    if (viewerRef.current) {
      viewerRef.current.setPlaybackTime(t);
      setViewerPlaying(false);
      viewerRef.current.isPlaying = false;
    }
  };

  const toggleViewerPlay = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setPlaying(!viewer.isPlaying);
    setViewerPlaying(viewer.isPlaying);
    setViewerTime(viewer.currentTime);
    setSelectedEventIndex(null);
  };

  const toggleViewerLoop = () => {
    const next = !viewerLoop;
    setViewerLoop(next);
    if (viewerRef.current) viewerRef.current.loop = next;
  };

  const handleEventSelect = (index: number) => {
    setSelectedEventIndex(index);
    const ev = animEvents[index];
    if (viewerRef.current) {
      const time = viewerRef.current.eventTime(ev);
      setViewerTime(time);
      viewerRef.current.setPlaybackTime(time);
      viewerRef.current.previewHitbox = ev.type === "hitbox-start" ? ev.data : null;
      setViewerPlaying(false);
      viewerRef.current.isPlaying = false;
    }
  };

  const handleEventChange = (field: string, value: any) => {
    if (selectedEventIndex === null) return;
    const updatedEvents = [...animEvents];
    const ev = { ...updatedEvents[selectedEventIndex] };
    if (field === "time") {
      const time = Number(value);
      if (!Number.isFinite(time) || time < 0 || time > 1) return;
      ev.time = time;
    } else if (field === "type") ev.type = value;
    else {
      if (!ev.data) ev.data = {};
      ev.data = { ...ev.data, [field]: value };
    }
    updatedEvents[selectedEventIndex] = ev;
    updatedEvents.sort((a, b) => a.time - b.time);
    setSelectedEventIndex(updatedEvents.indexOf(ev));
    setAnimEvents(updatedEvents);
    const anim = AssetLoader.getAnimation(viewerAnim);
    if (anim) anim.events = updatedEvents;
    if (viewerRef.current) {
      viewerRef.current.refreshEvents();
      viewerRef.current.previewHitbox = ev.type === "hitbox-start" ? ev.data : null;
      setViewerDuration(viewerRef.current.duration);
      setViewerTime(viewerRef.current.currentTime);
    }
  };

  const handleAddEvent = () => {
    const newEvent: AnimationEvent = {
      time: viewerRef.current
        ? viewerRef.current.currentClipTime / viewerRef.current.clipDuration
        : viewerClock.getSnapshot() / viewerDuration,
      type: "sound",
      data: "footstep-right",
    };
    const newEvents = [...animEvents, newEvent];
    newEvents.sort((a, b) => a.time - b.time);
    setAnimEvents(newEvents);
    const anim = AssetLoader.getAnimation(viewerAnim);
    if (anim) anim.events = newEvents;
    if (viewerRef.current) {
      viewerRef.current.refreshEvents();
      setViewerDuration(viewerRef.current.duration);
      setViewerTime(viewerRef.current.currentTime);
    }
  };

  const handleDeleteEvent = () => {
    if (selectedEventIndex === null) return;
    const newEvents = animEvents.filter((_, i) => i !== selectedEventIndex);
    setAnimEvents(newEvents);
    setSelectedEventIndex(null);
    if (viewerRef.current) viewerRef.current.previewHitbox = null;
    const anim = AssetLoader.getAnimation(viewerAnim);
    if (anim) anim.events = newEvents;
    if (viewerRef.current) {
      viewerRef.current.refreshEvents();
      setViewerDuration(viewerRef.current.duration);
      setViewerTime(viewerRef.current.currentTime);
    }
  };

  const handleExportAnimation = () => {
    const anim = AssetLoader.getAnimation(viewerAnim);
    if (!anim) return;
    const json = JSON.stringify(anim, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => onToast("Animation JSON copied to clipboard!", "success"))
      .catch(() => onToast("Failed to copy animation JSON to clipboard.", "error"));
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col md:block">
      <div
        ref={viewerEventsRef}
        className="absolute top-2 md:top-4 left-2 md:left-4 bottom-auto md:bottom-4 w-[calc(100%-16px)] md:w-64 bg-neutral-900/90 border border-white/10 backdrop-blur pointer-events-auto flex flex-col p-3 md:p-4 rounded-lg z-20 max-h-[40vh] md:max-h-none shadow-2xl">
        <div className="flex flex-col gap-2 mb-2 md:mb-4 border-b border-white/10 pb-2">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-white text-[10px] md:text-xs uppercase tracking-tighter">
              Events
            </h3>
            <button
              onClick={onQuitToMenu}
              className="text-neutral-400 hover:text-white text-[10px] md:text-xs font-bold px-2 py-1 rounded border border-white/10 hover:bg-white/5 uppercase">
              Exit
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddEvent}
              className="flex-1 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 text-[9px] md:text-xs font-bold py-1.5 rounded border border-blue-500/30 uppercase tracking-widest transition-colors">
              + Add
            </button>
            <button
              onClick={handleExportAnimation}
              className="flex-1 bg-green-600/20 hover:bg-green-600/40 text-green-400 text-[9px] md:text-xs font-bold py-1.5 rounded border border-green-500/30 uppercase tracking-widest transition-colors">
              Export
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-1 mb-2 md:mb-4">
          {animEvents.map((ev, i) => (
            <div
              key={i}
              onClick={() => handleEventSelect(i)}
              className={`p-1.5 md:p-2 rounded text-[10px] md:text-xs font-mono cursor-pointer border ${selectedEventIndex === i ? "bg-blue-600/30 border-blue-500 text-white" : "bg-black/30 border-transparent text-neutral-400 hover:bg-white/5"}`}>
              <div className="flex justify-between">
                <span>{ev.type}</span>
                <span>{(ev.time * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}
        </div>
        {selectedEventIndex !== null && animEvents[selectedEventIndex] && (
          <div className="border-t border-white/10 pt-2 md:pt-4 space-y-2 md:space-y-3 hidden md:block">
            <div className="flex flex-col">
              <label className="text-[9px] md:text-[10px] text-neutral-500 font-bold uppercase mb-1">
                Type
              </label>
              <select
                value={animEvents[selectedEventIndex].type}
                onChange={(e) => handleEventChange("type", e.target.value)}
                className="bg-black border border-white/10 rounded px-2 py-1 text-[10px] md:text-xs text-white">
                <option value="sound">Sound</option>
                <option value="hitbox-start">Hitbox Start</option>
                <option value="hitbox-end">Hitbox End</option>
                <option value="effect">Effect</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] md:text-[10px] text-neutral-500 font-bold uppercase mb-1">
                Time (0-1)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={animEvents[selectedEventIndex].time}
                onChange={(e) => handleEventChange("time", e.target.value)}
                className="bg-black border border-white/10 rounded px-2 py-1 text-[10px] md:text-xs text-white"
              />
            </div>
            <button
              onClick={handleDeleteEvent}
              className="w-full bg-red-900/50 hover:bg-red-800 text-red-200 text-[10px] md:text-xs py-1.5 md:py-2 rounded mt-1 md:mt-2 uppercase font-bold">
              Delete
            </button>
          </div>
        )}
      </div>
      <div
        ref={viewerToolbarRef}
        className="absolute bottom-0 left-0 w-full bg-neutral-900/95 border-t border-white/10 p-3 md:p-6 pointer-events-auto backdrop-blur flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-8 md:pl-72 z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="flex flex-row md:flex-col gap-2 min-w-0 md:min-w-[200px]">
          <div className="flex flex-col flex-1">
            <label className="text-[8px] md:text-[10px] uppercase font-bold text-neutral-500 mb-0.5">
              Entity
            </label>
            <select
              value={viewerEntity}
              onChange={handleViewerEntityChange}
              className="bg-black/50 border border-white/10 rounded px-2 py-1 text-[10px] md:text-sm text-white">
              {entities.map((e) => (
                <option key={e} value={e}>
                  {e.replaceAll("_", " ").toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col flex-1">
            <label className="text-[8px] md:text-[10px] uppercase font-bold text-neutral-500 mb-0.5">
              Animation
            </label>
            <select
              value={viewerAnim}
              onChange={handleViewerAnimChange}
              className="bg-black/50 border border-white/10 rounded px-2 py-1 text-[10px] md:text-sm text-white">
              {animationGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.names.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[10px] text-neutral-400 mt-1">
              <input
                type="checkbox"
                checked={viewerAllClips}
                onChange={(e) => {
                  setViewerAllClips(e.target.checked);
                  if (
                    !e.target.checked &&
                    !getAnimationGroups(viewerEntity).some((group) =>
                      group.names.includes(viewerAnim),
                    )
                  ) {
                    viewerRef.current?.setAnimation("idle");
                    setViewerAnim("idle");
                    setViewerTime(0);
                    setViewerDuration(viewerRef.current?.duration ?? 2000);
                    loadAnimEvents("idle");
                  }
                }}
              />{" "}
              Show other characters’ clips
            </label>
          </div>
        </div>
        <div className="flex-1 flex flex-col gap-1.5 md:gap-2 min-w-0">
          <div className="flex justify-between items-center">
            <div className="flex gap-1 md:gap-2">
              <button
                onClick={toggleViewerPlay}
                className={`px-2 py-1 md:px-3 md:py-1 rounded text-[9px] md:text-xs font-bold uppercase transition-colors ${viewerPlaying ? "bg-red-500/20 text-red-400 border border-red-500/50" : "bg-green-500/20 text-green-400 border border-green-500/50"}`}>
                {viewerPlaying ? "Pause" : "Play"}
              </button>
              <button
                onClick={toggleViewerLoop}
                className={`px-2 py-1 md:px-3 md:py-1 rounded text-[9px] md:text-xs font-bold uppercase transition-colors border ${viewerLoop ? "bg-blue-500/20 text-blue-400 border-blue-500/50" : "bg-transparent text-neutral-500 border-white/10"}`}>
                Loop: {viewerLoop ? "ON" : "OFF"}
              </button>
              {[-1, 1].map((direction) => (
                <button
                  key={direction}
                  aria-label={direction < 0 ? "Previous frame" : "Next frame"}
                  title={direction < 0 ? "Previous frame (60 fps)" : "Next frame (60 fps)"}
                  className="px-2 py-1 text-xs text-white border border-white/10 rounded"
                  onClick={() => {
                    viewerRef.current?.stepFrame(direction);
                    setViewerPlaying(false);
                    setSelectedEventIndex(null);
                    setViewerTime(viewerRef.current?.currentTime ?? 0);
                  }}>
                  {direction < 0 ? "◀" : "▶"}
                </button>
              ))}
            </div>
            <ViewerTimeLabel clock={viewerClock} duration={viewerDuration} />
          </div>
          <div className="relative pt-9">
            {viewerRef.current?.hitWindows.map((window, i) => (
              <span
                key={i}
                className="absolute bottom-0 h-2 bg-green-500/30 rounded pointer-events-none"
                style={{
                  left: `${(window.start / viewerDuration) * 100}%`,
                  width: `${((window.end - window.start) / viewerDuration) * 100}%`,
                }}
              />
            ))}
            {animEvents.map((event, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${event.type} at ${(event.time * 100).toFixed(0)} percent`}
                title={`${event.type} · ${Math.round(viewerRef.current?.eventTime(event) ?? event.time * viewerDuration)} ms`}
                onClick={() => handleEventSelect(i)}
                className={`absolute w-2 h-2 -translate-x-1/2 rounded-sm ${event.type.startsWith("hitbox") ? "bg-green-400" : event.type === "sound" ? "bg-yellow-400" : "bg-purple-400"}`}
                style={{
                  top: event.type.startsWith("hitbox") ? 0 : event.type === "sound" ? 10 : 20,
                  left: `${Math.min(100, Math.max(0, ((viewerRef.current?.eventTime(event) ?? event.time * viewerDuration) / viewerDuration) * 100))}%`,
                }}
              />
            ))}
            <ViewerTimeSlider
              clock={viewerClock}
              duration={viewerDuration}
              onChange={handleTimelineScrub}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[8px] md:text-[10px] uppercase font-bold text-neutral-500">
              Speed
            </label>
            <input
              type="range"
              min="0.1"
              max="2.0"
              step="0.1"
              value={viewerSpeed}
              onChange={(e) => {
                const s = parseFloat(e.target.value);
                setViewerSpeed(s);
                if (viewerRef.current) viewerRef.current.playbackSpeed = s;
              }}
              className="flex-1 max-w-[100px] accent-neutral-500 h-1 bg-black/50 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[9px] md:text-xs font-mono text-neutral-400">
              {viewerSpeed.toFixed(1)}x
            </span>
          </div>
          <ViewerPhaseLabel clock={viewerClock} getPhase={() => viewerRef.current?.playbackPhase} />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px] md:text-xs md:w-56">
          <label className="flex flex-col gap-1 text-neutral-400">
            Playback
            <select
              value={viewerMode}
              className="bg-black/50 border border-white/10 rounded p-1 text-white"
              onChange={(e) => {
                const mode = e.target.value as "clip" | "combat";
                setViewerMode(mode);
                viewerRef.current?.setPlaybackMode(mode);
                setViewerDuration(viewerRef.current?.duration ?? 2000);
                setViewerTime(viewerRef.current?.currentTime ?? 0);
              }}>
              <option value="clip">Raw clip</option>
              <option value="combat">Base combat timing</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-neutral-400">
            Weapon
            <select
              value={viewerWeapon}
              disabled={viewerEntity !== "player"}
              className="bg-black/50 border border-white/10 rounded p-1 text-white disabled:opacity-40"
              onChange={(e) => {
                setViewerWeapon(e.target.value);
                viewerRef.current?.setWeapon(e.target.value);
                setViewerDuration(viewerRef.current?.duration ?? 2000);
                setViewerTime(viewerRef.current?.currentTime ?? 0);
              }}>
              {Object.keys(WEAPONS).map((id) => (
                <option key={id} value={id}>
                  {WEAPONS[id].name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-neutral-400">
            Zoom
            <input
              type="range"
              aria-label="Preview zoom"
              min="1"
              max="10"
              step="0.5"
              value={viewerZoom}
              className="w-16 accent-blue-500"
              onChange={(e) => {
                const zoom = Number(e.target.value);
                setViewerZoom(zoom);
                if (viewerRef.current) viewerRef.current.zoom = zoom;
              }}
            />
          </label>
          <button
            className="border border-white/10 rounded p-1 text-white"
            onClick={() => {
              viewerRef.current?.flipFacing();
              setViewerFacing(viewerRef.current?.facing ?? 1);
            }}>
            Facing: {viewerFacing === 1 ? "Right" : "Left"}
          </button>
          <label className="flex items-center gap-2 text-neutral-400">
            <input
              type="checkbox"
              checked={viewerHitboxes}
              onChange={(e) => {
                setViewerHitboxes(e.target.checked);
                if (viewerRef.current) viewerRef.current.showHitboxes = e.target.checked;
              }}
            />{" "}
            Hitboxes
          </label>
          {viewerMode === "combat" && !viewerRef.current?.hasCombatTiming && (
            <span className="text-neutral-400">No attack timing; raw clip.</span>
          )}
        </div>
      </div>
    </div>
  );
};
