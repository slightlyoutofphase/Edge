import React, { useLayoutEffect, useRef, useState } from "react";
import { Game } from "../core/Game";
import { InteractionState, PlayerProgress } from "../core/Resources";
import { InputAction, getBindingLabel } from "../core/InputDefinitions";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { CombatComponent } from "../features/combat/CombatComponent";
import { EnemyTagComponent } from "../components/EnemyTag";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { isBossEnemy } from "../data/EnemyTypes";

interface GameHUDProps {
  gameRef: React.MutableRefObject<Game | null>;
  onQuitToMenu: () => void;
}

interface HudSnapshot {
  playerHP: number;
  playerMaxHP: number;
  playerStamina: number;
  playerMaxStamina: number;
  isExhausted: boolean;
  zone: number;
  isVictory: boolean;
  showDeathScreen: boolean;
  interactionPrompt: string | null;
  bossHP: number;
  bossMaxHP: number;
  bossVisible: boolean;
  bossName: string;
  bossThresholds: number[];
}

const INITIAL_HUD: HudSnapshot = {
  playerHP: 100,
  playerMaxHP: 100,
  playerStamina: 100,
  playerMaxStamina: 100,
  isExhausted: false,
  zone: 0,
  isVictory: false,
  showDeathScreen: false,
  interactionPrompt: null,
  bossHP: 0,
  bossMaxHP: 100,
  bossVisible: false,
  bossName: "BOSS",
  bossThresholds: [],
};

