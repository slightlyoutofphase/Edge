export interface Vec2 {
  x: number;
  y: number;
}

export const Vec2Zero = { x: 0, y: 0 };

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vec2Len(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Len(v);
  return len === 0 ? { x: 0, y: 0 } : vec2Scale(v, 1 / len);
}

export function vec2Lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

// Mutable operations for Garbage Collection optimization
export function vec2Set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function vec2Copy(out: Vec2, src: Vec2): Vec2 {
  out.x = src.x;
  out.y = src.y;
  return out;
}

export function vec2AddMut(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function vec2SubMut(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function vec2ScaleMut(out: Vec2, v: Vec2, s: number): Vec2 {
  out.x = v.x * s;
  out.y = v.y * s;
  return out;
}

export class Vec2Pool {
  private pool: Vec2[] = [];

  acquire(): Vec2 {
    return this.pool.pop() || { x: 0, y: 0 };
  }

  release(v: Vec2) {
    this.pool.push(v);
  }
}

export const vecPool = new Vec2Pool();
