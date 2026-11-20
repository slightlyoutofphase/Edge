import { AnimatorComponent } from "./AnimatorComponent";

// Restarting the same attack also starts a fresh blend and event traversal.
export function beginAnimation(animator: AnimatorComponent, name: string): void {
  animator.blendFrom = animator.currentAnim;
  animator.blendFromTime = animator.time;
  animator.blendElapsed = 0;
  animator.blendFromPose = undefined;
  animator.transitionPending = true;
  animator.currentAnim = name;
  animator.time = 0;
  animator.eventState?.delete(`main_${name}`);
}
