import {
  listed,
  wording,
  type DiagnosticCatalogue,
  type DiagnosticParam,
  type DiagnosticWording,
} from '@relgraph/core';

const allowed = (value: DiagnosticParam | undefined) => `Allowed: ${listed(value, ', ')}.`;
const plural = (count: DiagnosticParam | undefined, one: string, many: string) =>
  String(count) === '1' ? one : many;

/** Diagnostics the workspace itself writes: an example or file it could not read. */
export const WORKSPACE_WORDING = {
  LOAD: wording(
    (p) => `无法读取示例：${p.detail}`,
    '从仓库根目录运行 npm run dev 或 npm run preview 后重新打开工作台。',
  ),
  FILE: wording((p) => `无法读取文件：${p.detail}`, '请选择可读取的 JSON 文件。'),
} as const satisfies Record<string, DiagnosticWording>;

type EnglishCatalogue = DiagnosticCatalogue & {
  readonly studio: Readonly<Record<keyof typeof WORKSPACE_WORDING, DiagnosticWording>>;
};

/**
 * English wording of every diagnostic core words, by layer and key (see
 * DIAGNOSTIC_WORDING in core), and of the workspace's own. The type requires
 * an entry for each key, so a new key fails typecheck until it is worded here.
 */
export const ENGLISH_DIAGNOSTICS: EnglishCatalogue = {
  structure: {
    'BROKEN_REF.rule': wording('Schema rule is invalid', 'Fix the schema.'),
    'BROKEN_REF.ref': wording((p) => `Schema reference ${p.ref} is invalid`, 'Fix the schema.'),
    'UNSUPPORTED_SCHEMA.keyword': wording(
      (p) => `Unsupported schema keyword ${p.keyword}`,
      'Update the schema validator.',
    ),
    'UNSUPPORTED_SCHEMA.rule': wording('Unsupported schema rule', 'Update the schema validator.'),
    'UNSUPPORTED_SCHEMA.siblings': wording(
      'Schema reference has unsupported siblings',
      'Update the schema validator.',
    ),
    TYPE: wording((p) => `Expected ${p.type}`, 'Correct the field type.'),
    VERSION: wording(
      (p) => `Unsupported schemaVersion ${p.value}; supported: 0.1`,
      'Use version 0.1 data or upgrade the player.',
    ),
    ENUM: wording((p) => `Invalid value ${p.value}`, 'Use an allowed enum value.'),
    PATTERN: wording(
      (p) => `Invalid value ${p.value}`,
      'Use lowercase ASCII, digits, and hyphens for IDs; use #RRGGBB colors.',
    ),
    MIN: wording((p) => `Must be >= ${p.minimum}`, 'Increase the value.'),
    MAX: wording((p) => `Must be <= ${p.maximum}`, 'Decrease the value.'),
    ARRAY_SIZE: wording(
      (p) => `Expected at least ${p.minItems} item(s)`,
      'Add the required array items.',
    ),
    REQUIRED: wording((p) => `Missing required property ${p.property}`, 'Add the required fields.'),
    UNKNOWN_FIELD: wording(
      (p) => `Unknown property ${p.property}`,
      'Move it to an allowed extra object or remove it.',
    ),
  },
  semantic: {
    DUPLICATE_ID: wording((p) => `Duplicate id: ${p.id}`, 'Use an unused stable ID.'),
    TIME_RANGE: wording(
      (p) => `Time point ${p.value} outside [1, ${p.limit}]`,
      'Use a valid time point.',
    ),
    UNKNOWN_FACTION: wording(
      (p) => `Unknown faction ${p.faction}`,
      'Add the faction to factions or fix the reference.',
    ),
    BIO_LENGTH: wording('Biography summary exceeds 120 characters', 'Shorten the summary.'),
    UNKNOWN_SOURCE: wording(
      (p) => `Unknown source ${p.ref}`,
      'Reference an existing character ID.',
    ),
    UNKNOWN_TARGET: wording(
      (p) => `Unknown target ${p.ref}`,
      'Reference an existing character ID.',
    ),
    SELF_LOOP: wording('Self-loop forbidden', 'Move it to the character biography.'),
    OTHER_LABEL: wording('other requires a label', 'Provide a short relationship label.'),
    DUPLICATE_RELATION: wording(
      (p) => `Duplicate of ${p.relation}`,
      'Merge duplicate relations with matching characters, type, and label.',
    ),
    INVERTED_INTERVAL: wording(
      'chapters.from exceeds chapters.to',
      'Correct the effective interval.',
    ),
    DURATION: wording('durationSec must be positive', 'Set a positive duration in seconds.'),
    TRANSITION: wording(
      'transitionMs must not be negative',
      'Use a nonnegative number of milliseconds.',
    ),
    CAMERA_CONFLICT: wording(
      'focusNodeId and fitIds are mutually exclusive',
      'Choose one camera target.',
    ),
    UNKNOWN_REF: wording(
      (p) => `Unknown ${p.kind}: ${p.ref}`,
      'Use a valid ID from the corresponding collection.',
    ),
    TOO_MANY_LEADS: wording(
      'More than two importance 5 characters',
      'Prefer at most two central protagonists.',
    ),
    TOO_MANY_STRONG: wording(
      'More than 15% of edges have strength 5',
      'Keep only the most important relationships.',
    ),
    ORPHAN: wording(
      'Unconnected character',
      'Verify the relationship or mark the character as mentioned only.',
    ),
    UNTIMED_EDGES: wording(
      'Timeline scenes exist but no relation has chapters',
      'Add chapter ranges to time-dependent relations.',
    ),
    MISSING_POSITIONS: wording(
      'More than half of characters lack positions',
      'Set initial positions for key characters to prevent opening layout jumps.',
    ),
  },
  'graph-source': {
    STRUCTURE: wording('Not a generic graph document.', (p) => `Use format: "${p.format}".`),
    'TOO_LARGE.limits': wording(
      (p) => `The graph is too large (limit: ${p.nodes} nodes, ${p.edges} relations).`,
      'Filter or aggregate the data before making a film.',
    ),
    'TOO_LARGE.nodes': wording(
      'Too many nodes.',
      'Filter or aggregate the data before making a film.',
    ),
    EMPTY: wording('The graph has no nodes or relations.', 'Add at least one node or relation.'),
    LARGE_GRAPH: wording(
      (p) =>
        `The graph is large (${p.nodes} nodes, ${p.edges} relations), beyond what previews smoothly (about ${p.previewNodes} nodes, ${p.previewEdges} relations).`,
      'The preview may stutter; exported films are not affected. For a smooth preview, filter or aggregate the data first.',
    ),
    'TYPE.array': wording(
      (p) => `${p.field} must be an array.`,
      'Change it to an array, or remove the field.',
    ),
    BEAT: wording('Invalid shot beat.', 'Check beat timing, field values and object references.'),
    'TYPE.ids': wording((p) => `${p.field} must be an array.`, 'Change it to an array of ids.'),
    'TYPE.object': wording(
      (p) => `${p.field} must be an object.`,
      (p) => `Use ${p.shape}.`,
    ),
    'TYPE.boolean': wording((p) => `${p.field} must be a boolean.`, 'Use true or false.'),
    'TYPE.number': wording(
      'A finite number is required.',
      'Change it to a number, or remove the field.',
    ),
    'TYPE.text': wording(
      'Invalid text field.',
      (p) => `Use text of at most ${p.limit} characters.`,
    ),
    'TYPE.edge': wording('A relation must be an object.', 'Use { "source": …, "target": … }.'),
    'TYPE.kindTable': wording('A kind table must be an object.', 'Key it by kind name.'),
    'TYPE.timeline': wording('Invalid timeline.', 'Use { "unit": "step" }.'),
    'TYPE.shot': wording('A shot must be an object.', 'Use { "title": …, "durationSec": … }.'),
    'ID.node': wording('Node has no valid id.', 'Provide a non-empty text or numeric id.'),
    'ID.group': wording('Group has no valid id.', 'Provide a non-empty text or numeric id.'),
    'DUPLICATE_ID.node': wording('Duplicate node id.', 'Give every node a unique id.'),
    'DUPLICATE_ID.group': wording('Duplicate group id.', 'Give every group a unique id.'),
    'DUPLICATE_ID.relation': wording(
      'Duplicate relation id.',
      'Give every relation a unique id, or leave the id out.',
    ),
    'DUPLICATE_ID.shot': wording(
      'Duplicate shot id.',
      'Give every shot a unique id, or leave the id out.',
    ),
    EDGE_REF: wording((p) => `Relation has no ${p.end}.`, 'Enter a node id.'),
    GROUP_REF: wording('Invalid group reference.', 'Enter a group id, or remove the field.'),
    SCENE_REF: wording('References an object that does not exist.', 'Use an existing id.'),
    'KIND.name': wording(
      'Invalid kind name.',
      (p) => `Use non-empty text of at most ${p.limit} characters.`,
    ),
    'KIND.declaration': wording(
      'Invalid kind declaration.',
      'Use a { "label": …, "color": … } object.',
    ),
    'ENUM.shape': wording('Invalid shape.', (p) => allowed(p.allowed)),
    'ENUM.line': wording('Invalid line style.', (p) => allowed(p.allowed)),
    'ENUM.head': wording('Invalid line end.', (p) => allowed(p.allowed)),
    'ENUM.diagram': wording('Invalid diagram kind.', (p) => allowed(p.allowed)),
    COLOR: wording('Invalid colour.', 'Use a six-digit #RRGGBB colour.'),
    WEIGHT: wording('Weight cannot be negative.', 'Use a non-negative number.'),
    'INTERVAL.visible': wording(
      'Invalid visibility interval.',
      'Keep visibleFrom at or before visibleTo.',
    ),
    'INTERVAL.visibleTo': wording(
      'Invalid visibility interval.',
      'Keep start at or before visibleTo, or set visibleFrom to say when it first appears.',
    ),
    'INTERVAL.end': wording('end requires start.', 'Add start, or remove end.'),
    'INTERVAL.span': wording('Invalid time span.', 'Keep start at or before end.'),
    POSITION: wording('Invalid coordinates.', 'Use { "x": number, "y": number }.'),
    LANE_ONLY: wording(
      'The position gives y alone, but x cannot be derived from dates; layout will place this node again and will not keep its original y.',
      'Only a dated node on a timeline that keeps time, with at least two distinct times, may give y alone; otherwise add x: use { "x": number, "y": number }.',
    ),
    OFF_TIME_AXIS: wording(
      (p) =>
        plural(
          p.count,
          '1 dated node has an x that is not its place in time; it is drawn at its date.',
          `${p.count} dated nodes have an x that is not their place in time; they are drawn at their dates.`,
        ),
      'A dated node\'s x is set by its date: remove the x and keep only y (re-exporting the positioned data writes it that way). To keep these x coordinates and draw no time axis, set "timeAxis": false.',
    ),
    IMPLICIT_NODES: wording(
      (p) =>
        plural(
          p.count,
          '1 node appears only in relations and was created from its id.',
          `${p.count} nodes appear only in relations and were created from their ids.`,
        ),
      'Declare them in nodes to give them a name, kind, or group.',
    ),
    DURATION: wording('Invalid duration.', 'Use a number of seconds between 0 and 600.'),
    CAMERA_ZOOM: wording('Invalid camera zoom.', 'Use a number greater than 0, or remove zoom.'),
    TRANSITION: wording('Invalid transition duration.', 'Use zero or more milliseconds.'),
    CAMERA_CONFLICT: wording(
      'Conflicting camera targets.',
      'Keep either focusNodeId or fitIds, not both.',
    ),
    'EVIDENCE.type': wording(
      'evidence must be an array.',
      'Use an array of evidence items, or remove the field.',
    ),
    'EVIDENCE.item': wording(
      (p) =>
        `Invalid evidence item: use non-empty text (a citation) or an object with a non-empty cite; text of at most ${p.limit} characters.`,
      'Write "Wang Wei, Farewell to Meng" or { "cite": …, "quote": …, "url": …, "locator": … }; quote must be the source text verbatim.',
    ),
    'SCENE_EVIDENCE.target': wording(
      'An evidence card names exactly one of nodeId and edgeId.',
      'Use { "edgeId": … } or { "nodeId": … }, optionally with items.',
    ),
    'SCENE_EVIDENCE.empty': wording(
      'The evidence card refers to an object without evidence.',
      'Add evidence to the object, or remove the card.',
    ),
    'SCENE_EVIDENCE.items': wording(
      (p) => `items must be distinct evidence indices (0 to ${p.last}).`,
      'List the indices of the items to show, or remove items to show them all.',
    ),
    'SCENE_EVIDENCE.card': wording(
      'A shot cannot open both a detail card and an evidence card.',
      'Remove openDetailNodeId or evidence.',
    ),
  },
  studio: {
    JSON: wording((p) => `JSON syntax error: ${p.detail}`, 'Check quotes, commas, and brackets.'),
    FORMAT: wording(
      'Unrecognized data format.',
      'Generic graphs use format: "relgraph.graph/1"; literature requires schemaVersion: "0.1"; biology requires format: "relgraph.bio/0.1-draft".',
    ),
    'PROJECT_CONFIG.field': wording(
      'Invalid project configuration.',
      'Correct the field or remove the override.',
    ),
    'PROJECT_CONFIG.reference': wording(
      'Invalid project configuration.',
      'Check object references and style scope.',
    ),
    NO_SCENES: wording('No playable shots found.', 'Add at least one shot to presentation.'),
    INITIAL_DOMAIN_TIME: wording(
      'Data has a time range, but the first shot has no domain time.',
      (p) => `Set ${p.field} for the first shot to avoid revealing future objects.`,
    ),
    INVALID_DATA: wording(
      'Could not convert data into a graph.',
      'Check the format, field types, and required fields.',
    ),
    EVIDENCE_CARD_HIDDEN: wording(
      (p) =>
        `The evidence card waits until the camera has stopped and its object is half revealed (about ${p.shown} s into the shot), but the shot ends at ${p.end} s, so the card is never shown.`,
      'Lengthen durationSec, or shorten transitionMs.',
    ),
    CAPTION_READING_SPEED: wording(
      (p) =>
        `The shot's title and narration take about ${p.needed} s to read, but are fully shown for only ${p.shown} s.`,
      (p) => `Raise durationSec to at least ${p.suggested} s, or shorten the title and narration.`,
    ),
    LOAD: wording(
      (p) => `Cannot load example: ${p.detail}`,
      'Run npm run dev or npm run preview from the repository root, then reopen the workspace.',
    ),
    FILE: wording((p) => `Cannot read file: ${p.detail}`, 'Select a readable JSON file.'),
  },
};
