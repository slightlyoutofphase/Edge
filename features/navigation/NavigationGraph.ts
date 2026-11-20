import { World } from "../../core/World";
import { PlatformComponent } from "../../components/Platform";
import { TransformComponent } from "../../components/Transform";
import { ColliderComponent } from "../../components/Collider";
import { Vec2 } from "../../utils/Vec2";
import { SpatialHashGrid } from "../../utils/SpatialHashGrid";
import { GRAVITY, ENEMY_JUMP_SPEED, PLAYER_STATS } from "../../core/Constants";
import { AABB, aabbIntersects } from "../../utils/AABB";

export interface NavNode {
  id: number;
  position: Vec2;
  platformId: number;
}

export interface NavEdge {
  from: number;
  to: number;
  type: "walk" | "jump" | "fall";
  cost: number;
}

export interface NavStep extends Vec2 {
  action?: "walk" | "jump" | "fall";
  takeoff?: Vec2;
  dropThrough?: boolean;
  started?: boolean;
}

export class NavigationGraph {
  nodes: Map<number, NavNode> = new Map();
  edges: Map<number, NavEdge[]> = new Map();
  private nextNodeId = 0;
  private queryBuffer: number[] = []; // Reusable buffer for spatial queries

  // Tuning for jump connectivity
  private readonly JUMP_DIST_MAX = 200;
  private readonly JUMP_HEIGHT_MAX =
    (ENEMY_JUMP_SPEED * ENEMY_JUMP_SPEED) / (2 * GRAVITY) - ENEMY_JUMP_SPEED / 120;
  private readonly DROP_HEIGHT_MAX = 400;

  private terrain = new Map<number, { box: AABB; type: PlatformComponent["type"] }>();
  private terrainGrid = new SpatialHashGrid(128);
  private terrainQueryBuffer: number[] = [];
  private traversalCache = new Map<
    string,
    { takeoff: Vec2; landing: Vec2; dropThrough: boolean } | null
  >();

  build(world: World) {
    this.traversalCache.clear();
    this.nodes.clear();
    this.edges.clear();
    this.nextNodeId = 0;

    const platforms = world.query("Platform", "Transform", "Collider");
    this.terrain.clear();
    this.terrainGrid.clear();
    for (const {
      id,
      components: [p, t, c],
    } of platforms) {
      const transform = t as TransformComponent;
      const box = (c as ColliderComponent).hurtboxes[0];
      if (!box) continue;
      if ((p as PlatformComponent).collidable === false) continue;
      this.terrain.set(id, {
        type: (p as PlatformComponent).type,
        box: {
          x: transform.position.x + box.x * Math.abs(transform.scale.x),
          y: transform.position.y + box.y * transform.scale.y,
          width: box.width * Math.abs(transform.scale.x),
          height: box.height * transform.scale.y,
        },
      });
      this.terrainGrid.insert(id, this.terrain.get(id)!.box);
    }

    // 1. Generate Nodes
    for (const {
      id: platId,
      components: [pPlatform, pTransform, pCollider],
    } of platforms) {
      const plat = pPlatform as PlatformComponent;
      const trans = pTransform as TransformComponent;
      const col = pCollider as ColliderComponent;

      // Only navigate on solid/semisolid
      if (plat.collidable === false || (plat.type !== "solid" && plat.type !== "semisolid"))
        continue;

      const box = col.hurtboxes[0];
      if (!box) continue;

      // World coordinates of platform top surface
      const scaleX = Math.abs(trans.scale.x);
      const scaleY = trans.scale.y;
      const leftX = trans.position.x + box.x * scaleX;
      const rightX = leftX + box.width * scaleX;
      const topY = trans.position.y + box.y * scaleY;

      // Create 3 nodes: Left, Center, Right (inset slightly to prevent falling off)
      const inset = 10;
      const safeLeftX = leftX + inset;
      const safeRightX = rightX - inset;
      const centerX = (leftX + rightX) / 2;

      // Node Y is slightly above platform to represent "standing" pos
      const nodeY = topY - 1;

      const nodesForPlat: number[] = [];

      if (box.width * scaleX > inset * 2) {
        nodesForPlat.push(this.addNode({ x: safeLeftX, y: nodeY }, platId));
        nodesForPlat.push(this.addNode({ x: centerX, y: nodeY }, platId));
        nodesForPlat.push(this.addNode({ x: safeRightX, y: nodeY }, platId));
      } else {
        // Small platform, just one node
        nodesForPlat.push(this.addNode({ x: centerX, y: nodeY }, platId));
      }

      // Connect nodes on same platform (Walk)
      for (let i = 0; i < nodesForPlat.length - 1; i++) {
        this.addEdge(nodesForPlat[i], nodesForPlat[i + 1], "walk");
        this.addEdge(nodesForPlat[i + 1], nodesForPlat[i], "walk");
      }
    }

    // 2. Generate Inter-Platform Edges (Jump/Fall)
    // Optimization: Use a temporary spatial hash to find nearby nodes to avoid O(N^2) over all nodes.
    const nodeGrid = new SpatialHashGrid(200); // Bucket size slightly larger than jump dist
    const allNodes = Array.from(this.nodes.values());

    for (const node of allNodes) {
      // Rect 1x1 at node pos
      nodeGrid.insert(node.id, { x: node.position.x, y: node.position.y, width: 1, height: 1 });
    }

    // We check every node against neighbors in grid + adjacent buckets
    // SpatialHashGrid.query handles bucket lookup. We need to query a range around the node.
    // Range: +/- JUMP_DIST_MAX X, +/- DROP_HEIGHT_MAX Y
    const searchRange = Math.max(this.JUMP_DIST_MAX, this.DROP_HEIGHT_MAX);

    for (const a of allNodes) {
      const nearbyIds = nodeGrid.query(
        {
          x: a.position.x - searchRange,
          y: a.position.y - this.JUMP_HEIGHT_MAX, // Check up
          width: searchRange * 2,
          height: this.JUMP_HEIGHT_MAX + this.DROP_HEIGHT_MAX, // Check down
        },
        this.queryBuffer,
      );

      for (const bId of nearbyIds) {
        if (a.id === bId) continue;
        const b = this.nodes.get(bId);
        if (!b) continue;
        if (a.platformId === b.platformId) continue; // Walk edges handled

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dist = Math.abs(dx);

        // Manual distance logic to avoid alloc

        // Jump (Up or Across)
        if (dy <= 0) {
          // Target is higher
          if (Math.abs(dy) <= this.JUMP_HEIGHT_MAX && dist <= this.JUMP_DIST_MAX) {
            this.addEdge(a.id, b.id, "jump", 50);
          }
        }
        // Fall / Drop (Down)
        else {
          if (dist <= this.JUMP_DIST_MAX && dy <= this.DROP_HEIGHT_MAX) {
            this.addEdge(a.id, b.id, "fall", 10);
          }
        }
      }
    }

    //console.log(
    //  `[NavGraph] Built ${this.nodes.size} nodes and ${this.edges.size} edge sets using SpatialHash.`,
    //);
  }

