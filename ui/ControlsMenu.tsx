import React, { useEffect, useState } from "react";
import {
  ActiveKeybindings,
  DEFAULT_KEYBINDINGS,
  InputAction,
  InputBinding,
  saveKeybindings,
} from "../core/InputDefinitions";
import { ConfirmDialog } from "./DialogOverlay";

interface ControlsMenuProps {
  onBack: () => void;
}

export const ControlsMenu: React.FC<ControlsMenuProps> = ({ onBack }) => {
  const [bindings, setBindings] = useState<Record<InputAction, InputBinding>>(
    JSON.parse(JSON.stringify(ActiveKeybindings)),
  );
  const [listeningFor, setListeningFor] = useState<{
    action: InputAction;
    index?: number;
    type: "key" | "mouse";
  } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const updateBinding = (action: InputAction, type: "key" | "mouse", value: string | number) => {
    setBindings((prev) => {
      const next = { ...prev };
      const binding = { ...next[action] };
      if (type === "key") {
        binding.keys = [value as string];
        binding.mouseButtons = [];
      } else {
        binding.mouseButtons = [value as number];
        binding.keys = [];
      }
      next[action] = binding;
      return next;
    });
  };

  useEffect(() => {
    if (!listeningFor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === "Escape") {
        setListeningFor(null);
        return;
      }

      updateBinding(listeningFor.action, "key", e.code);
      setListeningFor(null);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-no-rebind]")) {
        setListeningFor(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      updateBinding(listeningFor.action, "mouse", e.button);
      setListeningFor(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleMouseDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [listeningFor]);

  const formatKey = (key: string) => {
    if (key.startsWith("Key")) return key.replace("Key", "");
    if (key.startsWith("Digit")) return key.replace("Digit", "");
    if (key === "Space") return "SPACE";
    if (key === "ShiftLeft" || key === "ShiftRight") return "SHIFT";
    if (key === "ControlLeft" || key === "ControlRight") return "CTRL";
    if (key === "AltLeft" || key === "AltRight") return "ALT";
    return key;
  };

  const formatMouse = (btn: number) => {
    if (btn === 0) return "LMB";
    if (btn === 1) return "MMB";
    if (btn === 2) return "RMB";
    return `BTN ${btn}`;
  };

  const renderButton = (action: InputAction) => {
    const b = bindings[action];
    const isListening = listeningFor?.action === action;

    let text = "Unbound";
    if (b.keys.length > 0) text = formatKey(b.keys[0]);
    else if (b.mouseButtons && b.mouseButtons.length > 0) text = formatMouse(b.mouseButtons[0]);

    return (
      <button
        onClick={() => setListeningFor({ action, type: "key" })}
        className={`
            w-full px-4 py-2 font-mono text-sm font-bold border
            ${
              isListening
                ? "bg-yellow-500 text-black border-yellow-500 animate-pulse"
                : "bg-black/50 text-white border-white/20 hover:border-white hover:bg-white/10"
            }
        `}>
        {isListening ? "PRESS KEY..." : text}
      </button>
    );
  };

  const handleSave = () => {
    saveKeybindings(bindings);
    onBack();
  };

  return (
    <div className="absolute inset-0 bg-neutral-900 flex flex-col items-center pt-8 pb-6 px-4 z-50 overflow-hidden">
      <h1 className="text-4xl font-black text-white mb-6 tracking-tighter shrink-0">CONTROLS</h1>

      <div className="w-full flex-1 min-h-0 overflow-y-auto flex justify-center">
        <div className="w-full max-w-4xl h-fit grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4 px-4 pb-4">
          {Object.values(InputAction).map((action) => (
            <div
              key={action}
              className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-neutral-400 font-bold uppercase text-xs tracking-wider">
                {action.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <div className="w-32">{renderButton(action)}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        data-no-rebind
        className="shrink-0 mt-4 flex flex-wrap justify-center gap-4 bg-neutral-900/95 p-4 rounded border border-white/10">
        <button
          onClick={() => setShowResetConfirm(true)}
          className="px-6 py-2 bg-red-900/30 text-red-200 border border-red-500/30 hover:bg-red-900/50 rounded font-bold uppercase text-xs tracking-widest">
          Reset Defaults
        </button>
        <button
          onClick={onBack}
          className="px-6 py-2 bg-neutral-800 text-neutral-400 hover:text-white border border-transparent hover:border-white/20 rounded font-bold uppercase text-xs tracking-widest">
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-8 py-2 bg-white text-black hover:bg-neutral-200 rounded font-bold uppercase text-xs tracking-widest">
          Save Changes
        </button>
      </div>

      <ConfirmDialog
        open={showResetConfirm}
        title="Reset Controls"
        message="Reset all keyboard and mouse controls back to their defaults?"
        confirmLabel="Reset Defaults"
        danger
        onConfirm={() => {
          setBindings(JSON.parse(JSON.stringify(DEFAULT_KEYBINDINGS)));
          setShowResetConfirm(false);
        }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
};
