import type { DomainStyle, EdgeStyle } from '../style.js';

const relation: EdgeStyle = Object.freeze({ stroke: 'plain', head: 'arrow' });

/** Literary relations are plain lines; their author labels appear when highlighted. */
export const literatureStyle: DomainStyle = Object.freeze({
  domain: 'literature',
  edges: Object.freeze({
    family: relation,
    marriage: relation,
    romance: relation,
    friendship: relation,
    alliance: relation,
    rivalry: relation,
    mentorship: relation,
    service: relation,
    other: relation,
  }),
  defaultEdge: relation,
  nodes: Object.freeze({ person: Object.freeze({ shape: 'circle' }) }),
  defaultNode: Object.freeze({ shape: 'circle' }),
  legend: Object.freeze([
    { kind: 'family', label: { 'zh-CN': '亲缘', en: 'Family' } },
    { kind: 'marriage', label: { 'zh-CN': '婚姻', en: 'Marriage' } },
    { kind: 'romance', label: { 'zh-CN': '情感', en: 'Romance' } },
    { kind: 'friendship', label: { 'zh-CN': '友谊', en: 'Friendship' } },
    { kind: 'alliance', label: { 'zh-CN': '同盟', en: 'Alliance' } },
    { kind: 'rivalry', label: { 'zh-CN': '对立', en: 'Rivalry' } },
    { kind: 'mentorship', label: { 'zh-CN': '师承', en: 'Mentorship' } },
    { kind: 'service', label: { 'zh-CN': '主仆', en: 'Service' } },
    { kind: 'other', label: { 'zh-CN': '其他', en: 'Other' } },
  ]),
});