function arraysEqual(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hudSnapshotsEqual(a: HudSnapshot, b: HudSnapshot): boolean {
  return (
    a.playerHP === b.playerHP &&
    a.playerMaxHP === b.playerMaxHP &&
    a.playerStamina === b.playerStamina &&
    a.playerMaxStamina === b.playerMaxStamina &&
    a.isExhausted === b.isExhausted &&
    a.zone === b.zone &&
    a.isVictory === b.isVictory &&
    a.showDeathScreen === b.showDeathScreen &&
    a.interactionPrompt === b.interactionPrompt &&
    a.bossHP === b.bossHP &&
    a.bossMaxHP === b.bossMaxHP &&
    a.bossVisible === b.bossVisible &&
    a.bossName === b.bossName &&
    arraysEqual(a.bossThresholds, b.bossThresholds)
  );
}

export const GameHUD: React.FC<GameHUDProps> = ({ gameRef, onQuitToMenu }) => {
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const lastSnapshotRef = useRef<HudSnapshot>(INITIAL_HUD);

  useLayoutEffect(() => {
    let rafId = 0;

    const syncHUD = () => {
      const game = gameRef.current;
      if (game) {
        const world = game.world;
        const prev = lastSnapshotRef.current;
        const next: HudSnapshot = {
          ...prev,
          bossVisible: false,
        };

        const players = world.query("Health", "Stamina", "Combat", "PlayerInput");
        if (players.length > 0) {
          const health = players[0].components[0] as HealthComponent;
          const stamina = players[0].components[1] as StaminaComponent;
          const combat = players[0].components[2] as CombatComponent;
          const progress = world.getResource<PlayerProgress>(PlayerProgress);
          const interaction = world.getResource<InteractionState>(InteractionState);

          next.playerHP = health.current;
          next.playerMaxHP = health.max;
          next.playerStamina = stamina.current;
          next.playerMaxStamina = stamina.max;
          next.isExhausted = stamina.isExhausted;
          next.zone = combat.attackZone;
          next.isVictory = progress.isVictory;
          next.showDeathScreen = progress.isDead && progress.deathTimer > 1000;
          next.interactionPrompt = interaction.activePrompt;
        }

        const bossEntities = world.query("Health", "EnemyTag", "Faction");
        for (const { id, components } of bossEntities) {
          const h = components[0] as HealthComponent;
          const t = components[1] as EnemyTagComponent;
          const f = components[2] as any;

          if (isBossEnemy(t.enemyType) && (!f || f.team === 2) && !h.isDead && h.current > 0) {
            const ai = world.getComponent<AIControllerComponent>(id, "AIController");
            if (ai && ai.target) {
              next.bossHP = h.current;
              next.bossMaxHP = h.max;
              next.bossVisible = true;
              next.bossName = t.enemyType === "alpha_hellhound" ? "ALPHA HELLHOUND" : "BOSS";
              next.bossThresholds = ai.behaviorParams.phaseThresholds || [];
              break;
            }
          }
        }

        if (!hudSnapshotsEqual(prev, next)) {
          lastSnapshotRef.current = next;
          setHud(next);
        }
      }

      rafId = requestAnimationFrame(syncHUD);
    };

    rafId = requestAnimationFrame(syncHUD);
    return () => cancelAnimationFrame(rafId);
  }, [gameRef]);

  return (
    <>
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-20">
        <div className="absolute top-4 md:top-6 left-4 md:left-6 w-[120px] md:w-[200px] h-3 md:h-5 bg-neutral-800 border border-white">
          <div
            className="h-full bg-red-600 transition-all duration-100 ease-linear"
            style={{
              width: `${Math.max(0, (hud.playerHP / Math.max(1, hud.playerMaxHP)) * 100)}%`,
            }}
          />
        </div>
        <div className="absolute top-8 md:top-12 left-4 md:left-6 w-[90px] md:w-[150px] h-1.5 md:h-2 bg-neutral-800 border border-white/50">
          <div
            className={`h-full transition-all duration-100 ease-linear ${hud.isExhausted ? "bg-neutral-500" : "bg-green-500"}`}
            style={{
              width: `${Math.max(0, (hud.playerStamina / Math.max(1, hud.playerMaxStamina)) * 100)}%`,
            }}
          />
        </div>
        <div className="absolute bottom-10 right-10 md:bottom-16 md:right-16 w-12 h-12 md:w-16 md:h-16 rounded-full bg-black/50 backdrop-blur border border-white/10 flex items-center justify-center">
          <div
            className={`absolute top-1 w-1.5 md:w-2 h-1.5 md:h-2 rounded-full ${hud.zone === 1 ? "bg-yellow-400 shadow-[0_0_10px_yellow]" : "bg-white/20"}`}
          />
          <div
            className={`absolute right-1 w-1.5 md:w-2 h-1.5 md:h-2 rounded-full ${hud.zone === 2 ? "bg-yellow-400 shadow-[0_0_10px_yellow]" : "bg-white/20"}`}
          />
          <div
            className={`absolute bottom-1 w-1.5 md:w-2 h-1.5 md:h-2 rounded-full ${hud.zone === 3 ? "bg-yellow-400 shadow-[0_0_10px_yellow]" : "bg-white/20"}`}
          />
          <div
            className={`absolute left-1 w-1.5 md:w-2 h-1.5 md:h-2 rounded-full ${hud.zone === 0 ? "bg-yellow-400 shadow-[0_0_10px_yellow]" : "bg-white/20"}`}
          />
        </div>
        {hud.interactionPrompt && (
          <div className="absolute top-3/4 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none animate-bounce">
            <div className="bg-black/80 text-white px-4 py-2 rounded border border-white/20 font-bold text-sm md:text-base uppercase tracking-widest backdrop-blur-sm shadow-lg">
              <span className="text-yellow-400 mr-2">
                [{getBindingLabel(InputAction.INTERACT)}]
              </span>
              {hud.interactionPrompt}
            </div>
          </div>
        )}
        {hud.bossVisible && (
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-[90%] max-w-[600px]">
            <div className="text-white font-serif text-sm md:text-xl mb-1 drop-shadow-md">
              {hud.bossName}
            </div>
            <div className="w-full h-2 md:h-4 bg-black border border-white/50 relative">
              <div
                className="h-full bg-red-800 transition-all duration-200 ease-out"
                style={{
                  width: `${Math.max(0, (hud.bossHP / Math.max(1, hud.bossMaxHP)) * 100)}%`,
                }}
              />
              {hud.bossThresholds.map((t, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-[1px] md:w-1 bg-black/50"
                  style={{ left: `${t * 100}%` }}
                />
              ))}
            </div>
          </div>
        )}
        {hud.isVictory && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 pointer-events-auto">
            <h1 className="text-4xl md:text-6xl font-serif text-yellow-400 mb-6">VICTORY</h1>
            <button onClick={onQuitToMenu} className="text-white border border-white/30 px-4 py-2">
              Return to Menu
            </button>
          </div>
        )}
        {hud.showDeathScreen && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-1000">
            <h1 className="text-4xl md:text-6xl font-serif text-red-700 mb-6 md:mb-8 animate-pulse tracking-widest">
              YOU DIED
            </h1>
            <p className="text-neutral-400 font-mono text-xs md:text-sm animate-bounce">
              TAP TO RESPAWN
            </p>
          </div>
        )}
      </div>
      <div className="absolute top-4 right-4 z-10 pointer-events-auto">
        <button
          onClick={onQuitToMenu}
          className="bg-black/50 hover:bg-black/80 text-white/70 hover:text-white px-3 py-1.5 md:px-4 md:py-2 rounded border border-white/10 text-[10px] md:text-xs uppercase font-bold tracking-widest transition-colors backdrop-blur-sm">
          Menu
        </button>
      </div>
      <div className="absolute bottom-4 left-4 text-white/30 text-[8px] md:text-[10px] font-mono pointer-events-none hidden sm:block">
        Controls: {getBindingLabel(InputAction.MOVE_LEFT)} /{" "}
        {getBindingLabel(InputAction.MOVE_RIGHT)} Move • {getBindingLabel(InputAction.RUN)} Run •{" "}
        {getBindingLabel(InputAction.JUMP)} Jump • {getBindingLabel(InputAction.ROLL)} Roll •{" "}
        {getBindingLabel(InputAction.SLIDE)} Slide • {getBindingLabel(InputAction.ATTACK_LIGHT)}{" "}
        Attack • {getBindingLabel(InputAction.BLOCK)} Block • {getBindingLabel(InputAction.PARRY)}{" "}
        Parry • {getBindingLabel(InputAction.INTERACT)} Interact
      </div>
    </>
  );
};
