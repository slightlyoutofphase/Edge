export class Matrix2D {
  a: number = 1;
  b: number = 0;
  c: number = 0;
  d: number = 1;
  tx: number = 0;
  ty: number = 0;

  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
    this.set(a, b, c, d, tx, ty);
  }

  set(a: number, b: number, c: number, d: number, tx: number, ty: number): this {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
    return this;
  }

  identity(): this {
    return this.set(1, 0, 0, 1, 0, 0);
  }

  clone(): Matrix2D {
    return new Matrix2D(this.a, this.b, this.c, this.d, this.tx, this.ty);
  }

  copy(other: Matrix2D): this {
    return this.set(other.a, other.b, other.c, other.d, other.tx, other.ty);
  }

  multiply(other: Matrix2D): this {
    const a = this.a * other.a + this.c * other.b;
    const b = this.b * other.a + this.d * other.b;
    const c = this.a * other.c + this.c * other.d;
    const d = this.b * other.c + this.d * other.d;
    const tx = this.a * other.tx + this.c * other.ty + this.tx;
    const ty = this.b * other.tx + this.d * other.ty + this.ty;
    return this.set(a, b, c, d, tx, ty);
  }

  translate(x: number, y: number): this {
    this.tx += this.a * x + this.c * y;
    this.ty += this.b * x + this.d * y;
    return this;
  }

  scale(sx: number, sy: number): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    return this;
  }

  rotate(radians: number): this {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const a = this.a * cos + this.c * sin;
    const b = this.b * cos + this.d * sin;
    const c = this.a * -sin + this.c * cos;
    const d = this.b * -sin + this.d * cos;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return this;
  }
}
