import type { DomainStyle, EdgeStyle } from '../style.js';

const DASHED = Object.freeze([7, 5]),
  DOTTED = Object.freeze([2, 4]);
const relation = (tone?: number, dash?: readonly number[]): EdgeStyle =>
  Object.freeze({
    stroke: 'plain',
    head: 'arrow',
    ...(tone === undefined ? {} : { tone }),
    ...(dash ? { dash } : {}),
  });

/**
 * Literary relations. Each kind keeps one hue of the film palette in both
 * themes, and the kinds that read as distance rather than closeness (rivalry,
 * service) also change rhythm, so the encoding never rests on colour alone.
 * Author labels still appear on a relation when a shot highlights it.
 */
export const literatureStyle: DomainStyle = Object.freeze({
  domain: 'literature',
  edges: Object.freeze({
    family: relation(7),
    marriage: relation(1),
    romance: relation(4),
    friendship: relation(2),
    alliance: relation(0),
    rivalry: relation(6, DASHED),
    mentorship: relation(3),
    service: relation(5, DOTTED),
    other: relation(),
  }),
  defaultEdge: relation(),
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
  curvature: 1,
});
