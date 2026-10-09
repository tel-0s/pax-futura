import type { Map as MaplibreMap } from "maplibre-gl";
import type { WorldState } from "@pax/domain";
import { inFilter, type Ownership } from "./ownership.ts";

/**
 * Polity name placement, computed from the geometry the map has actually
 * loaded (no label-point dataset ships with the tiles). Each polity gets one
 * label at the area-weighted centroid of its territory — or, when that falls
 * outside it (empires split by sea), at the pole of inaccessibility of its
 * largest landmass. Sizes follow territory; collisions resolve big-first.
 */

export interface PlacedLabel {
  code: string;
  /** Unique per label: a polity split across seas gets one per block. */
  key: string;
  lines: string[];
  lng: number;
  lat: number;
  /** Font size, px. */
  size: number;
  isPlayer: boolean;
}

export interface LabelFont {
  family: string;
  weight: number;
  /** Letter spacing in em. */
  tracking: number;
  uppercase: boolean;
  /** Size multiplier for the face. */
  scale: number;
}

interface Piece {
  ring: number[][]; // projected [x, y] in 0..1 world units
  area: number;
  cx: number;
  cy: number;
  bbox: [number, number, number, number];
}

const MIN_SIZE = 9;
const MAX_SIZE = 26;

/** Screen-pixel margins covered by chrome; labels only describe what's visible. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const computeLabels = (
  map: MaplibreMap,
  world: WorldState,
  ownership: Ownership,
  playerCode: string | null,
  font: LabelFont,
  insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 },
): PlacedLabel[] => {
  if (!map.getSource("countries")) return [];
  const view = visibleWindow(map, insets);
  const byOwner = new Map<string, Piece[]>();
  const add = (owner: string, feature: FeatureLike) => {
    for (const ring of outerRings(feature)) {
      const projected = ring.map(([lng, lat]) => project(lng!, lat!));
      const clipped = view ? clipToRect(projected, view) : projected;
      const piece = toPiece(clipped);
      if (piece) (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(piece);
    }
  };

  const ownedCountries = Object.keys(ownership.countryOwner);
  if (ownedCountries.length) {
    for (const feature of map.querySourceFeatures("countries", {
      sourceLayer: "countries",
      filter: inFilter("GID_0", ownedCountries) as never,
    })) {
      const owner = ownership.countryOwner[feature.properties?.GID_0 as string];
      if (owner) add(owner, feature);
    }
  }
  const overridden = Object.keys(ownership.regionOwner);
  if (overridden.length && map.getSource("regions")) {
    for (const feature of map.querySourceFeatures("regions", {
      sourceLayer: "regions",
      filter: inFilter("GID_1", overridden) as never,
    })) {
      const owner = ownership.regionOwner[feature.properties?.GID_1 as string];
      if (owner) add(owner, feature);
    }
  }

  const worldPx = 512 * 2 ** map.getZoom();
  const measure = measurer(font);
  const candidates: Array<PlacedLabel & { side: number; width: number; height: number }> = [];

  for (const [code, allPieces] of byOwner) {
    const polity = world.polities[code];
    const name = polity?.name || code;
    const isPlayer = code === playerCode;
    const text = font.uppercase ? name.toUpperCase() : name;
    // Islets and tile slivers only add noise to clustering and centroids.
    const biggest = Math.max(...allPieces.map((piece) => piece.area));
    const pieces = allPieces.filter((piece) => piece.area >= biggest * 0.004);
    const groups = clusterPieces(pieces);
    const largestGroup = groups[0]?.area ?? 0;

    // One label per substantial contiguous block (an empire across seas gets
    // one per continent), biggest first; small outliers stay unlabeled.
    for (const [rank, group] of groups.entries()) {
      if (rank > 0 && (rank >= 3 || group.area < largestGroup * 0.12)) break;
      let ax = group.cx;
      let ay = group.cy;
      let area = group.area;
      if (!group.pieces.some((piece) => pointInRing(ax, ay, piece.ring))) {
        const anchor = group.pieces.reduce((a, b) => (b.area > a.area ? b : a));
        [ax, ay] = poleOfInaccessibility(anchor.ring);
        area = Math.max(anchor.area, group.area * 0.5);
      }
      const side = Math.sqrt(area) * worldPx;
      if (side < 14 && !(isPlayer && rank === 0)) continue;

      let size = clamp((side / 8.5) * font.scale, MIN_SIZE * font.scale, MAX_SIZE * font.scale);
      if (rank > 0) size *= 0.85;
      const allowed = Math.max(side * 1.45, 54);
      let lines = [text];
      let width = measure(text, size);
      if (width > allowed && text.includes(" ")) {
        lines = splitBalanced(text);
        width = Math.max(...lines.map((line) => measure(line, size)));
      }
      if (width > allowed) {
        size = Math.max(MIN_SIZE * font.scale, (size * allowed) / width);
        width = Math.max(...lines.map((line) => measure(line, size)));
      }
      if (width > allowed * 1.6 && !(isPlayer && rank === 0)) continue;

      const [lng, lat] = unproject(ax, ay);
      candidates.push({
        code,
        key: `${code}:${rank}`,
        lines,
        lng,
        lat,
        size: Math.round(size * 10) / 10,
        isPlayer,
        side: rank === 0 ? side : side * 0.8,
        width,
        height: lines.length * size * 1.15,
      });
    }
  }

  // Big territories (and the player) claim space first.
  candidates.sort((a, b) => Number(b.isPlayer) - Number(a.isPlayer) || b.side - a.side);
  const placed: Array<[number, number, number, number]> = [];
  const result: PlacedLabel[] = [];
  const canvas = map.getCanvas();
  const viewW = canvas.clientWidth;
  const viewH = canvas.clientHeight;
  for (const candidate of candidates) {
    const point = map.project([candidate.lng, candidate.lat]);
    // Slide a label that would hang under the chrome back into the clear
    // view (it still sits on its own territory — blocks are clipped to the
    // view, so the anchor is near this edge only when the land continues).
    const halfW = candidate.width / 2 + 6;
    const halfH = candidate.height / 2 + 4;
    const minX = insets.left + halfW;
    const maxX = viewW - insets.right - halfW;
    const minY = insets.top + halfH;
    const maxY = viewH - insets.bottom - halfH;
    const nx = minX <= maxX ? Math.min(Math.max(point.x, minX), maxX) : point.x;
    const ny = minY <= maxY ? Math.min(Math.max(point.y, minY), maxY) : point.y;
    if (nx !== point.x || ny !== point.y) {
      const moved = map.unproject([nx, ny]);
      candidate.lng = moved.lng;
      candidate.lat = moved.lat;
      point.x = nx;
      point.y = ny;
    }
    const pad = 3;
    const box: [number, number, number, number] = [
      point.x - candidate.width / 2 - pad,
      point.y - candidate.height / 2 - pad,
      point.x + candidate.width / 2 + pad,
      point.y + candidate.height / 2 + pad,
    ];
    if (placed.some((other) => overlaps(box, other))) continue;
    placed.push(box);
    const { side: _side, width: _width, height: _height, ...label } = candidate;
    result.push(label);
  }
  return result;
};

// ── geometry ──────────────────────────────────────────────────────────────

interface Group {
  pieces: Piece[];
  area: number;
  cx: number;
  cy: number;
}

/**
 * Contiguous blocks of territory: union-find over pieces whose bounding boxes
 * touch (tile fragments of one country share an edge; neighbouring countries
 * share a border). Largest block first.
 */
