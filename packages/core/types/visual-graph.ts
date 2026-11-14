/** Internal presentation contract, not a replacement for domain exchange formats. */
export type NodeId = string;
/** When an object exists in domain time: dates, never reveal order. */
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
  /** Categorical palette slot used when the node has no authored colour. */
  tone?: number;
  /**
   * The node's own extent in domain time, drawn as a bar on a timeline. Unlike
   * `visibility` it never hides the node: what has ended stays on screen.
   */
  span?: { from: number; to?: number };
  /**
   * The step of an unfolding at which the node appears: reveal order, not
   * domain time (`visibility`). Nothing presents it as a date.
   */
  revealStep?: number;
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
  /** The step of an unfolding at which the relation appears; see `VisualNode.revealStep`. */
  revealStep?: number;
}
export interface VisualGroup {
  id: string;
  label: string;
  kind: string;
  color?: string;
  /** Categorical palette slot used when the group has no authored colour. */
  tone?: number;
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
  /**
   * The unfolding step this shot shows: objects with a later `revealStep` are
   * not yet projected. Inherited by later shots, like `domainAt`, and
   * independent of it.
   */
  revealStep?: number;
  camera?: VisualCamera;
  highlight?: VisualHighlight;
  openDetailNodeId?: NodeId;
}
export interface VisualGraph {
  project?: import('../src/project.js').ProjectConfig;
  domain: string;
  meta: { title: string; description?: string; sourceNote?: string };
  /** The unit of domain time, as authored. Reveal order has no unit. */
  timeline?: {
    unit: string;
    total?: number;
  };
  /**
   * False when the source of a timeline declares that its coordinates are not
   * on the time axis (`"timeAxis": false`); see `timeAnchor`.
   */
  timeAxis?: false;
  /** What kind of picture the graph is; selects layout, routing and labelling. */
  diagram?: import('../src/style.js').DiagramKind;
  /** Presentation declared per kind by a generic graph document. */
  kinds?: import('../src/style.js').GraphKinds;
  nodes: VisualNode[];
  edges: VisualEdge[];
  groups: VisualGroup[];
  scenes: VisualScene[];
}

/** A projection contains only the currently visible graph objects. */
export type ProjectedVisualGraph = Omit<VisualGraph, 'scenes' | 'project' | 'kinds' | 'diagram'>;

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
  revealStep?: number;
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
  /** The unfolding step in effect, or null when no shot has set one: everything is revealed. */
  revealStep: number | null;
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
