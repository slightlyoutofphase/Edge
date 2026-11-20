import React, { useState } from "react";
import { AssetLoader } from "../assets/AssetLoader";
import { ENEMY_STATS } from "../data/EnemyStats";
import { WEAPONS } from "../data/WeaponDefinitions";
import { ConfirmDialog } from "./DialogOverlay";

interface ContentEditorPanelProps {
  onBack: () => void;
  onToast: (text: string, variant?: "info" | "success" | "error") => void;
}

const NUMERIC_BOUNDS: Record<string, { min: number; max?: number; integer?: boolean }> = {
  health: { min: 1 },
  poise: { min: 1 },
  attackPower: { min: 0 },
  windupFrames: { min: 1, integer: true },
  aggroRange: { min: 0 },
  attackRange: { min: 1 },
  attackCooldown: { min: 1, integer: true },
  parryWindowFrames: { min: 0, integer: true },
  parryChance: { min: 0, max: 1 },
  blockChance: { min: 0, max: 1 },
  flankJumpSpeed: { min: 0 },
  baseDamage: { min: 0 },
  staminaCostLight: { min: 0 },
  staminaCostHeavy: { min: 0 },
  poiseDamageLight: { min: 0 },
  poiseDamageHeavy: { min: 0 },
  blockStability: { min: 0, max: 100 },
  reach: { min: 1 },
  arcWidth: { min: 1, max: 360 },
  anticipation: { min: 1, integer: true },
  active: { min: 1, integer: true },
  recovery: { min: 1, integer: true },
};