const clusterPieces = (pieces: Piece[]): Group[] => {
  const parent = pieces.map((_, index) => index);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const pad = 0.0015; // ~0.5° of slack so coast-hugging neighbours join up
  for (let i = 0; i < pieces.length; i++) {
    const a = pieces[i]!.bbox;
    for (let j = i + 1; j < pieces.length; j++) {
      const b = pieces[j]!.bbox;
      if (a[0] - pad <= b[2] && b[0] - pad <= a[2] && a[1] - pad <= b[3] && b[1] - pad <= a[3]) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const groups = new Map<number, Group>();
  pieces.forEach((piece, index) => {
    const root = find(index);
    const group = groups.get(root) ?? { pieces: [], area: 0, cx: 0, cy: 0 };
    group.pieces.push(piece);
    group.cx += piece.cx * piece.area;
    group.cy += piece.cy * piece.area;
    group.area += piece.area;
    groups.set(root, group);
  });
  return [...groups.values()]
    .map((group) => ({ ...group, cx: group.cx / group.area, cy: group.cy / group.area }))
    .sort((a, b) => b.area - a.area);
};

/** The slice of a queried feature this module reads (no GeoJSON typings dep). */
interface FeatureLike {
  geometry: { type: string; coordinates?: unknown };
}

const outerRings = (feature: FeatureLike): number[][][] => {
  const { type, coordinates } = feature.geometry;
  if (type === "Polygon") {
    const rings = coordinates as number[][][];
    return rings[0] ? [rings[0]] : [];
  }
  if (type === "MultiPolygon") {
    return (coordinates as number[][][][])
      .map((polygon) => polygon[0])
      .filter((ring): ring is number[][] => Boolean(ring));
  }
  return [];
};

const project = (lng: number, lat: number): [number, number] => {
  const clamped = Math.max(-85, Math.min(85, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
};

const unproject = (x: number, y: number): [number, number] => {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return [lng, lat];
};

/**
 * The unobscured part of the viewport in projected world units, or null when
 * the whole world is in view (low-zoom globe) and clipping would only cost.
 */
const visibleWindow = (map: MaplibreMap, insets: ViewInsets): [number, number, number, number] | null => {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const worldPx = 512 * 2 ** map.getZoom();
  if (worldPx < width * 1.1) return null;
  const center = map.getCenter();
  const [cx, cy] = project(center.lng, center.lat);
  const x0 = cx + (insets.left - width / 2) / worldPx;
  const x1 = cx + (width / 2 - insets.right) / worldPx;
  const y0 = cy + (insets.top - height / 2) / worldPx;
  const y1 = cy + (height / 2 - insets.bottom) / worldPx;
  if (x1 <= x0 || y1 <= y0) return null;
  return [x0, y0, x1, y1];
};

/** Sutherland–Hodgman clip of a closed ring against an axis-aligned rect. */
const clipToRect = (ring: number[][], [minX, minY, maxX, maxY]: [number, number, number, number]): number[][] => {
  let output = ring;
  const edges: Array<[(p: number[]) => boolean, (a: number[], b: number[]) => number[]]> = [
    [(p) => p[0]! >= minX, (a, b) => lerpAt(a, b, 0, minX)],
    [(p) => p[0]! <= maxX, (a, b) => lerpAt(a, b, 0, maxX)],
    [(p) => p[1]! >= minY, (a, b) => lerpAt(a, b, 1, minY)],
    [(p) => p[1]! <= maxY, (a, b) => lerpAt(a, b, 1, maxY)],
  ];
  for (const [inside, intersect] of edges) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const current = input[i]!;
      const previous = input[(i + input.length - 1) % input.length]!;
      if (inside(current)) {
        if (!inside(previous)) output.push(intersect(previous, current));
        output.push(current);
      } else if (inside(previous)) {
        output.push(intersect(previous, current));
      }
    }
  }
  if (output.length && output[0] !== output[output.length - 1]) output.push(output[0]!);
  return output;
};

const lerpAt = (a: number[], b: number[], axis: 0 | 1, value: number): number[] => {
  const t = (value - a[axis]!) / (b[axis]! - a[axis]! || 1e-12);
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
};

const toPiece = (projected: number[][]): Piece | null => {
  if (projected.length < 4) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
    const [xi, yi] = projected[i]!;
    const [xj, yj] = projected[j]!;
    const cross = xj! * yi! - xi! * yj!;
    area += cross;
    cx += (xi! + xj!) * cross;
    cy += (yi! + yj!) * cross;
  }
  if (Math.abs(area) < 1e-12) return null;
  cx /= 3 * area;
  cy /= 3 * area;
  const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of projected) {
    if (x! < bbox[0]) bbox[0] = x!;
    if (y! < bbox[1]) bbox[1] = y!;
    if (x! > bbox[2]) bbox[2] = x!;
    if (y! > bbox[3]) bbox[3] = y!;
  }
  return { ring: projected, area: Math.abs(area) / 2, cx, cy, bbox };
};

