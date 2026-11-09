import type { OverlayProjection } from './selection-overlay-model.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Only draws on the transparent, pointer-inert workspace overlay. The film
 * Canvas, its DisplayList and native export code never receive these elements.
 */
export function createSelectionOverlayView(
  doc: Document,
  svg: SVGSVGElement,
  note: HTMLElement,
) {
  let previous = '';
  const element = (name: string): SVGElement => doc.createElementNS(NS, name);

  function render(projection: OverlayProjection): void {
    const signature = JSON.stringify(projection);
    if (previous === signature) return;
    previous = signature;
    svg.setAttribute('viewBox', `0 0 ${projection.width} ${projection.height}`);

    const defs = element('defs');
    const clipPath = element('clipPath');
    clipPath.setAttribute('id', 'studioSelectionClip');
    const rect = element('rect');
    for (const [name, value] of Object.entries(projection.clip)) {
      rect.setAttribute(name === 'w' ? 'width' : name === 'h' ? 'height' : name, String(value));
    }
    clipPath.append(rect);
    defs.append(clipPath);

    const group = element('g');
    group.setAttribute('clip-path', 'url(#studioSelectionClip)');
    for (const { hit, selected } of projection.targets) {
      const shape = element(hit.box ? 'rect' : 'polyline');
      shape.setAttribute(
        'class',
        selected ? 'selection-target selected' : 'selection-target affected',
      );
      if (hit.box) {
        shape.setAttribute('x', String(hit.box.x));
        shape.setAttribute('y', String(hit.box.y));
        shape.setAttribute('width', String(hit.box.w));
        shape.setAttribute('height', String(hit.box.h));
        shape.setAttribute('rx', '4');
      } else if (hit.points) {
        shape.setAttribute('points', hit.points.map((p) => `${p.x},${p.y}`).join(' '));
      }
      group.append(shape);
    }
    svg.replaceChildren(defs, group);
    if (note.textContent !== projection.message) note.textContent = projection.message;
    note.setAttribute('data-affected', String(projection.affectedCount));
    note.setAttribute('data-outlined', String(projection.targets.length));
  }

  return { render };
}
