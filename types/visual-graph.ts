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
export interface VisualScene {
  id: string;
  title: string;
  narration?: string;
  durationSec: number;
  transitionMs?: number;
  domainAt?: number;
  camera?: { focusNodeId?: NodeId; fitIds?: NodeId[]; zoom?: number };
  highlight?: { nodeIds?: NodeId[]; edgeIds?: string[]; groupId?: string };
  openDetailNodeId?: NodeId;
}
export interface VisualGraph {
  domain: string;
  meta: { title: string; description?: string; sourceNote?: string };
  timeline?: { unit: string; total?: number };
  nodes: VisualNode[];
  edges: VisualEdge[];
  groups: VisualGroup[];
  scenes: VisualScene[];
}