const pointInRing = (x: number, y: number, ring: number[][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
};

/** Squared distance from a point to the ring's edges. */
const edgeDistance = (x: number, y: number, ring: number[][]): number => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j]!;
    const [bx, by] = ring[i]!;
    const dx = bx! - ax!;
    const dy = by! - ay!;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax!) * dx + (y - ay!) * dy) / len)) : 0;
    const px = ax! + t * dx - x;
    const py = ay! + t * dy - y;
    best = Math.min(best, px * px + py * py);
  }
  return best;
};

/** Coarse-to-fine grid search for the interior point farthest from any edge. */
const poleOfInaccessibility = (ring: number[][]): [number, number] => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x!);
    minY = Math.min(minY, y!);
    maxX = Math.max(maxX, x!);
    maxY = Math.max(maxY, y!);
  }
  let best: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  let bestScore = pointInRing(best[0], best[1], ring) ? edgeDistance(best[0], best[1], ring) : -1;
  let spanX = maxX - minX;
  let spanY = maxY - minY;
  let cx = best[0];
  let cy = best[1];
  for (let pass = 0; pass < 3; pass++) {
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const x = cx - spanX / 2 + (spanX * i) / steps;
        const y = cy - spanY / 2 + (spanY * j) / steps;
        if (!pointInRing(x, y, ring)) continue;
        const score = edgeDistance(x, y, ring);
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
    cx = best[0];
    cy = best[1];
    spanX /= 4;
    spanY /= 4;
  }
  return best;
};

// ── text ──────────────────────────────────────────────────────────────────

const measurer = (font: LabelFont) => {
  const ctx = document.createElement("canvas").getContext("2d");
  return (text: string, size: number): number => {
    if (!ctx) return text.length * size * (0.62 + font.tracking);
    ctx.font = `${font.weight} ${size}px ${font.family}`;
    return ctx.measureText(text).width + font.tracking * size * Math.max(0, text.length - 1);
  };
};

const splitBalanced = (text: string): string[] => {
  const words = text.split(" ");
  let best = [text];
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = [a, b];
    }
  }
  return best;
};

const overlaps = (a: number[], b: number[]): boolean =>
  a[0]! < b[2]! && a[2]! > b[0]! && a[1]! < b[3]! && a[3]! > b[1]!;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
