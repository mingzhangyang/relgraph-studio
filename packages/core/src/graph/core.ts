/** Renderer-neutral, deterministic graph contract. Domain facts remain in source documents. */
import type {
  FrameScene,
  FrameState,
  ProjectedVisualGraph,
  ResolvedHighlight,
  ScenePlayback,
  VisualCamera,
  VisualEdge,
  VisualGraph,
  VisualNode,
  VisualScene,
} from '../../types/visual-graph.js';

// ':' is reserved for internal generated IDs; source-domain IDs must remain plain slugs.
const slug = /^[a-z0-9]+(?:[-:][a-z0-9]+)*$/;
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

type Collection = 'nodes' | 'edges' | 'groups' | 'scenes';
export interface GraphDiagnostic {
  level: 'error';
  layer: 'graph';
  code: string;
  path: string;
  // Invalid input may itself contain a non-string ID. Preserve it in diagnostics.
  id: unknown;
  message: string;
  fix: string;
}

/** Validate untrusted input before it is treated as a VisualGraph. */
export function validateVisualGraph(graph: unknown): { valid: boolean; errors: GraphDiagnostic[] } {
  const errors: GraphDiagnostic[] = [];
  const fail = (code: string, path: string, id: unknown, message: string, fix: string) =>
    errors.push({ level: 'error', layer: 'graph', code, path, id: id || '', message, fix });
  if (
    !object(graph) ||
    !object(graph.meta) ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    !Array.isArray(graph.groups) ||
    !Array.isArray(graph.scenes)
  ) {
    fail(
      'STRUCTURE',
      '$',
      '',
      'Expected meta, nodes, edges, groups and scenes',
      'Pass data through a domain adapter.',
    );
    return { valid: false, errors };
  }
  if (typeof graph.domain !== 'string' || !graph.domain.trim())
    fail(
      'GRAPH_DOMAIN',
      'domain',
      '',
      'Graph domain must be a non-empty string',
      'Provide a domain such as literature or biology.',
    );
  if (typeof graph.meta.title !== 'string' || !graph.meta.title.trim())
    fail(
      'GRAPH_TITLE',
      'meta.title',
      '',
      'Graph title must be a non-empty string',
      'Provide a descriptive graph title.',
    );

  const collections: Record<Collection, unknown[]> = {
    nodes: graph.nodes,
    edges: graph.edges,
    groups: graph.groups,
    scenes: graph.scenes,
  };
  const ids: Record<Collection, Set<unknown>> = {
    nodes: new Set(),
    edges: new Set(),
    groups: new Set(),
    scenes: new Set(),
  };
  for (const kind of ['nodes', 'edges', 'groups', 'scenes'] as const) {
    collections[kind].forEach((item, i) => {
      if (!object(item) || typeof item.id !== 'string' || !slug.test(item.id)) {
        // Optional property access also accepts malformed primitive entries.
        const id = (item as { id?: unknown } | null | undefined)?.id;
        fail(
          'ID',
          kind + '[' + i + '].id',
          id,
          'Invalid stable id',
          'Use lowercase letters, numbers and hyphens.',
        );
        return;
      }
      if (ids[kind].has(item.id))
        fail(
          'DUPLICATE_ID',
          kind + '[' + i + '].id',
          item.id,
          'Repeated id',
          'Use a unique stable id in this collection.',
        );
      ids[kind].add(item.id);
    });
  }
  function interval(v: unknown, path: string, id: unknown): void {
    if (v === undefined) return;
    if (
      !object(v) ||
      (v.from !== undefined && !finite(v.from)) ||
      (v.to !== undefined && !finite(v.to)) ||
      (v.from !== undefined && v.to !== undefined && (v.from as number) > (v.to as number))
    )
      fail(
        'INTERVAL',
        path,
        id,
        'Invalid visibility interval',
        'Provide finite from <= to, or omit it.',
      );
  }
  collections.nodes.forEach((n, i) => {
    if (!object(n) || !n.id) return;
    if (typeof n.label !== 'string' || !n.label.trim())
      fail(
        'LABEL',
        'nodes[' + i + '].label',
        n.id,
        'Node label required',
        'Provide a display label.',
      );
    if (typeof n.kind !== 'string' || !n.kind.trim())
      fail(
        'NODE_KIND',
        'nodes[' + i + '].kind',
        n.id,
        'Node kind is required',
        'Provide a non-empty node kind.',
      );
    if (n.groupId && !ids.groups.has(n.groupId))
      fail(
        'GROUP_REF',
        'nodes[' + i + '].groupId',
        n.id,
        'Missing group',
        'Use an existing group id.',
      );
    const position = n.position as { x?: unknown; y?: unknown } | undefined;
    if (position && (!finite(position.x) || !finite(position.y)))
      fail(
        'POSITION',
        'nodes[' + i + '].position',
        n.id,
        'Invalid coordinates',
        'Use finite numbers.',
      );
    interval(n.visibility, 'nodes[' + i + '].visibility', n.id);
  });
  collections.groups.forEach((g, i) => {
    if (!object(g) || !g.id) return;
    if (typeof g.label !== 'string' || !g.label.trim())
      fail(
        'GROUP_LABEL',
        'groups[' + i + '].label',
        g.id,
        'Group label is required',
        'Provide a non-empty group name.',
      );
    if (typeof g.kind !== 'string' || !g.kind.trim())
      fail(
        'GROUP_KIND',
        'groups[' + i + '].kind',
        g.id,
        'Group kind is required',
        'Provide a non-empty group kind.',
      );
  });
  collections.edges.forEach((e, i) => {
    if (!object(e) || !e.id) return;
    if (typeof e.kind !== 'string' || !e.kind.trim())
      fail(
        'EDGE_KIND',
        'edges[' + i + '].kind',
        e.id,
        'Edge kind is required',
        'Provide a non-empty relationship kind.',
      );
    if (!ids.nodes.has(e.source) || !ids.nodes.has(e.target))
      fail(
        'EDGE_REF',
        'edges[' + i + ']',
        e.id,
        'Missing source/target',
        'Reference existing node ids.',
      );
    interval(e.visibility, 'edges[' + i + '].visibility', e.id);
  });
  collections.scenes.forEach((s, i) => {
    if (!object(s) || !s.id) return;
    const path = 'scenes[' + i + ']';
    if (typeof s.title !== 'string' || !s.title.trim())
      fail(
        'SCENE_TITLE',
        path + '.title',
        s.id,
        'Scene title is required',
        'Provide a non-empty scene title.',
      );
    if (!finite(s.durationSec) || s.durationSec <= 0)
      fail('DURATION', path + '.durationSec', s.id, 'Invalid duration', 'Use positive seconds.');
    if (s.transitionMs !== undefined && (!finite(s.transitionMs) || s.transitionMs < 0))
      fail(
        'TRANSITION',
        path + '.transitionMs',
        s.id,
        'Invalid transition',
        'Use nonnegative milliseconds.',
      );
    if (s.domainAt !== undefined && !finite(s.domainAt))
      fail(
        'DOMAIN_TIME',
        path + '.domainAt',
        s.id,
        'Invalid domain time',
        'Use finite domain time, separate from playback seconds.',
      );
    if (s.camera !== undefined && !object(s.camera))
      fail(
        'SCENE_OBJECT_TYPE',
        path + '.camera',
        s.id,
        'camera must be an object',
        'Provide camera object or omit it.',
      );
    const camera = s.camera as Record<string, unknown> | null | undefined;
    if (camera?.zoom !== undefined && (!finite(camera.zoom) || camera.zoom <= 0))
      fail(
        'CAMERA_ZOOM',
        path + '.camera.zoom',
        s.id,
        'Camera zoom must be a positive finite number',
        'Provide a finite positive number or omit zoom.',
      );
    if (s.highlight !== undefined && !object(s.highlight))
      fail(
        'SCENE_OBJECT_TYPE',
        path + '.highlight',
        s.id,
        'highlight must be an object',
        'Provide highlight object or omit it.',
      );
    const highlight = s.highlight as Record<string, unknown> | null | undefined;
    if (camera?.focusNodeId && Array.isArray(camera.fitIds) && camera.fitIds.length)
      fail(
        'CAMERA_CONFLICT',
        path + '.camera',
        s.id,
        'Conflicting camera targets',
        'Choose focusNodeId or fitIds.',
      );
    const refs: [unknown, Set<unknown>, string][] = [
      [camera?.focusNodeId, ids.nodes, 'camera.focusNodeId'],
      [s.openDetailNodeId, ids.nodes, 'openDetailNodeId'],
      [highlight?.groupId, ids.groups, 'highlight.groupId'],
    ];
    for (const [v, set, field] of refs)
      if (v && !set.has(v))
        fail(
          'SCENE_REF',
          path + '.' + field,
          s.id,
          'Unknown ' + (v as string),
          'Use an existing id.',
        );
    const lists: [unknown, Set<unknown>, string][] = [
      [camera?.fitIds, ids.nodes, 'camera.fitIds'],
      [highlight?.nodeIds, ids.nodes, 'highlight.nodeIds'],
      [highlight?.edgeIds, ids.edges, 'highlight.edgeIds'],
    ];
    for (const [arr, set, field] of lists) {
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) {
        fail(
          'SCENE_LIST_TYPE',
          path + '.' + field,
          s.id,
          field + ' must be an array',
          'Provide an array of valid IDs or omit it.',
        );
        continue;
      }
      (arr as unknown[]).forEach((v, j) => {
        if (!set.has(v))
          fail(
            'SCENE_REF',
            path + '.' + field + '[' + j + ']',
            s.id,
            'Unknown ' + (v as string),
            'Use an existing id.',
          );
      });
    }
  });
  return { valid: errors.length === 0, errors };
}

