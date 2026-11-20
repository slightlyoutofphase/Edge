import { World } from "../../core/World";
import { SkeletonComponent } from "./SkeletonComponent";
import { TransformComponent } from "../../components/Transform";
import { BoneDef } from "./SkeletonTypes";
import { Matrix2D } from "../../utils/Matrix2D";
import { AssetLoader } from "../../assets/AssetLoader";
import { ObjectPool } from "../../utils/ObjectPool";
import { updateActorContacts } from "../combat/ContactGeometry";

export class SkeletonSystem {
  // Pool for intermediate matrices to reduce GC
  private matrixPool: ObjectPool<Matrix2D>;

  constructor(private world: World) {
    this.matrixPool = new ObjectPool<Matrix2D>(
      () => new Matrix2D(),
      (m) => m.identity(),
      50,
    );
  }

  update() {
    const entities = this.world.query("Skeleton", "Transform");

    for (const { id } of entities) this.updateEntity(id);
  }

  updateEntity(id: number) {
    const skeleton = this.world.getComponent<SkeletonComponent>(id, "Skeleton");
    const transform = this.world.getComponent<TransformComponent>(id, "Transform");
    if (!skeleton || !transform) return;

    // Resolve definition if missing (AssetLoader should have it)
    if (!skeleton.definition) {
      skeleton.definition = AssetLoader.getSkeleton(skeleton.definitionId);
    }
    if (!skeleton.definition) return;

    // Compute root transform
    // We use a pooled matrix for the root calculation to pass down
    const rootMatrix = this.matrixPool.acquire();
    rootMatrix
      .translate(transform.position.x, transform.position.y)
      .scale(transform.facing * transform.scale.x, transform.scale.y);

    this.traverse(skeleton.definition.root, rootMatrix, skeleton);
    const position = (skeleton.worldPosition ??= { x: 0, y: 0 });
    position.x = transform.position.x;
    position.y = transform.position.y;
    skeleton.worldFacing = transform.facing;
    updateActorContacts(this.world, id);

    // Release the root matrix back to pool
    this.matrixPool.release(rootMatrix);
  }

  private traverse(bone: BoneDef, parentMatrix: Matrix2D, skeleton: SkeletonComponent) {
    // 1. Calculate the base transform for this bone (Joint Position)
    // This matrix represents the coordinate system at the bone's pivot point.
    // We use a pooled matrix for intermediate calculation
    const baseMatrix = this.matrixPool.acquire();
    baseMatrix.copy(parentMatrix);

    // Translate from Parent Joint to This Bone's Joint (Pivot)
    baseMatrix.translate(bone.pivot.x, bone.pivot.y);

    // Apply Animation Pose (Rotation/Translation/Scale relative to pivot)
    const pose = skeleton.currentPose[bone.id] || skeleton.definition!.bindPose[bone.id] || {};

    if (pose.translate) {
      baseMatrix.translate(pose.translate.x, pose.translate.y);
    }

    if (pose.rotate) {
      baseMatrix.rotate((pose.rotate * Math.PI) / 180);
    }

    if (pose.scale) {
      baseMatrix.scale(pose.scale.x, pose.scale.y);
    }

    // 2. Calculate Render Matrix (SVG Adjustment)
    // Store directly in worldTransforms, reusing existing object if possible
    let renderMatrix = skeleton.worldTransforms.get(bone.id);
    if (!renderMatrix) {
      renderMatrix = new Matrix2D();
      skeleton.worldTransforms.set(bone.id, renderMatrix);
    }
    renderMatrix.copy(baseMatrix);

    // 3. Recurse to children
    // Children attach to the JOINT (baseMatrix).
    for (const child of bone.children) {
      this.traverse(child, baseMatrix, skeleton);
    }

    // Release the intermediate matrix
    this.matrixPool.release(baseMatrix);
  }
}
