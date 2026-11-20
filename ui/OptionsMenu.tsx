import React, { useState } from "react";
import { DEBUG } from "../debug/DebugFlags";

interface OptionsMenuProps {
  onBack: () => void;
}

export const OptionsMenu: React.FC<OptionsMenuProps> = ({ onBack }) => {
  const [, setTick] = useState(0);

  const toggleDebug = (key: keyof typeof DEBUG) => {
    DEBUG[key] = !DEBUG[key];
    setTick((t) => t + 1);
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black/90 p-4 overflow-y-auto">
      <h2 className="text-2xl md:text-3xl font-black text-white mb-6 md:mb-8 uppercase tracking-tight">
        Debug
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4 mb-8 w-full max-w-2xl px-4">
        {Object.keys(DEBUG).map((k) => {
          const key = k as keyof typeof DEBUG;
          return (
            <div
              key={key}
              className="flex items-center justify-between bg-neutral-800 p-3 md:p-4 rounded border border-neutral-700">
              <span className="text-neutral-300 font-mono text-xs md:text-sm">{key}</span>
              <button
                onClick={() => toggleDebug(key)}
                className={`w-10 h-5 md:w-12 md:h-6 rounded-full transition-colors relative ${DEBUG[key] ? "bg-green-500" : "bg-neutral-600"}`}>
                <div
                  className={`absolute top-[2px] md:top-1 w-4 h-4 rounded-full bg-white transition-all ${DEBUG[key] ? "left-[22px] md:left-7" : "left-[2px] md:left-1"}`}
                />
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={onBack}
        className="text-white hover:text-neutral-300 font-bold uppercase tracking-widest text-xs md:text-sm">
        Back to Menu
      </button>
    </div>
  );
};
