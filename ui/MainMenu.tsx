import React from "react";

interface MainMenuProps {
  onStartGame: () => void;
  onBattleMode: () => void;
  onAnimationEditor: () => void;
  onContentEditor: () => void;
  onLevelEditor: () => void;
  onRunTests: () => void;
  onControls: () => void;
  onOptions: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  onStartGame,
  onBattleMode,
  onAnimationEditor,
  onContentEditor,
  onLevelEditor,
  onRunTests,
  onControls,
  onOptions,
}) => {
  const menuItems = [
    { label: "Begin Journey", action: onStartGame, primary: true },
    { label: "Battle Arena", action: onBattleMode },
    { label: "Level Editor", action: onLevelEditor },
    { type: "separator" },
    { label: "Controls", action: onControls },
    { label: "Animation Viewer", action: onAnimationEditor },
    { label: "Content Editor", action: onContentEditor },
    { label: "Diagnostics", action: onRunTests },
    { type: "separator" },
    { label: "Options", action: onOptions },
  ];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center z-50 bg-black text-white select-none">
      {/* Title Section */}
      <div className="mb-12 md:mb-16 text-center">
        <h1 className="text-8xl md:text-9xl font-serif font-black tracking-tighter text-white mb-4 select-none cursor-default">
          EDGE
        </h1>
        <p className="font-mono text-[10px] md:text-xs text-neutral-600 tracking-[0.8em] uppercase">
          Combat Prototype
        </p>
      </div>

      {/* Menu Options */}
      <div className="flex flex-col items-center gap-3 md:gap-4 w-full max-w-md">
        {menuItems.map((item, index) => {
          if (item.type === "separator") {
            return (
              <div key={`sep-${index}`} className="w-12 h-[1px] bg-neutral-900 my-2 md:my-3" />
            );
          }

          return (
            <button
              key={index}
              onClick={item.action}
              className={`
                group relative px-6 py-2 transition-all duration-300 ease-out
                ${item.primary ? "text-white" : "text-neutral-500 hover:text-white"}
              `}>
              <span
                className={`
                font-mono uppercase tracking-[0.2em] text-xs md:text-sm font-bold
                transition-all duration-300 inline-block
                ${item.primary ? "scale-110" : "group-hover:scale-105"}
              `}>
                {item.label}
              </span>

              {/* Minimal Hover Indicator (Left) */}
              <div
                className={`
                  absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-[1px] bg-white
                  opacity-0 -translate-x-4 transition-all duration-300
                  group-hover:opacity-100 group-hover:translate-x-0
                `}
              />

              {/* Minimal Hover Indicator (Right) */}
              <div
                className={`
                  absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-[1px] bg-white
                  opacity-0 translate-x-4 transition-all duration-300
                  group-hover:opacity-100 group-hover:translate-x-0
                `}
              />
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 text-neutral-800 font-mono text-[10px] uppercase tracking-widest opacity-50 hover:opacity-100 transition-opacity cursor-default">
        v0.1.0 • Pre-Alpha
      </div>
    </div>
  );
};