export const ContentEditorPanel: React.FC<ContentEditorPanelProps> = ({ onBack, onToast }) => {
  const [category, setCategory] = useState<"enemies" | "weapons">("enemies");
  const [selectedId, setSelectedId] = useState<string>("");
  const [, setRefresh] = useState(0);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleScalarChange = (obj: any, key: string, rawVal: string | boolean) => {
    if (typeof obj[key] === "boolean") {
      obj[key] = Boolean(rawVal);
    } else if (typeof obj[key] === "number") {
      const parsed = Number(rawVal);
      if (!Number.isFinite(parsed)) return;
      const bounds = NUMERIC_BOUNDS[key] ?? { min: 0 };
      let next = parsed;
      if (bounds.integer) next = Math.round(next);
      if (next < bounds.min) next = bounds.min;
      if (bounds.max !== undefined && next > bounds.max) next = bounds.max;
      obj[key] = next;
    } else if (typeof rawVal === "string") {
      obj[key] = rawVal;
    }
    setRefresh((p) => p + 1);
  };

  const renderScalarField = (obj: any, key: string, val: unknown) => {
    if (typeof val === "boolean") {
      return (
        <label
          key={key}
          className="flex items-center justify-between bg-black/30 border border-white/10 rounded px-3 py-2 cursor-pointer">
          <span className="text-[9px] md:text-[10px] uppercase font-bold text-neutral-400">
            {key}
          </span>
          <input
            type="checkbox"
            checked={val}
            onChange={(e) => handleScalarChange(obj, key, e.target.checked)}
            className="w-4 h-4 accent-blue-500"
          />
        </label>
      );
    }

    if (typeof val === "number") {
      const bounds = NUMERIC_BOUNDS[key] ?? { min: 0 };
      const step = bounds.max === 1 ? "0.05" : bounds.integer ? "1" : "any";
      return (
        <div key={key} className="flex flex-col">
          <label className="text-[9px] md:text-[10px] uppercase font-bold text-neutral-500 mb-1">
            {key}
          </label>
          <input
            type="number"
            min={bounds.min}
            max={bounds.max}
            step={step}
            value={val}
            onChange={(e) => handleScalarChange(obj, key, e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-3 py-2 text-xs md:text-sm font-mono focus:border-blue-500 focus:outline-none"
          />
        </div>
      );
    }

    return (
      <div key={key} className="flex flex-col">
        <label className="text-[9px] md:text-[10px] uppercase font-bold text-neutral-500 mb-1">
          {key}
        </label>
        <input
          type="text"
          value={String(val)}
          onChange={(e) => handleScalarChange(obj, key, e.target.value)}
          className="bg-black/30 border border-white/10 rounded px-3 py-2 text-xs md:text-sm font-mono focus:border-blue-500 focus:outline-none"
        />
      </div>
    );
  };

  return (
    <div className="absolute inset-0 flex flex-col md:flex-row z-10 bg-neutral-900 text-white overflow-hidden">
      <div className="w-full md:w-64 bg-black/50 border-b md:border-b-0 md:border-r border-white/10 flex flex-col max-h-[40vh] md:max-h-full">
        <div className="p-4 border-b border-white/10">
          <h2 className="font-bold text-lg uppercase tracking-wider mb-4 hidden md:block">
            Content Editor
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setCategory("enemies");
                setSelectedId("");
              }}
              className={`flex-1 py-2 text-[10px] md:text-xs font-bold uppercase rounded ${category === "enemies" ? "bg-blue-600" : "bg-neutral-800"}`}>
              Enemies
            </button>
            <button
              onClick={() => {
                setCategory("weapons");
                setSelectedId("");
              }}
              className={`flex-1 py-2 text-[10px] md:text-xs font-bold uppercase rounded ${category === "weapons" ? "bg-blue-600" : "bg-neutral-800"}`}>
              Weapons
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {category === "enemies"
            ? Object.keys(ENEMY_STATS).map((id) => (
                <button
                  key={id}
                  onClick={() => setSelectedId(id)}
                  className={`w-full text-left px-4 py-2 md:py-3 rounded mb-1 text-xs md:text-sm font-mono transition-colors ${selectedId === id ? "bg-white/10 text-white" : "text-neutral-400 hover:bg-white/5"}`}>
                  {id.toUpperCase()}
                </button>
              ))
            : Object.keys(WEAPONS).map((id) => (
                <button
                  key={id}
                  onClick={() => setSelectedId(id)}
                  className={`w-full text-left px-4 py-2 md:py-3 rounded mb-1 text-xs md:text-sm font-mono transition-colors ${selectedId === id ? "bg-white/10 text-white" : "text-neutral-400 hover:bg-white/5"}`}>
                  {WEAPONS[id].name.toUpperCase()}
                </button>
              ))}
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="p-3 border-t border-white/10 hover:bg-yellow-900/40 text-yellow-300 uppercase font-bold text-xs tracking-widest">
          Reset Defaults
        </button>
        <button
          onClick={onBack}
          className="p-4 border-t border-white/10 hover:bg-red-900/50 text-neutral-400 hover:text-white uppercase font-bold text-xs md:text-sm tracking-widest">
          Exit Editor
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {selectedId ? (
          <div className="max-w-2xl mx-auto">
            <h3 className="text-xl md:text-3xl font-black mb-4 md:mb-8 border-b border-white/10 pb-4 flex flex-col md:flex-row justify-between items-start md:items-end gap-2">
              <span>{selectedId.toUpperCase()}</span>
              <span className="text-[10px] font-mono font-normal text-green-400">
                {category === "enemies" ? "APPLIES TO NEW SPAWNS" : "APPLIES TO FUTURE ATTACKS"}
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              {category === "enemies" && ENEMY_STATS[selectedId]
                ? Object.entries(ENEMY_STATS[selectedId]).map(([key, val]) =>
                    typeof val !== "object"
                      ? renderScalarField(ENEMY_STATS[selectedId], key, val)
                      : null,
                  )
                : WEAPONS[selectedId] && (
                    <>
                      {Object.entries(WEAPONS[selectedId]).map(([key, val]) =>
                        typeof val !== "object" && key !== "id"
                          ? renderScalarField(WEAPONS[selectedId], key, val)
                          : null,
                      )}
                      {(["lightAttack", "heavyAttack"] as const).map((attackKey) => (
                        <div
                          key={attackKey}
                          className="sm:col-span-2 border border-white/10 rounded p-3 bg-black/20">
                          <div className="text-[10px] uppercase font-bold text-neutral-400 mb-2">
                            {attackKey} Frames (60fps)
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {(["anticipation", "active", "recovery"] as const).map((phase) =>
                              renderScalarField(
                                WEAPONS[selectedId][attackKey],
                                phase,
                                WEAPONS[selectedId][attackKey][phase],
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-neutral-600 font-mono text-xs md:text-sm uppercase tracking-widest">
            Select an item to edit
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        title="Reset Content Defaults"
        message="Restore all enemy stats, weapon definitions, and animation events back to their baseline defaults?"
        confirmLabel="Reset All"
        danger
        onConfirm={() => {
          AssetLoader.resetAll();
          setRefresh((p) => p + 1);
          setShowResetConfirm(false);
          onToast("All enemy, weapon, and animation defaults restored.", "success");
        }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
};
