// A deterministic synthetic generic graph for cost and scaling checks: six
// groups, three node kinds, three relation kinds, saved coordinates on a
// jittered grid, mostly local relations and a few self-relations.

/**
 * @param {number} nodes
 * @param {number} relations
 * @param {{ loops?: number, seed?: number }} [options]
 */
export function syntheticGraph(nodes, relations, { loops = 0, seed = 1 } = {}) {
  let state = seed >>> 0;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const groups = ['g0', 'g1', 'g2', 'g3', 'g4', 'g5'];
  const side = Math.ceil(Math.sqrt(nodes));
  const list = Array.from({ length: nodes }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    kind: ['a', 'b', 'c'][i % 3],
    group: groups[i % 6],
    position: {
      x: (i % side) * 90 + random() * 30,
      y: Math.floor(i / side) * 90 + random() * 30,
    },
  }));
  const edges = [];
  while (edges.length < relations) {
    const a = Math.floor(random() * nodes);
    const b =
      random() < 0.8 ? (a + 1 + Math.floor(random() * 12)) % nodes : Math.floor(random() * nodes);
    if (a !== b)
      edges.push({
        id: `e${edges.length}`,
        source: `n${a}`,
        target: `n${b}`,
        kind: ['r', 's', 't'][edges.length % 3],
      });
  }
  for (let i = 0; i < loops; i++)
    edges.push({
      id: `l${i}`,
      source: `n${(i * 7) % nodes}`,
      target: `n${(i * 7) % nodes}`,
      kind: 'r',
    });
  return {
    format: 'relgraph.graph/1',
    meta: { title: `Synthetic graph of ${nodes} nodes` },
    directed: true,
    kinds: {
      nodes: { a: { label: 'A' }, b: { label: 'B' }, c: { label: 'C' } },
      edges: { r: { label: 'R' }, s: { label: 'S', line: 'dashed' }, t: { label: 'T' } },
    },
    groups: groups.map((id) => ({ id, label: id.toUpperCase() })),
    nodes: list,
    edges,
    // Every highlight form: none, a group, named nodes with an open card, named relations.
    presentation: [
      { id: 'all', title: 'All', durationSec: 2 },
      { id: 'group', title: 'Group', durationSec: 2, highlight: { groupId: 'g2' } },
      {
        id: 'nodes',
        title: 'Nodes',
        durationSec: 2,
        highlight: { nodeIds: ['n1', 'n2', 'n3'] },
        openDetailNodeId: 'n1',
      },
      { id: 'edges', title: 'Relations', durationSec: 2, highlight: { edgeIds: ['e0', 'e1'] } },
    ],
  };
}
