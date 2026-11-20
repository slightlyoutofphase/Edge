import { Game } from "../core/Game";
import { AssetLoader } from "../assets/AssetLoader";
import { tests as phase1Tests } from "./phase1_movement.test";
import { tests as phase2aTests } from "./phase2a_animation.test";
import { tests as phase2bTests } from "./phase2b_combat.test";
import { tests as phase3Tests } from "./phase3_advancedCombat.test";
import { tests as phase3bTests } from "./phase3b_parryFixes.test"; // Added
import { tests as phase4Tests } from "./phase4_enemyAI.test";
import { tests as phase5Tests } from "./phase5_visuals.test";
import { tests as phase6aTests } from "./phase6a_audioFoundation.test";
import { tests as phase6bTests } from "./phase6b_combatAudio.test";
import { tests as phase7Tests } from "./phase7_levelDesign.test";
import { tests as phase8Tests } from "./phase8_polish.test";
import { tests as phase9Tests } from "./phase9_aiRefactor.test";
import { tests as phase10Tests } from "./phase10_refinements.test";
import { tests as phase11Tests } from "./phase11_architecture_ai.test";
import { tests as phase12Tests } from "./phase12_performance_polish.test";
import { tests as phase13Tests } from "./phase13_types_and_nav.test";
import { tests as phase14Tests } from "./phase14_variations.test";
import { tests as phase15Tests } from "./phase15_flanking.test";
import { tests as phase16Tests } from "./phase16_duelist_tactics.test";
import { tests as phase17Tests } from "./phase17_polish.test";
import { tests as phase18Tests } from "./phase18_optimizations.test";
import { tests as phase19Tests } from "./phase19_responsive_ui.test";
import { tests as phase20Tests } from "./phase20_enemy_animations.test";
import { tests as phase21Tests } from "./phase21_rogue_enemy.test";
import { tests as phase22Tests } from "./phase22_inventory.test";
import { tests as phase23Tests } from "./phase23_query_caching.test";
import { tests as phase24Tests } from "./phase24_optimization_fixes.test";
import { tests as phase25Tests } from "./phase25_memory_optimization.test";
import { tests as phase26Tests } from "./phase26_performance_optimizations.test";
import { tests as phase27Tests } from "./phase20_interaction.test";
import { tests as auditTests } from "./audit_regressions.test";
import { tests as videoTests } from "./video_regressions.test";
import { tests as animationFollowupTests } from "./animation_followups.test";
import { tests as heavyEnemyTests } from "./heavy_enemy_attacks.test";
import { tests as npcAITests } from "./npc_ai_regressions.test";
import { tests as quadrupedTests } from "./quadruped_rig.test";
import { tests as hellhoundTests } from "./hellhound_combat.test";
import { tests as presentationTests } from "./frame_presentation.test";
import { tests as performanceFollowupTests } from "./performance_followups.test";

import { tests as arenaCombatFollowupTests } from "./arena_combat_followups.test";
import { tests as contactAndAirborneTests } from "./contact_and_airborne_regressions.test";
import { tests as contactPolishTests } from "./contact_polish_regressions.test";
import { tests as videoFollowupTests } from "./video_followup_regressions.test";
import { tests as reviewRegressionTests } from "./review_regressions.test";

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  file?: string;
  durationMs?: number;
}

export interface TestFileResult {
  file: string;
  results: TestResult[];
  durationMs: number;
}

export interface TestRunCallbacks {
  onFileStart?: (file: string, fileIndex: number, totalFiles: number) => void;
  onFileComplete?: (fileResult: TestFileResult, fileIndex: number, totalFiles: number) => void;
}

interface TestSuiteEntry {
  file: string;
  tests: Array<(game: Game) => any>;
}

