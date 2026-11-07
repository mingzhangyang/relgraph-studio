import type { DomainStyle, EdgeStyle, LocalizedText, NodeStyle } from '../style.js';

const captions = {
  consumption: { 'zh-CN': '输入', en: 'input' },
  production: { 'zh-CN': '产物', en: 'product' },
  catalyst: { 'zh-CN': '催化', en: 'catalysis' },
  activator: { 'zh-CN': '促进', en: 'activates' },
  inhibitor: { 'zh-CN': '抑制', en: 'inhibits' },
  'physical-association': { 'zh-CN': '物理结合', en: 'binding' },
  'activity-influence': { 'zh-CN': '功能调控', en: 'regulates' },
  activation: { 'zh-CN': '激活', en: 'activation' },
  inhibition: { 'zh-CN': '抑制', en: 'inhibition' },
} satisfies Record<string, LocalizedText>;

const flow = (caption: LocalizedText): EdgeStyle =>
  Object.freeze({ stroke: 'plain', head: 'arrow', caption });
// Regulatory dashes separate influence from mass flow; the catalyst's short
// dash and hollow marker separate it from activation.
const regulatory = (head: EdgeStyle['head'], caption: LocalizedText, dash = [7, 5]): EdgeStyle =>
  Object.freeze({ stroke: 'regulatory', dash: Object.freeze(dash), head, caption });
const molecule: NodeStyle = Object.freeze({ shape: 'pill' });

/** Process-description roles and molecular interaction kinds of relgraph.bio/0.1-draft. */
export const biologyStyle: DomainStyle = Object.freeze({
  domain: 'biology',
  edges: Object.freeze({
    consumption: flow(captions.consumption),
    production: flow(captions.production),
    catalyst: regulatory('hollow-circle', captions.catalyst, [2, 5]),
    activator: regulatory('arrow', captions.activator),
    inhibitor: regulatory('bar', captions.inhibitor),
    'physical-association': Object.freeze({
      stroke: 'physical',
      head: 'none',
      caption: captions['physical-association'],
    }),
    'activity-influence': regulatory('arrow', captions['activity-influence']),
    activation: regulatory('arrow', captions.activation),
    inhibition: regulatory('bar', captions.inhibition),
  }),
  defaultEdge: Object.freeze({ stroke: 'plain', head: 'arrow' }),
  nodes: Object.freeze({
    protein: molecule,
    'protein-state': molecule,
    complex: molecule,
    'small-molecule': molecule,
    gene: molecule,
    reaction: Object.freeze({ shape: 'diamond', baseRadius: 13 }),
  }),
  defaultNode: Object.freeze({ shape: 'circle' }),
  legend: Object.freeze(
    Object.entries(captions).map(([kind, label]) => Object.freeze({ kind, label })),
  ),
});
