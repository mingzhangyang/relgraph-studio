import type { CameraFit, DomainStyle, ProjectConfig, VisualGraph } from '@relgraph/core';
import { cameraFitFor, type FrameSpec } from './frame-spec.js';
import { nodeGlyphBounds } from './node-geometry.js';

/**
 * The camera fit of a frame spec for one graph (ADR 004, D4): `cameraFitFor`
 * plus each node's drawn half extents, so a card shot frames the card's node
 * or relation ends clear of the card by their outlines. Label-holding shapes
 * are as wide as their words; compact shapes grow with the camera scale.
 * `style` is read on each call: the drawing's style follows its positions.
 */
export function evidenceCameraFit(
  spec: FrameSpec,
  graph: Pick<VisualGraph, 'nodes' | 'project'>,
  style: () => DomainStyle,
  config: ProjectConfig | undefined = graph.project,
): CameraFit {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return {
    ...cameraFitFor(spec),
    glyphExtent(id, cameraScale) {
      const node = nodes.get(id);
      if (!node) return { halfWidth: 0, halfHeight: 0 };
      const box = nodeGlyphBounds(node, { x: 0, y: 0 }, cameraScale, spec, style(), 1, config);
      return { halfWidth: box.w / 2 / spec.typeScale, halfHeight: box.h / 2 / spec.typeScale };
    },
  };
}