const TEST_SUITES: TestSuiteEntry[] = [
  { file: "phase1_movement.test.ts", tests: phase1Tests },
  { file: "phase2a_animation.test.ts", tests: phase2aTests },
  { file: "phase2b_combat.test.ts", tests: phase2bTests },
  { file: "phase3_advancedCombat.test.ts", tests: phase3Tests },
  { file: "phase3b_parryFixes.test.ts", tests: phase3bTests },
  { file: "phase4_enemyAI.test.ts", tests: phase4Tests },
  { file: "phase5_visuals.test.ts", tests: phase5Tests },
  { file: "phase6a_audioFoundation.test.ts", tests: phase6aTests },
  { file: "phase6b_combatAudio.test.ts", tests: phase6bTests },
  { file: "phase7_levelDesign.test.ts", tests: phase7Tests },
  { file: "phase8_polish.test.ts", tests: phase8Tests },
  { file: "phase9_aiRefactor.test.ts", tests: phase9Tests },
  { file: "phase10_refinements.test.ts", tests: phase10Tests },
  { file: "phase11_architecture_ai.test.ts", tests: phase11Tests },
  { file: "phase12_performance_polish.test.ts", tests: phase12Tests },
  { file: "phase13_types_and_nav.test.ts", tests: phase13Tests },
  { file: "phase14_variations.test.ts", tests: phase14Tests },
  { file: "phase15_flanking.test.ts", tests: phase15Tests },
  { file: "phase16_duelist_tactics.test.ts", tests: phase16Tests },
  { file: "phase17_polish.test.ts", tests: phase17Tests },
  { file: "phase18_optimizations.test.ts", tests: phase18Tests },
  { file: "phase19_responsive_ui.test.ts", tests: phase19Tests },
  { file: "phase20_enemy_animations.test.ts", tests: phase20Tests },
  { file: "phase21_rogue_enemy.test.ts", tests: phase21Tests },
  { file: "phase22_inventory.test.ts", tests: phase22Tests },
  { file: "phase23_query_caching.test.ts", tests: phase23Tests },
  { file: "phase24_optimization_fixes.test.ts", tests: phase24Tests },
  { file: "phase25_memory_optimization.test.ts", tests: phase25Tests },
  { file: "phase26_performance_optimizations.test.ts", tests: phase26Tests },
  { file: "phase20_interaction.test.ts", tests: phase27Tests },
  { file: "audit_regressions.test.ts", tests: auditTests },
  { file: "video_regressions.test.ts", tests: videoTests },
  { file: "animation_followups.test.ts", tests: animationFollowupTests },
  { file: "heavy_enemy_attacks.test.ts", tests: heavyEnemyTests },
  { file: "npc_ai_regressions.test.ts", tests: npcAITests },
  { file: "quadruped_rig.test.ts", tests: quadrupedTests },
  { file: "hellhound_combat.test.ts", tests: hellhoundTests },
  { file: "frame_presentation.test.ts", tests: presentationTests },
  { file: "performance_followups.test.ts", tests: performanceFollowupTests },
  { file: "arena_combat_followups.test.ts", tests: arenaCombatFollowupTests },
  { file: "contact_and_airborne_regressions.test.ts", tests: contactAndAirborneTests },
  { file: "contact_polish_regressions.test.ts", tests: contactPolishTests },
  { file: "video_followup_regressions.test.ts", tests: videoFollowupTests },
  { file: "review_regressions.test.ts", tests: reviewRegressionTests },
];

function getTestName(test: Function): string {
  if (test.name) return test.name;
  const source = test.toString();
  const match = source.match(
    /async function\s+([^(\s]+)|function\s+([^(\s]+)\s*\(|^([^(\s]+)\s*=>/,
  );
  return match?.[1] || match?.[2] || match?.[3] || "<Unnamed Test>";
}

export class TestRunner {
  game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  async runTests(callbacks?: TestRunCallbacks): Promise<TestResult[]> {
    const wasRunning = this.game.running;
    const wasCapturingKeyboard = this.game.inputManager?.captureKeyboard;
    this.game.running = false;
    if (this.game.inputManager) {
      this.game.inputManager.captureKeyboard = true;
    }

    try {
      AssetLoader.resetAll();
      await AssetLoader.loadAll();

      const results: TestResult[] = [];
      const totalFiles = TEST_SUITES.length;

      for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
        const suite = TEST_SUITES[fileIndex];
        callbacks?.onFileStart?.(suite.file, fileIndex, totalFiles);
        await new Promise((r) => setTimeout(r, 0));

        const fileStart = performance.now();
        const fileResults: TestResult[] = [];

        for (const test of suite.tests) {
          this.game.resetLevel();
          await new Promise((r) => setTimeout(r, 16));
          const name = getTestName(test);
          const testStart = performance.now();

          try {
            await test(this.game);
            const result: TestResult = {
              name,
              passed: true,
              file: suite.file,
              durationMs: performance.now() - testStart,
            };
            fileResults.push(result);
            results.push(result);
          } catch (e: any) {
            const errorMessage = typeof e === "string" ? e : e?.message || String(e);
            const result: TestResult = {
              name,
              passed: false,
              error: errorMessage,
              file: suite.file,
              durationMs: performance.now() - testStart,
            };
            fileResults.push(result);
            results.push(result);
          }
        }

        const fileDurationMs = performance.now() - fileStart;
        callbacks?.onFileComplete?.(
          {
            file: suite.file,
            results: fileResults,
            durationMs: fileDurationMs,
          },
          fileIndex,
          totalFiles,
        );
        await new Promise((r) => setTimeout(r, 0));
      }

      return results;
    } finally {
      if (this.game.inputManager && wasCapturingKeyboard !== undefined) {
        this.game.inputManager.captureKeyboard = wasCapturingKeyboard;
      }
      this.game.running = wasRunning;
      if (this.game.running) {
        this.game.lastTime = performance.now();
        requestAnimationFrame(this.game.loop.bind(this.game));
      }
    }
  }
}
