import React, { useLayoutEffect, useState } from "react";
import { Game } from "../core/Game";
import { BattleState } from "../core/Resources";
import { ENEMY_TYPES } from "../data/EnemyTypes";

interface BattleHUDProps {
  gameRef: React.MutableRefObject<Game | null>;
  showTeamMarkers: boolean;
  onToggleTeamMarkers: (visible: boolean) => void;
  onQuitToMenu: () => void;
}

export const BattleHUD: React.FC<BattleHUDProps> = ({
  gameRef,
  showTeamMarkers,
  onToggleTeamMarkers,
  onQuitToMenu,
}) => {
  const [fighterA1, setFighterA1] = useState("hollow");
  const [fighterA2, setFighterA2] = useState("none");
  const [fighterB1, setFighterB1] = useState("soldier");
  const [fighterB2, setFighterB2] = useState("none");
  const [battleRunning, setBattleRunning] = useState(false);
  const [battleOver, setBattleOver] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);

  const enemyTypesWithNone = ["none", ...ENEMY_TYPES];

  useLayoutEffect(() => {
    if (!battleRunning || battleOver) return;
    let rafId = 0;

    const pollWinner = () => {
      const game = gameRef.current;
      if (game) {
        const battle = game.world.getResource<BattleState>(BattleState);
        if (battle.winner) {
          setBattleOver(true);
          setWinner(battle.winner);
          return;
        }
      }
      rafId = requestAnimationFrame(pollWinner);
    };

    rafId = requestAnimationFrame(pollWinner);
    return () => cancelAnimationFrame(rafId);
  }, [battleRunning, battleOver, gameRef]);

  const startFight = () => {
    if (gameRef.current) {
      gameRef.current.startBattle(fighterA1, fighterA2, fighterB1, fighterB2);
      setBattleRunning(true);
      setBattleOver(false);
      setWinner(null);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
      <div className="absolute top-4 left-4 right-4 flex flex-wrap items-center justify-end gap-2 pointer-events-auto z-20">
        <label className="flex items-center gap-2 bg-black/50 text-white/70 px-3 py-2 rounded border border-white/10 text-[10px] md:text-xs font-bold backdrop-blur-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showTeamMarkers}
            onChange={(event) => {
              const visible = event.target.checked;
              onToggleTeamMarkers(visible);
              if (gameRef.current) {
                gameRef.current.world.getResource<BattleState>(BattleState).showTeamMarkers =
                  visible;
              }
            }}
            className="w-4 h-4 accent-blue-500"
          />
          Show team markers
        </label>
        <button
          onClick={onQuitToMenu}
          className="bg-black/50 hover:bg-black/80 text-white/70 hover:text-white px-3 py-2 rounded border border-white/10 text-[10px] md:text-xs uppercase font-bold tracking-widest backdrop-blur-sm">
          Exit Battle
        </button>
      </div>
      {(!battleRunning || battleOver) && (
        <div className="bg-neutral-900 border border-white/10 p-4 md:p-8 rounded-lg shadow-2xl flex flex-col gap-4 md:gap-6 items-center w-full max-w-xl z-10 overflow-y-auto max-h-[90vh]">
          <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-tight">
            {battleOver ? "Battle Ended" : "Arena Setup"}
          </h2>
          {battleOver && winner && (
            <div className="text-2xl md:text-4xl font-black text-yellow-400 uppercase tracking-widest drop-shadow-lg mb-2 animate-pulse text-center">
              VICTOR: {winner}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-4 md:gap-8 items-stretch sm:items-start w-full">
            <div className="flex flex-col flex-1 gap-2">
              <label className="text-[10px] md:text-xs uppercase font-bold text-red-400 mb-1">
                Red Team
              </label>
              <select
                value={fighterA1}
                onChange={(e) => setFighterA1(e.target.value)}
                className="bg-black border border-red-900/50 rounded px-3 py-2 md:px-4 md:py-3 text-white text-sm focus:border-red-500 w-full">
                {ENEMY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
              <select
                value={fighterA2}
                onChange={(e) => setFighterA2(e.target.value)}
                className="bg-black border border-red-900/30 rounded px-3 py-2 text-neutral-300 text-xs md:text-sm focus:border-red-500 w-full">
                {enemyTypesWithNone.map((t) => (
                  <option key={t} value={t}>
                    Slot 2: {t.replaceAll("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-neutral-500 font-bold text-sm md:text-xl self-center sm:pt-10">
              VS
            </div>
            <div className="flex flex-col flex-1 gap-2">
              <label className="text-[10px] md:text-xs uppercase font-bold text-blue-400 mb-1">
                Blue Team
              </label>
              <select
                value={fighterB1}
                onChange={(e) => setFighterB1(e.target.value)}
                className="bg-black border border-blue-900/50 rounded px-3 py-2 md:px-4 md:py-3 text-white text-sm focus:border-blue-500 w-full">
                {ENEMY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replaceAll("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
              <select
                value={fighterB2}
                onChange={(e) => setFighterB2(e.target.value)}
                className="bg-black border border-blue-900/30 rounded px-3 py-2 text-neutral-300 text-xs md:text-sm focus:border-red-500 w-full">
                {enemyTypesWithNone.map((t) => (
                  <option key={t} value={t}>
                    Slot 2: {t.replaceAll("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={startFight}
            className="w-full bg-white text-black font-black py-3 md:py-4 rounded uppercase tracking-widest hover:scale-[1.02] active:scale-95 transition-transform mt-2">
            {battleOver ? "Restart Fight" : "Fight!"}
          </button>
        </div>
      )}
    </div>
  );
};