  findPath(start: Vec2, end: Vec2, body = { width: 32, height: 72 }): NavStep[] {
    // Nearby points can share the same floor/node while a small solid pillar
    // blocks the walking route. Validate that local segment before returning
    // a direct path, and use the existing ballistic clearance solver for a hop.
    let support: [number, { box: AABB; type: PlatformComponent["type"] }] | undefined;
    if (Math.abs(end.x - start.x) <= this.JUMP_DIST_MAX) {
      const minX = Math.min(start.x, end.x) - body.width / 2;
      const maxX = Math.max(start.x, end.x) + body.width / 2;
      const candidates = this.terrainGrid.query(
        {
          x: minX,
          y: Math.min(start.y, end.y) - 4,
          width: Math.max(1, maxX - minX),
          height: Math.abs(end.y - start.y) + 8,
        },
        this.terrainQueryBuffer,
      );
      for (const id of candidates) {
        const p = this.terrain.get(id);
        if (
          p &&
          (p.type === "solid" || p.type === "semisolid") &&
          Math.abs(p.box.y - start.y) <= 4 &&
          Math.abs(p.box.y - end.y) <= 4 &&
          minX >= p.box.x &&
          maxX <= p.box.x + p.box.width
        ) {
          support = [id, p];
          break;
        }
      }
    }
    if (support) {
      const a = { id: -1, position: start, platformId: support[0] },
        b = { id: -2, position: end, platformId: support[0] };
      if (this.calculateTraversal(a, b, "walk", body)) return [{ ...end, action: "walk" }];
      const direction = Math.sign(end.x - start.x);
      const corridor = {
        x: Math.min(start.x, end.x) - body.width / 2,
        y: start.y - body.height,
        width: Math.abs(end.x - start.x) + body.width,
        height: body.height,
      };
      const corridorIds = this.terrainGrid.query(corridor, this.terrainQueryBuffer);
      let edge = direction > 0 ? -Infinity : Infinity;
      for (const id of corridorIds) {
        if (id === support[0]) continue;
        const p = this.terrain.get(id);
        if (p && p.type === "solid" && aabbIntersects(corridor, p.box)) {
          edge = direction > 0 ? Math.max(edge, p.box.x + p.box.width) : Math.min(edge, p.box.x);
        }
      }
      const afterCover = { x: edge + direction * (body.width / 2 + 14), y: end.y };
      // Contact knockback can leave the pursuer flush against low cover. Give
      // that same local hop a clear takeoff, instead of snapping the path's
      // start to the unreachable top of the cover and requesting a fall.
      for (const backoff of [0, 20, 40, 60, -20, -40]) {
        const launch = { ...a, position: { x: start.x - direction * backoff, y: start.y } };
        if (
          launch.position.x - body.width / 2 < support[1].box.x ||
          launch.position.x + body.width / 2 > support[1].box.x + support[1].box.width ||
          !this.calculateTraversal(a, launch, "walk", body)
        )
          continue;
        for (const landing of [end, afterCover]) {
          if (
            !Number.isFinite(landing.x) ||
            landing.x - body.width / 2 < support[1].box.x ||
            landing.x + body.width / 2 > support[1].box.x + support[1].box.width ||
            !this.calculateTraversal({ ...b, position: landing }, b, "walk", body)
          )
            continue;
          const hop = this.calculateTraversal(launch, { ...b, position: landing }, "jump", body);
          if (hop)
            return [
              { ...hop.landing, action: "jump", takeoff: hop.takeoff },
              { ...end, action: "walk" },
            ];
        }
      }
      return [];
    }
    // 1. Find closest start and end nodes
    const startNode = this.getClosestNode(start);
    const endNode = this.getClosestNode(end);

    if (!startNode || !endNode) return [];
    if (startNode.id === endNode.id) return [end];

    // 2. A* Algorithm (Binary min-heap)
    const heap: number[] = [startNode.id];
    const inOpenSet = new Set<number>([startNode.id]);
    const cameFrom = new Map<number, number>();

    const gScore = new Map<number, number>();
    gScore.set(startNode.id, 0);

    const fScore = new Map<number, number>();
    fScore.set(startNode.id, this.heuristic(startNode, endNode));

    const scoreOf = (id: number) => fScore.get(id) ?? Infinity;
    const heapPush = (id: number) => {
      let i = heap.length;
      heap.push(id);
      const s = scoreOf(id);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (scoreOf(heap[parent]) <= s) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = id;
    };
    const heapPop = (): number => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        let i = 0;
        const s = scoreOf(last);
        const half = heap.length >> 1;
        while (i < half) {
          let child = (i << 1) + 1;
          const right = child + 1;
          if (right < heap.length && scoreOf(heap[right]) < scoreOf(heap[child])) {
            child = right;
          }
          if (s <= scoreOf(heap[child])) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return top;
    };
    const heapSiftUpById = (id: number) => {
      let i = heap.indexOf(id);
      if (i <= 0) return;
      const s = scoreOf(id);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (scoreOf(heap[parent]) <= s) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = id;
    };

    while (heap.length > 0) {
      const currentId = heapPop();
      inOpenSet.delete(currentId);

      if (currentId === endNode.id) {
        return this.reconstructPath(cameFrom, currentId, end, body);
      }

      const currentEdges = this.edges.get(currentId) || [];
      for (const edge of currentEdges) {
        if (!this.traversal(this.nodes.get(edge.from)!, this.nodes.get(edge.to)!, edge.type, body))
          continue;
        const bPos = this.nodes.get(edge.to)!.position;
        const aPos = this.nodes.get(currentId)!.position;

        const dx = bPos.x - aPos.x;
        const dy = bPos.y - aPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const tentativeG = (gScore.get(currentId) ?? Infinity) + edge.cost + dist;

        if (tentativeG < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, currentId);
          gScore.set(edge.to, tentativeG);
          fScore.set(edge.to, tentativeG + this.heuristic(this.nodes.get(edge.to)!, endNode));

          if (!inOpenSet.has(edge.to)) {
            inOpenSet.add(edge.to);
            heapPush(edge.to);
          } else {
            heapSiftUpById(edge.to);
          }
        }
      }
    }

