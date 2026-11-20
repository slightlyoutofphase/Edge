export class SpatialHashGrid {
  private cellSize: number;
  private buckets: Map<number, number[]>;
  private querySet: Set<number>;
  private spareBuckets: number[][] = [];

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.buckets = new Map();
    this.querySet = new Set();
  }

  clear() {
    for (const bucket of this.buckets.values()) {
      bucket.length = 0;
      this.spareBuckets.push(bucket);
    }
    this.buckets.clear();
  }

  // Integer hash function to avoid string allocation
  // Uses large primes to distribute keys
  private getKey(x: number, y: number): number {
    // Bitwise operations in JS operate on 32-bit signed integers.
    // We use unsigned right shift (>>> 0) to ensure positive integers for the Map key.
    return ((x * 73856093) ^ (y * 19349663)) >>> 0;
  }

  insert(id: number, rect: { x: number; y: number; width: number; height: number }) {
    const startX = Math.floor(rect.x / this.cellSize);
    const endX = Math.floor((rect.x + rect.width) / this.cellSize);
    const startY = Math.floor(rect.y / this.cellSize);
    const endY = Math.floor((rect.y + rect.height) / this.cellSize);

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const key = this.getKey(x, y);
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = this.spareBuckets.pop() ?? [];
          this.buckets.set(key, bucket);
        }
        bucket.push(id);
      }
    }
  }

  query(rect: { x: number; y: number; width: number; height: number }, out: number[]): number[] {
    const startX = Math.floor(rect.x / this.cellSize);
    const endX = Math.floor((rect.x + rect.width) / this.cellSize);
    const startY = Math.floor(rect.y / this.cellSize);
    const endY = Math.floor((rect.y + rect.height) / this.cellSize);

    this.querySet.clear();
    out.length = 0;

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const key = this.getKey(x, y);
        const ids = this.buckets.get(key);
        if (ids) {
          const len = ids.length;
          for (let i = 0; i < len; i++) {
            this.querySet.add(ids[i]);
          }
        }
      }
    }

    for (const id of this.querySet) {
      out.push(id);
    }

    return out;
  }
}
