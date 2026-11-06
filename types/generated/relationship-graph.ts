// Generated from schema/relationship-graph.schema.json. Do not edit by hand.

/**
 * Narrative relationship graph interchange format. Early draft; semantic checks are separate.
 */
export interface RelGraphV01Draft {
  schemaVersion: '0.1';
  meta: Meta;
  timeline?: Timeline;
  factions?: Faction[];
  /**
   * @minItems 1
   */
  characters: [Character, ...Character[]];
  relations: Relation[];
  presentation?: Step[];
  extra?: {
    [k: string]: unknown;
  };
}
export interface Meta {
  title: string;
  work?: string;
  author?: string;
  description?: string;
  language?: string;
  theme?: string;
  createdBy?: string;
  createdAt?: string;
  sourceNote?: string;
}
export interface Timeline {
  unit: string;
  total?: number;
  label?: string;
}
export interface Faction {
  id: string;
  name: string;
  color?: string;
  description?: string;
  extra?: {
    [k: string]: unknown;
  };
}
export interface Character {
  id: string;
  name: string;
  aliases?: string[];
  factionId?: string;
  importance: number;
  status?: 'active' | 'deceased' | 'mentioned' | 'unknown';
  tags?: string[];
  color?: string;
  icon?: string;
  avatarUrl?: string;
  bio: Bio;
  firstAppearance?: number;
  position?: Position;
  pinned?: boolean;
  extra?: {
    [k: string]: unknown;
  };
}
export interface Bio {
  summary: string;
  appearance?: string;
  personality?: string;
  arc?: string;
  fate?: string;
  quotes?: Quote[];
}
export interface Quote {
  text: string;
  at?: number;
  context?: string;
}
export interface Position {
  x: number;
  y: number;
}
export interface Relation {
  id: string;
  source: string;
  target: string;
  type:
    | 'family'
    | 'marriage'
    | 'romance'
    | 'friendship'
    | 'alliance'
    | 'rivalry'
    | 'mentorship'
    | 'service'
    | 'other';
  label?: string;
  directed?: boolean;
  strength: number;
  polarity?: 'positive' | 'negative' | 'ambiguous' | 'neutral';
  description?: string;
  chapters?: Chapters;
  evidence?: Quote[];
  extra?: {
    [k: string]: unknown;
  };
}
export interface Chapters {
  from?: number;
  to?: number;
}
export interface Step {
  id: string;
  title: string;
  narration?: string;
  durationSec: number;
  camera?: Camera;
  highlight?: Highlight;
  chapterAt?: number;
  openBioId?: string;
  transitionMs?: number;
  extra?: {
    [k: string]: unknown;
  };
}
export interface Camera {
  focusNodeId?: string;
  fitIds?: string[];
  zoom?: number;
}
export interface Highlight {
  characterIds?: string[];
  relationIds?: string[];
  factionId?: string;
}