    return []; // No path found
  }

  private addNode(position: Vec2, platformId: number): number {
    const id = this.nextNodeId++;
    this.nodes.set(id, { id, position, platformId });
    return id;
  }

  private addEdge(from: number, to: number, type: "walk" | "jump" | "fall", baseCost: number = 0) {
    // Keep candidate edges; findPath checks clearance for the actual actor's body.
    if (!this.traversal(this.nodes.get(from)!, this.nodes.get(to)!, type, { width: 0, height: 0 }))
      return;
    if (!this.edges.has(from)) this.edges.set(from, []);

    const a = this.nodes.get(from)!.position;
    const b = this.nodes.get(to)!.position;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    this.edges.get(from)!.push({ from, to, type, cost: dist + baseCost });
  }

  private getClosestNode(pos: Vec2): NavNode | null {
    let closest: NavNode | null = null;
    let minDesc = Infinity;

    for (const node of this.nodes.values()) {
      const dx = node.position.x - pos.x;
      const dy = node.position.y - pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);

      // Optimization: Only snap to nodes if within reasonable range
      if (d < minDesc && d < 500) {
        minDesc = d;
        closest = node;
      }
    }
    return closest;
  }

  private heuristic(a: NavNode, b: NavNode): number {
    const dx = b.position.x - a.position.x;
    const dy = b.position.y - a.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private traversal(
    a: NavNode,
    b: NavNode,
    type: NavEdge["type"],
    body = { width: 32, height: 72 },
  ) {
    // Exact dimensions keep differently sized actors' clearance independent.
    const key = `${a.id}:${b.id}:${a.position.x}:${a.position.y}:${b.position.x}:${b.position.y}:${type}:${body.width}:${body.height}:${PLAYER_STATS.walkSpeed}`;
    const cached = this.traversalCache.get(key);
    if (cached !== undefined) return cached;
    const result = this.calculateTraversal(a, b, type, body);
    this.traversalCache.set(key, result);
    return result;
  }

  private calculateTraversal(
    a: NavNode,
    b: NavNode,
    type: NavEdge["type"],
    body: { width: number; height: number },
  ) {
    const source = this.terrain.get(a.platformId);
    const target = this.terrain.get(b.platformId);
    if (!source || !target) return null;
    const takeoff = { ...a.position };
    const landing = { ...b.position };
    const dropThrough = type === "fall" && source.type === "semisolid";
    if (type === "fall") {
      if (!dropThrough)
        takeoff.x =
          b.position.x < source.box.x + source.box.width / 2
            ? source.box.x - body.width / 2 - 1
            : source.box.x + source.box.width + body.width / 2 + 1;
      const left = target.box.x + body.width / 2;
      const right = target.box.x + target.box.width - body.width / 2;
      if (left > right) return null;
      landing.x = Math.max(left, Math.min(right, takeoff.x));
    }
    const dy = landing.y - takeoff.y;
    const discriminant = ENEMY_JUMP_SPEED * ENEMY_JUMP_SPEED + 2 * GRAVITY * dy;
    if (type === "jump" && discriminant < 0) return null;
    const duration =
      type === "walk"
        ? Math.abs(landing.x - takeoff.x) / (PLAYER_STATS.walkSpeed * 0.8)
        : type === "jump"
          ? (ENEMY_JUMP_SPEED + Math.sqrt(discriminant)) / GRAVITY
          : Math.sqrt(Math.max(0, (2 * dy) / GRAVITY));
    if (
      type !== "walk" &&
      (duration <= 0 || Math.abs(landing.x - takeoff.x) / duration > PLAYER_STATS.walkSpeed * 0.8)
    )
      return null;
    const samples = Math.max(1, Math.ceil(duration / 0.008));
    let oldFeet = takeoff.y;
    for (let i = 0; i <= samples; i++) {
      const time = (duration * i) / samples;
      const x = takeoff.x + ((landing.x - takeoff.x) * i) / samples;
      const y =
        type === "walk"
          ? takeoff.y
          : takeoff.y +
            (type === "jump" ? -ENEMY_JUMP_SPEED * time : 0) +
            0.5 * GRAVITY * time * time;
      const actor = {
        x: x - body.width / 2,
        y: y - body.height,
        width: body.width,
        height: body.height,
      };
      for (const id of this.terrainGrid.query(actor, this.terrainQueryBuffer)) {
        const obstacle = this.terrain.get(id)!;
        if (id === a.platformId || obstacle.type === "ladder") continue;
        if (obstacle.type === "semisolid") {
          if (y <= oldFeet || oldFeet > obstacle.box.y || y < obstacle.box.y) continue;
        }
        if (aabbIntersects(actor, obstacle.box)) return null;
      }
      oldFeet = y;
    }
    return { takeoff, landing, dropThrough };
  }

  private reconstructPath(
    cameFrom: Map<number, number>,
    currentId: number,
    endPos: Vec2,
    body: { width: number; height: number },
  ): NavStep[] {
    const path: NavStep[] = [{ ...endPos, action: "walk" }];
    let curr = currentId;
    while (cameFrom.has(curr)) {
      const previous = cameFrom.get(curr)!;
      const edge = this.edges.get(previous)!.find((candidate) => candidate.to === curr)!;
      const route = this.traversal(
        this.nodes.get(previous)!,
        this.nodes.get(curr)!,
        edge.type,
        body,
      )!;
      path.unshift({
        ...route.landing,
        action: edge.type,
        takeoff: { ...route.takeoff },
        dropThrough: route.dropThrough,
      });
      curr = previous;
    }
    return path;
  }
}
