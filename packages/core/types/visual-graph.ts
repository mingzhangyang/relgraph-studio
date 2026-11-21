/** Internal presentation contract, not a replacement for domain exchange formats. */
export type NodeId = string;
/**
 * One piece of source evidence for a node or relation (ADR 004, D4), mapped
 * by each domain adapter from its own evidence shape. Text is shown exactly
 * as written: never paraphrased, translated or overridden by display copy.
 * At least one of `cite` and `quote` is present.
 */
export interface VisualEvidence {
  /** The work or record cited, e.g. `王维《送孟六归襄阳》`. */
  cite?: string;
  /** Verbatim source text. */
  quote?: string;
  url?: string;
  /** Where in the work: a page, chapter or record id. */
  locator?: string;
  /**
   * Domain time from which the item may be shown (a literary quotation's
   * chapter). Earlier shots withhold it, as they withhold future objects.
   */
  from?: number;
}
/** Which evidence a shot shows on a card: one node's or one relation's. */
export interface VisualEvidenceRef {
  nodeId?: NodeId;
  edgeId?: string;
  /** Indices into the object's `evidence`; all items when omitted. */
  items?: number[];
}
/** A shot's evidence card after projection: only items the shot may show. */
export interface EvidenceCard {
  object: 'node' | 'edge';
  id: string;
  /** The items in the order the shot names them, each with its index in the object's evidence. */
  items: (VisualEvidence & { index: number })[];
}
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
  evidence?: VisualEvidence[];
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
  evidence?: VisualEvidence[];
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
  /** An evidence card for one node or relation (ADR 004, D4). */
  evidence?: VisualEvidenceRef;
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

/**
 * The ids a source document gives its objects, by the internal id the graph
 * uses (internal id → authored id). A generic graph maps names, CJK text and
 * other ids that are not lowercase slugs to hashes; exports that people read
 * against their own file (`relgraph.events/1`) write the authored ids back.
 * An object missing from a map has no authored id of its own (a relation or
 * shot the author left unnamed) and keeps its internal one.
 */
export interface AuthoredIds {
  nodes: ReadonlyMap<string, string>;
  edges: ReadonlyMap<string, string>;
  groups: ReadonlyMap<string, string>;
  scenes: ReadonlyMap<string, string>;
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
  /** The shot's evidence card, when its object and items are projected. */
  evidence: EvidenceCard | null;
}

export interface DirectorFrameState extends FrameState {
  cameraResolved: { x: number; y: number; scale: number };
  transition: number;
  previousHighlight: ResolvedHighlight;
  reveal: FrameReveal;
  /** Opacity of the current shot title and narration, 0–1. */
  captionOpacity: number;
  /**
   * Opacity of the shot's evidence card, 0–1: it fades in once the camera has
   * stopped and its object is half revealed (`evidenceShownSec`).
   */
  evidenceOpacity: number;
}

/** Deterministic reveal progress, evaluated from a compiled timeline and frame index. */
export interface FrameReveal {
  nodes: Record<string, number>;
  edges: Record<string, number>;
}