const shown = (v: VisualNode | VisualEdge, at: number | null | undefined): boolean =>
  at === null ||
  at === undefined ||
  ((v.visibility?.from ?? -Infinity) <= at && (v.visibility?.to ?? Infinity) >= at);

/** Hidden groups and edges never leak future plot nodes. Does not mutate source. */
export function projectVisualGraph(
  graph: VisualGraph,
  domainAt: number | null = null,
): ProjectedVisualGraph {
  const nodes = graph.nodes.filter((n) => shown(n, domainAt)),
    ids = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && shown(e, domainAt),
  );
  const used = new Set(nodes.map((n) => n.groupId).filter(Boolean));
  return {
    domain: graph.domain,
    meta: { ...graph.meta },
    timeline: graph.timeline ? { ...graph.timeline } : undefined,
    nodes,
    edges,
    groups: graph.groups.filter((g) => used.has(g.id)),
  };
}

/** Absolute-time scene evaluation; deterministic for any arbitrary video frame. */
export function sceneAtSecond(graph: VisualGraph, second: number): ScenePlayback<VisualScene> {
  const scenes = graph.scenes;
  // Compensated prefix sums prevent cumulative drift across hundreds of decimal scenes.
  let totalSec = 0,
    correction = 0;
  const ends = scenes.map((scene) => {
    const adjusted = scene.durationSec - correction;
    const next = totalSec + adjusted;
    correction = next - totalSec - adjusted;
    totalSec = next;
    return totalSec;
  });
  if (!scenes.length)
    return {
      scene: null,
      index: -1,
      elapsedSec: 0,
      progress: 0,
      domainAt: null,
      totalSec: 0,
      startSec: 0,
    };
  const time = Math.max(0, Math.min(finite(second) ? second : 0, totalSec));
  let start = 0,
    domainAt: number | null = null;
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (s.domainAt !== undefined) domainAt = s.domainAt;
    const end = ends[i];
    // Decimal arithmetic can represent the 0.3s boundary as 0.30000000000000004.
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(time), Math.abs(end));
    if (time < end - tolerance || i === scenes.length - 1) {
      const elapsedSec = Math.max(0, Math.min(s.durationSec, time - start));
      return {
        scene: s,
        index: i,
        elapsedSec,
        progress: Math.max(0, Math.min(1, elapsedSec / s.durationSec)),
        domainAt,
        totalSec,
        startSec: start,
      };
    }
    start = end;
  }
  throw new Error('Unable to evaluate scene');
}

