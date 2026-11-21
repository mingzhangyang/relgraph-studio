import { frameStateAt } from '../graph/core.js';
import {
  captionOpacity,
  compileTimeline,
  evidenceOpacity,
  revealStateAt,
  timelinePlaybackAt,
} from './timeline.js';
import type { FilmTimeline } from './timeline.js';
// Defined beside compileTimeline, which needs it to tell which shots have frames.
export { frameCount } from './timeline.js';
import type {
  DirectorFrameState,
  EvidenceCard,
  FrameState,
  ProjectedVisualGraph,
  ResolvedHighlight,
  VisualCamera,
  VisualGraph,
} from '../../types/visual-graph.js';

type Position = { x: number; y: number };

/**
 * Half extents of the area the camera frames nodes into, in reference pixels
 * of the 1280×720 design (renderers multiply by their frame's type scale).
 * Core stays independent of the renderer's FrameSpec and receives only this.
 */
// Available in every supported runtime (Node 20+, browsers); core builds
// against ES2022 alone, whose library has no declaration for it.
declare function structuredClone<T>(value: T): T;

export interface CameraFit {
  halfWidth: number;
  halfHeight: number;
  /**
   * The part of the area left free while an evidence card holds the rest
   * (ADR 004, D4): its half extents and its centre's offset from the whole
   * area's centre, in the same reference pixels. Without it a card shot is
   * framed like any other.
   */
  card?: { halfWidth: number; halfHeight: number; offsetX: number; offsetY: number };
}
export interface DirectorFrameOptions {
  fit?: CameraFit;
  /** A compiled timeline reused for random-access frames; never mutated. */
  timeline?: FilmTimeline;
}
export const DEFAULT_CAMERA_FIT: Readonly<CameraFit> = Object.freeze({
  halfWidth: 550,
  halfHeight: 195,
  // The landscape card region: the right 370 of the 1100 × 390 area plus its
  // 10-pixel overhang, with a 20-pixel gap to the graph (cameraFitFor).
  card: Object.freeze({ halfWidth: 360, halfHeight: 195, offsetX: -190, offsetY: 0 }),
});

const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n));
const ease = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

/**
 * Room, in reference pixels, kept between an evidence card's node or relation
 * ends and the edge of the area the card leaves free: a glyph's radius and
 * its outline, as the focus framing keeps for highlighted nodes.
 */
const CARD_END_MARGIN = Object.freeze({ x: 40, y: 35 });

/**
 * The nodes an evidence card is about, among those in view: its node, or its
 * relation's two ends. The camera keeps them in the area the card leaves free.
 */
function cardEnds(view: ProjectedVisualGraph, card: EvidenceCard | null): string[] {
  if (!card) return [];
  if (card.object === 'node') return [card.id];
  const edge = view.edges.find((e) => e.id === card.id);
  return edge ? [...new Set([edge.source, edge.target])] : [];
}

function cameraFor(
  view: ProjectedVisualGraph,
  spec: VisualCamera,
  positions: ReadonlyMap<string, Position>,
  highlight: ResolvedHighlight,
  fullFit: CameraFit,
  card: EvidenceCard | null = null,
): { x: number; y: number; scale: number } {
  const visible = new Set(view.nodes.map((node) => node.id));
  const ends = cardEnds(view, card).filter((id) => visible.has(id));
  // A card takes part of the area: frame into what it leaves free.
  const area = (card && fullFit.card) || { ...fullFit, offsetX: 0, offsetY: 0 };
  const fit = { halfWidth: area.halfWidth, halfHeight: area.halfHeight };
  const requested = spec.focusNodeId ? [spec.focusNodeId] : spec.fitIds || [];
  const selected = requested.filter((id) => visible.has(id));
  // A framing of chosen nodes also frames the card's object.
  if (selected.length && !spec.focusNodeId)
    for (const id of ends) if (!selected.includes(id)) selected.push(id);
  const ids = selected.length ? selected : view.nodes.map((node) => node.id);
  const points = ids.map((id) => positions.get(id)).filter((p): p is Position => Boolean(p));
  if (!points.length) return { x: 0, y: 0, scale: 1 };
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  // The fit extents describe the frame's graph safe area.
  // Single-node shots include context instead of zooming into a microscopic point.
  // Half-spans avoid overflow for valid, very large finite coordinates.
  const halfWidth = Math.max(selected.length === 1 ? 350 : 140, maxX / 2 - minX / 2 + 125);
  const halfHeight = Math.max(selected.length === 1 ? 225 : 110, maxY / 2 - minY / 2 + 90);
  const x = minX / 2 + maxX / 2,
    y = minY / 2 + maxY / 2;
  let scale = Math.min(fit.halfWidth / halfWidth, fit.halfHeight / halfHeight) * (spec.zoom || 1);
  // A focus shot should not clip other explicitly highlighted nodes. Preserve
  // its center and reduce zoom only as much as the safe area requires.
  if (spec.focusNodeId && selected.length) {
    const focused = [...(highlight?.nodeIds || []), ...ends]
      .filter((id) => visible.has(id))
      .map((id) => positions.get(id))
      .filter((p): p is Position => Boolean(p));
    if (focused.length) {
      const halfDx = Math.max(...focused.map((p) => Math.abs(p.x / 2 - x / 2))),
        halfDy = Math.max(...focused.map((p) => Math.abs(p.y / 2 - y / 2)));
      scale = Math.min(
        scale,
        fit.halfWidth / 2 / (halfDx + 40),
        fit.halfHeight / 2 / (halfDy + 35),
      );
    }
  }
  // Whatever the shot's zoom, the card's node or relation ends stay inside
  // the area the card leaves free, with room for their glyphs: an authored
  // zoom may not push them under the card.
  if (ends.length) {
    const points = ends.map((id) => positions.get(id)).filter((p): p is Position => Boolean(p));
    const halfDx = Math.max(0, ...points.map((p) => Math.abs(p.x / 2 - x / 2))),
      halfDy = Math.max(0, ...points.map((p) => Math.abs(p.y / 2 - y / 2)));
    if (halfDx > 0) scale = Math.min(scale, (fit.halfWidth - CARD_END_MARGIN.x) / 2 / halfDx);
    if (halfDy > 0) scale = Math.min(scale, (fit.halfHeight - CARD_END_MARGIN.y) / 2 / halfDy);
  }
  // Do not clamp away a necessary zoom-out for widely separated coordinates.
  const clamped = clamp(scale, Number.MIN_VALUE, 1.6);
  // The camera centre is the whole area's centre: shift it so the framed
  // nodes sit in the centre of the part the card leaves free.
  const shifted = (centre: number, offset: number): number => {
    if (!offset) return centre;
    const value = centre - offset / clamped;
    return Number.isFinite(value) ? value : centre;
  };
  return { x: shifted(x, area.offsetX), y: shifted(y, area.offsetY), scale: clamped };
}

