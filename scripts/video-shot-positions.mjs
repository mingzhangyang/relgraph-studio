// A recipe fills missing coordinates; it must not undo a saved Studio layout.
export function applyRecipePositions(panel, positions, recipePositions, authoredIds) {
  const stored = panel.project?.layout?.positions ?? {};
  for (const node of panel.nodes) {
    if (node.position || Object.hasOwn(stored, node.id)) continue;
    const name = authoredIds?.nodes.get(node.id) ?? node.id;
    const point = recipePositions?.[name];
    if (point) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new Error('Invalid position for ' + name);
      positions.set(node.id, point);
    }
  }
  return positions;
}
