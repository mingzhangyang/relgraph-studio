/** Public aliases for the generated literary source contract. */
import type { Character, Relation } from './generated/relationship-graph';

export type {
  RelGraphV01Draft as GraphDoc,
  Meta,
  Timeline,
  Faction,
  Character,
  Bio,
  Quote,
  Relation,
  Step as PresentationStep,
} from './generated/relationship-graph';

export type Slug = string;
export type CharacterStatus = NonNullable<Character['status']>;
export type RelationType = Relation['type'];
export type Polarity = NonNullable<Relation['polarity']>;