/** Every value comes from the requested frame and its compiled, projected tracks. */
export function directorFrameAt(
  graph: VisualGraph,
  positions: ReadonlyMap<string, Position>,
  frame: number,
  fps = 24,
  { fit = DEFAULT_CAMERA_FIT, timeline: suppliedTimeline }: DirectorFrameOptions = {},
): DirectorFrameState {
  if (!Number.isInteger(frame) || frame < 0 || !Number.isFinite(fps) || fps <= 0)
    throw new RangeError('Invalid frame or fps');
  const timeline = suppliedTimeline ?? compileTimeline(graph, fps);
  if (timeline.fps !== fps) throw new RangeError('Timeline FPS mismatch');
  const playback = timelinePlaybackAt(timeline, frame / fps);
  const shot = timeline.shots[playback.index];
  // Empty graphs have no authored presentation, but retain the legacy
  // renderer-neutral projection behavior.
  const fallback = shot ? null : frameStateAt(graph, frame, fps);
  const view = shot?.view ?? fallback?.view;
  if (!view) throw new Error('Unable to resolve frame projection');
  const cameraSpec = timeline.camera[playback.index]?.value ?? fallback?.camera ?? {};
  const highlight = timeline.highlight[playback.index]?.value ??
    fallback?.highlight ?? {
      nodeIds: [],
      edgeIds: [],
      groupId: null,
    };
  const state: FrameState = {
    playback,
    view,
    camera: cameraSpec,
    highlight,
    overlay: shot?.overlay ?? fallback?.overlay ?? null,
    evidence: shot?.evidence ?? null,
  };
  const target = cameraFor(view, cameraSpec, positions, highlight, fit, state.evidence);
  let camera = target,
    transition = 1;
  let previousHighlight: ResolvedHighlight = { nodeIds: [], edgeIds: [], groupId: null };
  if (playback.index > 0 && playback.scene) {
    // The previous target is restricted to CURRENT visible IDs, so a domain
    // time reversal never targets or highlights a now-hidden future object.
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(playback.startSec));
    const previousFrame = Math.max(
      0,
      Math.min(frame - 1, Math.ceil((playback.startSec - tolerance) * fps) - 1),
    );
    const previousPlayback = timelinePlaybackAt(timeline, previousFrame / fps);
    const previousShot = timeline.shots[previousPlayback.index];
    if (!previousShot) throw new Error('Missing previous compiled shot');
    const nodeIds = new Set(view.nodes.map((node) => node.id)),
      edgeIds = new Set(view.edges.map((edge) => edge.id)),
      groupIds = new Set(view.groups.map((group) => group.id));
    const priorHighlight = timeline.highlight[previousPlayback.index].value;
    const previousGroupId = priorHighlight.groupId;
    previousHighlight = {
      nodeIds: priorHighlight.nodeIds.filter((id) => nodeIds.has(id)),
      edgeIds: priorHighlight.edgeIds.filter((id) => edgeIds.has(id)),
      groupId: previousGroupId !== null && groupIds.has(previousGroupId) ? previousGroupId : null,
    };
    const previousView = {
      ...previousShot.view,
      nodes: previousShot.view.nodes.filter((node) => nodeIds.has(node.id)),
      edges: previousShot.view.edges.filter((edge) => edgeIds.has(edge.id)),
      groups: previousShot.view.groups.filter((group) => groupIds.has(group.id)),
    };
    const from = cameraFor(
      previousView,
      timeline.camera[previousPlayback.index].value,
      positions,
      previousHighlight,
      fit,
      previousShot.evidence,
    );
    const duration = timeline.camera[playback.index].transitionSec;
    transition = duration <= 0 ? 1 : ease(playback.elapsedSec / duration);
    camera = {
      x: mix(from.x, target.x, transition),
      y: mix(from.y, target.y, transition),
      scale: mix(from.scale, target.scale, transition),
    };
  }
  const second = frame / fps;
  // The scene, projection, camera and highlight come from the (possibly
  // caller-supplied, reused) timeline. Return a copy so editing a returned
  // state can never change a later frame.
  return structuredClone({
    ...state,
    cameraResolved: camera,
    transition,
    previousHighlight,
    reveal: revealStateAt(timeline, view, second),
    captionOpacity: captionOpacity(timeline, playback.index, second),
    evidenceOpacity: state.evidence ? evidenceOpacity(timeline, playback.index, second) : 0,
  });
}
