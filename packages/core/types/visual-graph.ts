/** Internal presentation contract, not a replacement for domain exchange formats. */
export type NodeId = string;
export interface Visibility {
  from?: number;
  to?: number;
}
export interface VisualNode {
  id: NodeId;
  label: string;
  kind: string;
  groupId?: string | null;
  importance?: number;
  color?: string;
  position?: { x: number; y: number };
  pinned?: boolean;
  visibility?: Visibility;
}
export interface VisualEdge {
  id: string;
  source: NodeId;
  target: NodeId;
  kind: string;
  label?: string;
  directed?: boolean;
  strength?: number;
  polarity?: string;
  visibility?: Visibility;
}
export interface VisualGroup {
  id: string;
  label: string;
  kind: string;
  color?: string;
}
export interface VisualCamera {
  focusNodeId?: NodeId;
  fitIds?: NodeId[];
  zoom?: number;
}
export interface VisualHighlight {
  nodeIds?: NodeId[];
  edgeIds?: string[];
  groupId?: string;
}
export interface VisualScene {
  id: string;
  title: string;
  narration?: string;
  durationSec: number;
  transitionMs?: number;
  domainAt?: number;
  camera?: VisualCamera;
  highlight?: VisualHighlight;
  openDetailNodeId?: NodeId;
}
export interface VisualGraph {
  project?: import('../src/project.js').ProjectConfig;
  domain: string;
  meta: { title: string; description?: string; sourceNote?: string };
  timeline?: { unit: string; total?: number };
  nodes: VisualNode[];
  edges: VisualEdge[];
  groups: VisualGroup[];
  scenes: VisualScene[];
}

/** A projection contains only the currently visible graph objects. */
export type ProjectedVisualGraph = Omit<VisualGraph, 'scenes'>;

export interface ResolvedHighlight {
  nodeIds: NodeId[];
  edgeIds: string[];
  groupId: string | null;
}

/** Frame scenes may redact their identity and prose when a target is hidden. */
export interface FrameScene {
  id?: string;
  title: string;
  narration?: string;
  durationSec: number;
  transitionMs?: number;
  domainAt?: number;
  camera: VisualCamera;
  highlight: ResolvedHighlight;
  redacted: boolean;
  openDetailNodeId?: NodeId;
}

export interface ScenePlayback<TScene> {
  scene: TScene | null;
  index: number;
  elapsedSec: number;
  progress: number;
  domainAt: number | null;
  totalSec: number;
  startSec: number;
}

export interface FrameState {
  playback: ScenePlayback<FrameScene>;
  view: ProjectedVisualGraph;
  camera: VisualCamera;
  highlight: ResolvedHighlight;
  overlay: { nodeId: NodeId } | null;
}

export interface DirectorFrameState extends FrameState {
  cameraResolved: { x: number; y: number; scale: number };
  transition: number;
  previousHighlight: ResolvedHighlight;
  reveal: FrameReveal;
  /** Opacity of the current shot title and narration, 0–1. */
  captionOpacity: number;
}

/** Deterministic reveal progress, evaluated from a compiled timeline and frame index. */
export interface FrameReveal {
  nodes: Record<string, number>;
  edges: Record<string, number>;
}
