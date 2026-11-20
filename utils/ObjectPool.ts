export class ObjectPool<T> {
  private free: T[] = [];
  private active: T[] = [];
  private factory: () => T;
  private resetFn: (item: T) => void;

  constructor(factory: () => T, resetFn: (item: T) => void, initialSize: number = 0) {
    this.factory = factory;
    this.resetFn = resetFn;

    for (let i = 0; i < initialSize; i++) {
      this.free.push(this.factory());
    }
  }

  acquire(): T {
    let item: T;
    if (this.free.length > 0) {
      item = this.free.pop()!;
    } else {
      item = this.factory();
    }
    this.active.push(item);
    this.resetFn(item);
    return item;
  }

  release(item: T) {
    const index = this.active.indexOf(item);
    if (index !== -1) {
      this.active.splice(index, 1);
      this.free.push(item);
    }
  }

  getStats() {
    return {
      free: this.free.length,
      active: this.active.length,
      total: this.free.length + this.active.length,
    };
  }
}