export function frameStateAt(graph: VisualGraph, frame: number, fps = 24): FrameState {
  if (!Number.isInteger(frame) || frame < 0 || !finite(fps) || fps <= 0)
    throw new RangeError('Invalid frame or fps');
  return frameStateAtSecond(graph, frame / fps);
}

/** Project and redact a known shot without scanning scene boundaries again.
 * This shared path keeps timeline compilation and random-access evaluation
 * equally spoiler-safe, even when a shot inherits its domain time.
 */
export function projectFrameScene(
  graph: VisualGraph,
  source: VisualScene | null,
  index: number,
  domainAt: number | null,
): Omit<FrameState, 'playback'> & { scene: FrameScene | null } {
  const view = projectVisualGraph(graph, domainAt);
  const s = source;
  if (!s)
    return {
      scene: null,
      view,
      overlay: null,
      highlight: { nodeIds: [], edgeIds: [], groupId: null },
      camera: {},
    };
  const ns = new Set(view.nodes.map((n) => n.id)),
    es = new Set(view.edges.map((e) => e.id)),
    gs = new Set(view.groups.map((g) => g.id));
  const only = (xs: unknown, set: Set<string>): string[] =>
    (Array.isArray(xs) ? (xs as unknown[]) : []).filter((id): id is string =>
      set.has(id as string),
    );
  const camera: VisualCamera = s.camera && object(s.camera) ? { ...s.camera } : {};
  if (camera.focusNodeId && !ns.has(camera.focusNodeId)) delete camera.focusNodeId;
  if (camera.fitIds) camera.fitIds = only(camera.fitIds, ns);
  const groupId = s.highlight?.groupId;
  const highlight: ResolvedHighlight = {
    nodeIds: only(s.highlight?.nodeIds, ns),
    edgeIds: only(s.highlight?.edgeIds, es),
    groupId: groupId !== undefined && gs.has(groupId) ? groupId : null,
  };
  const overlay =
    s.openDetailNodeId && ns.has(s.openDetailNodeId) ? { nodeId: s.openDetailNodeId } : null;
  const hiddenTarget = Boolean(
    (s.camera?.focusNodeId && !ns.has(s.camera.focusNodeId)) ||
    (Array.isArray(s.camera?.fitIds) && s.camera.fitIds.some((id) => !ns.has(id))) ||
    (Array.isArray(s.highlight?.nodeIds) && s.highlight.nodeIds.some((id) => !ns.has(id))) ||
    (Array.isArray(s.highlight?.edgeIds) && s.highlight.edgeIds.some((id) => !es.has(id))) ||
    (s.highlight?.groupId && !gs.has(s.highlight.groupId)) ||
    (s.openDetailNodeId && !ns.has(s.openDetailNodeId)),
  );
  // Do not return the original scene: its camera, highlights and detail target may
  // refer to characters or reactions which are not visible at this domain time.
  const scene = {
    id: hiddenTarget ? undefined : s.id,
    title: hiddenTarget ? `分镜 ${index + 1}（目标尚不可见）` : s.title,
    narration: hiddenTarget ? undefined : s.narration,
    durationSec: s.durationSec,
    transitionMs: s.transitionMs,
    domainAt: s.domainAt,
    camera,
    highlight,
    redacted: hiddenTarget,
    ...(overlay ? { openDetailNodeId: overlay.nodeId } : {}),
  };
  return { scene, view, camera, highlight, overlay };
}

/** Evaluate a spoiler-safe scene at any video second, including sub-frame shot boundaries. */
export function frameStateAtSecond(graph: VisualGraph, second: number): FrameState {
  const playback = sceneAtSecond(graph, second);
  const { scene, ...projected } = projectFrameScene(
    graph,
    playback.scene,
    playback.index,
    playback.domainAt,
  );
  return { ...projected, playback: { ...playback, scene } };
}
