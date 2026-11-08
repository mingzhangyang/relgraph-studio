import { test } from 'vitest';
import assert from 'node:assert/strict';
import { DEFAULT_FRAME_SPEC } from '../packages/render/src/frame-spec.ts';
import { screenPosition } from '../apps/studio/src/position-tool.ts';
import {
  editableNodes,
  layoutHasChanges,
  parseCoordinateInputs,
  positionForDrag,
  restoreLayoutPositions,
  startPositionDrag,
  updateEditableNodePosition,
} from '../apps/studio/src/layout-editor-model.ts';

const model = () => {
  const nodes = [
    { id: 'early', label: 'Early', kind: 'person' },
    { id: 'future', label: 'SECRET FUTURE', kind: 'person' },
    { id: 'partial', label: 'Partial', kind: 'person' },
  ];
  const positions = new Map(nodes.map((n, i) => [n.id, { x: i * 180, y: i * 60 }]));
  const frame = {
    view: { nodes, edges: [], groups: [] },
    reveal: { nodes: { early: 1, future: 0, partial: 0.5 }, edges: {} },
    cameraResolved: { x: 0, y: 0, scale: 1 },
  };
  return { frame, positions };
};

test('pure policy excludes unrevealed nodes from both keyboard and drag paths', () => {
  const { frame, positions } = model();
  assert.deepEqual(editableNodes(frame, positions).map(n => n.id), ['early']);
  assert.equal(updateEditableNodePosition(positions, frame, 'future', { x: 77, y: 77 }), false);
  assert.equal(updateEditableNodePosition(positions, frame, 'partial', { x: 77, y: 77 }), false);
  assert.equal(positions.get('future').x, 180);
  const hidden = screenPosition(positions.get('future'), frame.cameraResolved, DEFAULT_FRAME_SPEC);
  assert.equal(startPositionDrag(frame, positions, DEFAULT_FRAME_SPEC, hidden, 20, 5), null);
  assert.equal(updateEditableNodePosition(positions, frame, 'early', { x: 77, y: 77 }), true);
});

test('drag mathematics preserves grab offset and rejects invalid or overflowing positions', () => {
  const { frame, positions } = model();
  const center = screenPosition(positions.get('early'), frame.cameraResolved, DEFAULT_FRAME_SPEC);
  const start = { x: center.x + 8, y: center.y - 5 };
  const drag = startPositionDrag(frame, positions, DEFAULT_FRAME_SPEC, start, 24, 1);
  assert.equal(drag.id, 'early');
  assert.deepEqual(positionForDrag(drag, start, frame.cameraResolved, DEFAULT_FRAME_SPEC), { x: 0, y: 0 });
  assert.deepEqual(
    positionForDrag(drag, { x: start.x + 40, y: start.y - 24 }, frame.cameraResolved, DEFAULT_FRAME_SPEC),
    { x: 40, y: -24 },
  );
  assert.equal(positionForDrag(drag, { x: Infinity, y: start.y }, frame.cameraResolved, DEFAULT_FRAME_SPEC), null);
  assert.equal(positionForDrag(drag, start, { ...frame.cameraResolved, scale: 0 }, DEFAULT_FRAME_SPEC), null);
  const extreme = { ...drag, previous: { x: 1e307, y: 0 } };
  assert.deepEqual(positionForDrag(extreme, start, frame.cameraResolved, DEFAULT_FRAME_SPEC), { x: 1e307, y: 0 });
});

test('pure validation and reset do not depend on DOM or browser stubs', () => {
  const { frame, positions } = model();
  const initial = new Map([...positions].map(([id, p]) => [id, { ...p }]));
  for (const values of [['', '1'], ['Infinity', '2'], ['2', 'NaN'], ['1', '']])
    assert.equal(parseCoordinateInputs(...values), null);
  assert.deepEqual(parseCoordinateInputs('1.25', '-4'), { x: 1.25, y: -4 });
  assert.equal(updateEditableNodePosition(positions, frame, 'early', { x: 1.25, y: -4 }), true);
  assert.equal(layoutHasChanges(positions, initial), true);
  restoreLayoutPositions(positions, initial);
  assert.equal(layoutHasChanges(positions, initial), false);
  assert.notEqual(positions.get('early'), initial.get('early'), 'restored data must be cloned');
});
