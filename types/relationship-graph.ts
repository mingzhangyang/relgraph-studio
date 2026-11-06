/** RelGraph v0.1 draft: types mirror the authored data contract. */
export type Slug = string;
export interface GraphDoc { schemaVersion: string; meta: Meta; timeline?: Timeline; factions?: Faction[]; characters: Character[]; relations: Relation[]; presentation?: PresentationStep[]; extra?: Record<string, unknown>; }
export interface Meta { title: string; work?: string; author?: string; description?: string; language?: string; theme?: string; createdBy?: string; createdAt?: string; sourceNote?: string; }
export interface Timeline { unit: string; total?: number; label?: string; }
export interface Faction { id: Slug; name: string; color?: string; description?: string; extra?: Record<string, unknown>; }
export type CharacterStatus = 'active' | 'deceased' | 'mentioned' | 'unknown';
export interface Character { id: Slug; name: string; aliases?: string[]; factionId?: Slug; importance: 1|2|3|4|5; status?: CharacterStatus; tags?: string[]; color?: string; icon?: string; avatarUrl?: string; bio: Bio; firstAppearance?: number; position?: {x:number;y:number}; pinned?: boolean; extra?: Record<string,unknown>; }
export interface Bio { summary: string; appearance?: string; personality?: string; arc?: string; fate?: string; quotes?: Quote[]; }
export interface Quote { text: string; at?: number; context?: string; }
export type RelationType = 'family'|'marriage'|'romance'|'friendship'|'alliance'|'rivalry'|'mentorship'|'service'|'other';
export type Polarity = 'positive'|'negative'|'ambiguous'|'neutral';
export interface Relation { id: Slug; source: Slug; target: Slug; type: RelationType; label?: string; directed?: boolean; strength:1|2|3|4|5; polarity?:Polarity; description?:string; chapters?:{from?:number;to?:number}; evidence?:Quote[]; extra?:Record<string,unknown>; }
export interface PresentationStep { id:Slug; title:string; narration?:string; durationSec:number; camera?:{focusNodeId?:Slug;fitIds?:Slug[];zoom?:number}; highlight?:{characterIds?:Slug[];relationIds?:Slug[];factionId?:Slug}; chapterAt?:number; openBioId?:Slug; transitionMs?:number; extra?:Record<string,unknown>; }
