import { BoneDrawing, DrawingLayer } from "./BoneDrawing";

// Art is authored in the shared rig's local coordinates. Multiple vector layers
// retain the reference's bone/muscle/hide contrast at the Alpha's larger size.
function hellhoundArt(alpha: boolean): Record<string, BoneDrawing> {
  const hide = alpha ? "#343036" : "#302c32",
    shadow = "#1b191f";
  const flesh = alpha ? "#8e302e" : "#74302e",
    meat = "#4c171e";
  const bone = alpha ? "#ddc8a1" : "#bfa985",
    light = "#f3dfb9",
    iron = "#29262b";
  const layer = (path: string, fill: string): DrawingLayer => ({ path, fill });
  const drawing = (path: string, layers: DrawingLayer[] = [], fill = hide): BoneDrawing => ({
    path,
    fill,
    stroke: shadow,
    strokeWidth: 0.45,
    layers,
    vector: true,
  });
  const paths: Record<string, BoneDrawing> = {
    pelvis: drawing("M -6 -5 C -2 -9 6 -7 8 -1 L 6 6 L 1 8 L -5 5 L -7 0 Z", [
      layer("M -5 -3 C -2 -7 4 -5 5 -1 L 2 5 L -3 3 Z", flesh),
      layer("M -4 -5 L -1 -6 L 0 -2 L -2 1 L -3 -1 Z M 4 -5 L 6 -3 L 3 0 L 2 -1 Z", bone),
      layer("M -3 -2 L -1 -3 L -1 3 L -3 2 Z", meat),
    ]),
    torso: drawing(
      "M 0 -5 C 7 -7 16 -6 24 -9 L 29 -6 L 30 2 C 23 9 18 12 12 8 L 7 6 L 4 8 L 3 4 L -2 3 Z",
      [
        layer("M 6 -3 C 15 -6 24 -7 27 -4 L 26 3 C 22 8 17 10 12 7 L 7 4 Z", meat),
        layer(
          "M 7 -2 L 12 -4 L 13 4 L 16 7 L 13 6 L 10 3 Z M 17 -5 L 23 -6 L 24 4 L 20 8 L 19 4 Z",
          flesh,
        ),
        layer(
          "M 8 -3 L 10 -4 C 11 0 11 5 15 7 L 13 7 C 9 4 9 0 8 -3 Z M 12 -4 L 14 -5 C 14 1 15 6 18 8 L 16 8 C 13 4 13 0 12 -4 Z M 17 -5 L 19 -6 C 18 0 19 5 21 7 L 19 8 C 17 4 17 0 17 -5 Z M 22 -6 L 24 -7 C 22 -2 23 3 24 5 L 22 6 C 20 2 21 -3 22 -6 Z",
          bone,
        ),
        layer(
          "M 0 -5 L 4 -6 L 3 -9 L 5 -8 L 7 -6 L 10 -6 L 9 -9 L 12 -8 L 13 -6 L 17 -7 L 17 -10 L 20 -9 L 21 -7 L 25 -9 L 26 -12 L 28 -9 L 29 -6 L 25 -6 L 19 -5 L 12 -4 L 5 -3 Z",
          bone,
        ),
        layer(
          "M 1 -4 L 5 -5 L 4 -3 L 7 -2 L 6 2 L 8 5 L 5 4 L 4 6 L 2 3 Z M 25 -4 L 29 -6 L 30 2 L 26 5 L 27 1 L 24 0 Z",
          hide,
        ),
      ],
    ),
    chest: drawing("M -7 -6 C -2 -12 4 -10 7 -5 L 7 2 L 4 7 L 2 9 L 0 5 L -3 7 L -5 3 L -8 1 Z", [
      layer("M -2 -8 C 2 -10 5 -6 5 -1 L 2 6 L -1 4 L -3 0 Z", flesh),
      layer("M -1 -7 L 1 -9 L 3 -6 L 1 -3 L 2 2 L 0 5 L -1 1 L -3 -2 Z", bone),
      layer("M 2 -6 L 4 -5 L 3 -1 L 2 0 Z M -5 -2 L -3 0 L -4 4 L -6 1 Z", meat),
    ]),
    neck: drawing("M -5 1 L -6 -4 L -3 -10 L 1 -12 L 6 -6 L 5 -1 L 3 5 L 1 7 L -1 3 L -3 5 Z", [
      layer("M -2 -9 L 1 -11 L 4 -6 L 3 0 L 0 4 L -2 1 Z", flesh),
      layer("M 0 -10 L 2 -9 L 0 -4 L 2 -1 L 0 3 L -1 0 L -2 -3 Z", bone),
      layer("M -5 -7 L -1 -9 L 4 -3 L 3 0 L -2 -1 Z", iron),
      layer(
        "M -4 -6 L -6 -10 L -1 -7 Z M 0 -5 L 1 -9 L 3 -4 Z M 3 -2 L 7 -3 L 4 1 Z",
        alpha ? light : "#89817a",
      ),
      layer(
        "M 1 0 C 7 -1 6 6 2 7 C -2 7 -2 2 1 0 Z M 2 1 C 0 3 0 6 3 6 C 6 4 5 1 2 1 Z",
        "#877c6e",
      ),
    ]),
    head: drawing(
      "M -5 -3 L -3 -7 L 2 -6 L 5 -3 L 10 -1 L 13 2 L 12 4 L 7 4 L 3 3 L 0 5 L -4 3 Z",
      [
        layer(
          "M -4 -5 L 0 -6 L 3 -3 L 5 -2 L 6 0 L 11 1 L 12 3 L 8 3 L 4 2 L 2 4 L -1 3 L -4 1 Z",
          bone,
        ),
        layer("M -2 -2 C -2 -5 2 -4 3 -2 C 3 0 -1 1 -2 -2 Z", meat),
        layer("M -1 -2 C -1 -3 1 -4 2 -2 C 3 0 0 1 -1 -2 Z", "#d42024"),
        layer("M 0 -2 C 0 -3 1 -3 1 -2 C 2 -1 0 0 0 -2 Z", "#ffbeb0"),
        layer("M 9 1 L 13 2 L 12 4 L 10 3 Z", shadow),
        layer(
          "M 3 3 L 4 3 L 4 6 L 3 5 Z M 5 3 L 6 3 L 6 5 L 5 4 Z M 7 3 L 8 3 L 8 6 L 7 5 Z M 10 3 L 11 3 L 10 7 L 9 4 Z",
          light,
        ),
        layer("M -5 -3 L -3 -2 L -4 1 L -2 4 L -4 6 L -5 3 Z", hide),
      ],
    ),
    jaw: drawing("M -2 0 L 1 1 L 5 2 L 10 2 L 12 1 L 11 4 L 7 5 L 2 4 L -1 2 Z", [
      layer("M 0 2 L 5 3 L 10 3 L 11 2 L 10 4 L 6 5 L 2 4 Z", bone),
      layer("M 2 2 L 3 -1 L 4 3 Z M 5 3 L 6 0 L 7 3 Z M 8 3 L 9 0 L 10 3 Z", light),
      layer("M -1 2 L 2 3 L 3 6 L 1 4 L 0 7 Z", flesh),
    ]),
  };
  for (const side of ["far", "near"]) {
    paths[`ear-${side}`] = drawing(
      "M -3 2 L -4 -3 L -3 -13 L 1 -5 L 2 -1 L 0 3 Z",
      [
        layer("M -2 1 L -3 -10 L 0 -4 L 1 0 Z", flesh),
        layer("M -3 0 L -2 -5 L -1 -3 L -1 1 L 1 0 L 0 2 Z", bone),
        layer("M -3 -9 L -2 -6 L -3 -4 Z", meat),
      ],
      side === "far" ? shadow : hide,
    );
    for (const pair of ["fore", "hind"]) {
      const hind = pair === "hind",
        near = side === "near";
      const name = `${pair}-${side}`;
      paths[`${name}-upper`] = drawing(
        hind
          ? "M -4 -2 C 1 -4 5 0 6 5 L 5 8 L 2 9 L 0 4 L -3 3 Z"
          : "M -3 -2 L 3 -1 L 3 4 L 2 8 L -2 8 L -4 3 Z",
        [
          layer(
            hind ? "M -2 -1 L 1 0 L 4 5 L 2 7 L 0 3 Z" : "M -2 0 L 1 -1 L 2 4 L 0 7 L -2 5 Z",
            near ? flesh : meat,
          ),
          layer(
            hind ? "M 1 0 L 2 0 L 4 6 L 3 8 L 2 6 Z" : "M 0 0 L 1 1 L 0 5 L 1 7 L -1 8 L -2 6 Z",
            bone,
          ),
        ],
        near ? hide : shadow,
      );
      paths[`${name}-lower`] = drawing(
        hind
          ? "M -2 -1 L 2 0 L 0 3 L -3 6 L -6 5 L -5 3 Z"
          : "M -2 -1 L 2 0 L 2 4 L 3 6 L -1 7 L -2 4 Z",
        [
          layer(
            hind ? "M -1 0 L 1 0 L -2 4 L -5 5 L -4 3 Z" : "M -1 0 L 1 0 L 1 4 L 2 6 L 0 6 Z",
            flesh,
          ),
          layer(
            hind
              ? "M 0 0 L 1 1 L -2 4 L -4 5 L -5 4 L -3 3 Z"
              : "M 0 0 L 1 1 L 1 4 L 2 6 L 0 6 L -1 4 Z",
            bone,
          ),
          ...(alpha
            ? [
                layer(hind ? "M -5 2 L -1 3 L -2 5 L -6 4 Z" : "M -2 3 L 2 3 L 3 5 L -2 5 Z", iron),
                layer(
                  hind
                    ? "M -5 2 L -7 0 L -3 2 Z M -2 4 L 1 5 L -3 5 Z"
                    : "M -2 3 L -5 2 L -2 4 Z M 2 3 L 5 4 L 2 5 Z",
                  light,
                ),
              ]
            : []),
        ],
        near ? hide : shadow,
      );
      paths[`${name}-paw`] = drawing(
        "M -2 -2 L 1 -2 L 2 -1 L 5 0 L 5 1 L -3 1 Z",
        [
          layer("M -2 -1 L 0 -2 L 1 0 L 3 -1 L 4 0 L 3 1 L 0 0 L -2 1 Z", bone),
          layer("M 2 0 L 4 -1 L 6 1 L 4 0 L 3 2 Z M 0 0 L 2 0 L 3 2 L 1 1 Z", "#928b82"),
        ],
        near ? hide : shadow,
      );
    }
  }
  for (const [part, shape, exposed] of [
    [
      "base",
      "M 1 -2 L -6 0 L -11 3 L -9 6 L -4 4 L 0 2 Z",
      "M -1 -1 L -4 0 L -4 2 L -7 2 L -8 4 L -6 4 L -2 2 Z",
    ],
    [
      "mid",
      "M 1 -2 L -5 1 L -10 6 L -8 9 L -4 5 L 1 2 Z",
      "M -2 1 L -4 2 L -4 4 L -6 4 L -7 7 L -5 6 L -2 3 Z",
    ],
    [
      "tip",
      "M 1 -2 C -9 3 -10 12 -3 14 C -7 12 -5 7 1 2 Z",
      "M -2 1 L -4 3 L -4 5 L -6 6 L -6 8 L -4 7 L -3 4 Z",
    ],
  ])
    paths[`tail-${part}`] = drawing(shape, [
      layer(exposed, bone),
      layer("M -1 0 L 0 0 L -3 3 L -4 3 Z", flesh),
    ]);
  // Match the long forelegs and bent hocks in the reference. Layer coordinates
  // are authored in the compact template above, then stretched as vector data.
  for (const [name, art] of Object.entries(paths)) {
    if (!name.endsWith("-upper") && !name.endsWith("-lower")) continue;
    const hind = name.startsWith("hind"),
      upper = name.endsWith("-upper");
    const sx = hind ? (upper ? 7 / 4 : 8 / 5) : 1;
    const sy = hind ? (upper ? 12 / 7 : 9 / 4) : upper ? 13 / 7 : 12 / 6;
    for (const part of [art, ...(art.layers ?? [])]) {
      let coordinate = 0;
      part.path = part.path.replace(/-?\d+(?:\.\d+)?/g, (value) =>
        String(Number(value) * (coordinate++ % 2 ? sy : sx)),
      );
    }
  }
  return paths;
}

export const HellhoundBonePaths = hellhoundArt(false);
export const AlphaHellhoundBonePaths = hellhoundArt(true);
