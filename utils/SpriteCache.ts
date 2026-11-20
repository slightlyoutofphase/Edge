export class SpriteCache {
  private static cache = new Map<string, ImageBitmap | HTMLCanvasElement>();
  // WeakMap for object-reference caching (zero string allocation)
  private static refCache = new WeakMap<object, ImageBitmap | HTMLCanvasElement>();
  private static boundsCache = new Map<
    string,
    Readonly<{ x: number; y: number; width: number; height: number }>
  >();
  private static coordinateCache = new Map<string, readonly number[]>();

  static getCoordinates(d: string): readonly number[] {
    let values = this.coordinateCache.get(d);
    if (!values) {
      values = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      this.coordinateCache.set(d, values);
    }
    return values;
  }

  // Compute axis-aligned bounds from SVG path data supporting absolute/relative commands
  static getBounds(d: string): Readonly<{ x: number; y: number; width: number; height: number }> {
    const cached = this.boundsCache.get(d);
    if (cached) return cached;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const expand = (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };

    const len = d.length;
    let idx = 0;
    const skipSep = () => {
      while (idx < len) {
        const ch = d.charCodeAt(idx);
        if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 44) idx++;
        else break;
      }
    };
    const isCommandChar = (ch: number) => (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
    const readNumber = (): number | null => {
      skipSep();
      if (idx >= len) return null;
      const start = idx;
      if (d[idx] === "+" || d[idx] === "-") idx++;
      let hasDigits = false;
      while (idx < len && d.charCodeAt(idx) >= 48 && d.charCodeAt(idx) <= 57) {
        hasDigits = true;
        idx++;
      }
      if (idx < len && d[idx] === ".") {
        idx++;
        while (idx < len && d.charCodeAt(idx) >= 48 && d.charCodeAt(idx) <= 57) {
          hasDigits = true;
          idx++;
        }
      }
      if (!hasDigits) {
        idx = start;
        return null;
      }
      if (idx < len && (d[idx] === "e" || d[idx] === "E")) {
        const expStart = idx++;
        if (idx < len && (d[idx] === "+" || d[idx] === "-")) idx++;
        let expDigits = false;
        while (idx < len && d.charCodeAt(idx) >= 48 && d.charCodeAt(idx) <= 57) {
          expDigits = true;
          idx++;
        }
        if (!expDigits) idx = expStart;
      }
      return parseFloat(d.slice(start, idx));
    };
    const readFlag = (): number | null => {
      skipSep();
      if (idx >= len) return null;
      const ch = d[idx];
      if (ch === "0" || ch === "1") {
        idx++;
        return ch === "1" ? 1 : 0;
      }
      return null;
    };

    let cmd = "";
    let cx = 0,
      cy = 0,
      sx = 0,
      sy = 0;

    while (idx < len) {
      skipSep();
      if (idx >= len) break;

      const ch = d.charCodeAt(idx);
      if (isCommandChar(ch)) {
        cmd = d[idx++];
      } else if (!cmd) {
        break;
      }

      const rel = cmd >= "a" && cmd <= "z";
      const upper = cmd.toUpperCase();

      if (upper === "Z") {
        cx = sx;
        cy = sy;
        cmd = "";
        continue;
      }

      if (upper === "M") {
        const x = readNumber(),
          y = readNumber();
        if (x === null || y === null) break;
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        sx = cx;
        sy = cy;
        expand(cx, cy);
        cmd = rel ? "l" : "L";
      } else if (upper === "L" || upper === "T") {
        const x = readNumber(),
          y = readNumber();
        if (x === null || y === null) break;
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        expand(cx, cy);
      } else if (upper === "H") {
        const x = readNumber();
        if (x === null) break;
        cx = rel ? cx + x : x;
        expand(cx, cy);
      } else if (upper === "V") {
        const y = readNumber();
        if (y === null) break;
        cy = rel ? cy + y : y;
        expand(cx, cy);
      } else if (upper === "C") {
        const x1 = readNumber(),
          y1 = readNumber(),
          x2 = readNumber(),
          y2 = readNumber(),
          x = readNumber(),
          y = readNumber();
        if (x1 === null || y1 === null || x2 === null || y2 === null || x === null || y === null)
          break;
        expand(rel ? cx + x1 : x1, rel ? cy + y1 : y1);
        expand(rel ? cx + x2 : x2, rel ? cy + y2 : y2);
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        expand(cx, cy);
      } else if (upper === "S" || upper === "Q") {
        const x1 = readNumber(),
          y1 = readNumber(),
          x = readNumber(),
          y = readNumber();
        if (x1 === null || y1 === null || x === null || y === null) break;
        expand(rel ? cx + x1 : x1, rel ? cy + y1 : y1);
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        expand(cx, cy);
      } else if (upper === "A") {
        let rx = readNumber(),
          ry = readNumber();
        const rot = readNumber(),
          largeArc = readFlag(),
          sweep = readFlag(),
          x = readNumber(),
          y = readNumber();
        if (
          rx === null ||
          ry === null ||
          rot === null ||
          largeArc === null ||
          sweep === null ||
          x === null ||
          y === null
        )
          break;
        const nx = rel ? cx + x : x;
        const ny = rel ? cy + y : y;
        expand(cx, cy);
        expand(nx, ny);

        rx = Math.abs(rx);
        ry = Math.abs(ry);
        if (rx > 0 && ry > 0 && (nx !== cx || ny !== cy)) {
          // SVG endpoint-to-center arc parameterization to sample extrema accurately
          const phi = (rot * Math.PI) / 180;
          const cosPhi = Math.cos(phi),
            sinPhi = Math.sin(phi);
          const dx2 = (cx - nx) / 2,
            dy2 = (cy - ny) / 2;
          const x1p = cosPhi * dx2 + sinPhi * dy2;
          const y1p = -sinPhi * dx2 + cosPhi * dy2;
          const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
          if (lam > 1) {
            const s = Math.sqrt(lam);
            rx *= s;
            ry *= s;
          }
          const rx2 = rx * rx,
            ry2 = ry * ry,
            x1p2 = x1p * x1p,
            y1p2 = y1p * y1p;
          const denom = rx2 * y1p2 + ry2 * x1p2;
          const num = Math.max(0, rx2 * ry2 - denom);
          const factor = (largeArc === sweep ? -1 : 1) * (denom > 0 ? Math.sqrt(num / denom) : 0);
          const cxp = (factor * rx * y1p) / ry;
          const cyp = (factor * -ry * x1p) / rx;
          const ecx = cosPhi * cxp - sinPhi * cyp + (cx + nx) / 2;
          const ecy = sinPhi * cxp + cosPhi * cyp + (cy + ny) / 2;
          const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
            const dot = ux * vx + uy * vy;
            const mag = Math.hypot(ux, uy) * Math.hypot(vx, vy);
            const sign = ux * vy - uy * vx < 0 ? -1 : 1;
            return sign * Math.acos(mag > 0 ? Math.max(-1, Math.min(1, dot / mag)) : 1);
          };
          const ux = (x1p - cxp) / rx,
            uy = (y1p - cyp) / ry;
          const vx = (-x1p - cxp) / rx,
            vy = (-y1p - cyp) / ry;
          const theta1 = vecAngle(1, 0, ux, uy);
          let dTheta = vecAngle(ux, uy, vx, vy);
          if (sweep === 0 && dTheta > 0) dTheta -= Math.PI * 2;
          else if (sweep === 1 && dTheta < 0) dTheta += Math.PI * 2;
          for (let s = 1; s <= 15; s++) {
            const t = theta1 + (dTheta * s) / 16;
            const ex = rx * Math.cos(t),
              ey = ry * Math.sin(t);
            expand(ecx + cosPhi * ex - sinPhi * ey, ecy + sinPhi * ex + cosPhi * ey);
          }
        }
        cx = nx;
        cy = ny;
      } else {
        break;
      }
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      const bounds = { x: -16, y: -16, width: 32, height: 32 }; // Fallback
      this.boundsCache.set(d, bounds);
      return bounds;
    }

    // Add padding for stroke
    const padding = 4;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const bounds = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
    this.boundsCache.set(d, bounds);
    return bounds;
  }

  // Overload for object-based lookup (preferred for performance)
  static get(
    ref: object,
    path: string,
    fill: string,
    stroke?: string,
    strokeWidth?: number,
  ): ImageBitmap | HTMLCanvasElement | null;
  // Overload for legacy string-based lookup
  static get(
    path: string,
    fill: string,
    stroke?: string,
    strokeWidth?: number,
  ): ImageBitmap | HTMLCanvasElement | null;

  static get(
    arg1: any,
    arg2: any,
    arg3?: any,
    arg4?: any,
    arg5?: any,
  ): ImageBitmap | HTMLCanvasElement | null {
    let ref: object | null = null;
    let path: string;
    let fill: string;
    let stroke: string | undefined;
    let strokeWidth: number | undefined;

    // Parse arguments based on first type
    if (typeof arg1 === "object" && arg1 !== null) {
      ref = arg1 as object;
      // Check WeakMap first
      if (this.refCache.has(ref!)) {
        return this.refCache.get(ref!)!;
      }
      path = arg2;
      fill = arg3;
      stroke = arg4;
      strokeWidth = arg5;
    } else {
      path = arg1;
      fill = arg2;
      stroke = arg3;
      strokeWidth = arg4;
    }

    // If not found in WeakMap (or no ref provided), try string cache
    // We still need to generate the sprite if it doesn't exist anywhere
    const key = `${path}_${fill}_${stroke}_${strokeWidth}`;

    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!;
      // If we have a ref, populate WeakMap for next time
      if (ref) this.refCache.set(ref, hit);
      return hit;
    }

    // Generate
    const bounds = { ...this.getBounds(path) };

    if (bounds.width > 500 || bounds.height > 500) {
      bounds.width = 100;
      bounds.height = 100;
      bounds.x = -50;
      bounds.y = -50;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(bounds.width);
    canvas.height = Math.ceil(bounds.height);
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.translate(-bounds.x, -bounds.y);
      const p2d = new Path2D(path);

      if (fill && fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fill(p2d);
      }

      if (stroke && strokeWidth) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeWidth;
        ctx.stroke(p2d);
      }

      (canvas as any).offsetX = bounds.x;
      (canvas as any).offsetY = bounds.y;

      this.cache.set(key, canvas);
      if (ref) this.refCache.set(ref, canvas);
      return canvas;
    }

    return null;
  }

  static clear() {
    this.cache.clear();
    this.boundsCache.clear();
    this.coordinateCache.clear();
    // WeakMap clears itself mostly, but we can't manually clear it easily without creating a new one
    this.refCache = new WeakMap();
  }
}
