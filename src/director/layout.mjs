/** Stable layout prepared once per document, never advanced by playback. */
export function layoutGraph(graph) {
  const positions=new Map();
  for (const node of graph.nodes) if (node.position) positions.set(node.id,{...node.position});
  // Place implicit reaction nodes between their positioned inputs and outputs.
  // Catalyst position does not pull a process away from the reaction flow.
  for (const node of graph.nodes) {
    if (positions.has(node.id) || node.kind!=='reaction') continue;
    const neighbors=graph.edges.filter(edge=>edge.kind==='consumption'&&edge.target===node.id || edge.kind==='production'&&edge.source===node.id)
      .map(edge=>positions.get(edge.source===node.id?edge.target:edge.source)).filter(Boolean);
    if (neighbors.length) positions.set(node.id,{x:neighbors.reduce((sum,p)=>sum+p.x,0)/neighbors.length,y:neighbors.reduce((sum,p)=>sum+p.y,0)/neighbors.length});
  }
  const existing=[...positions.values()];
  const originX=existing.length?Math.max(...existing.map(p=>p.x))+150:0;
  const originY=existing.length?Math.min(...existing.map(p=>p.y)):0;
  let missing=0;
  for (const node of graph.nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id,{x:originX+(missing%4)*150,y:originY+Math.floor(missing/4)*110});
      missing++;
    }
  }
  return positions;
}
