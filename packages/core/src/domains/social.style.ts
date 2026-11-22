import { DEFAULT_EDGE_FORMS } from '../line-styles.js';
import type { KindDeclaration } from '../style.js';

export interface SocialClaim {
  assertsCoPresence: boolean;
  basis: 'attested' | 'inferred';
}

/** Only neutral presentation data crosses the adapter boundary. */
export function socialEdgeStyle(
  declaration: KindDeclaration | undefined,
  claim?: SocialClaim,
): KindDeclaration {
  return {
    ...declaration,
    line: declaration?.line ?? (claim?.basis === 'attested' ? 'solid' : 'dashed'),
    forms: claim?.assertsCoPresence
      ? [...DEFAULT_EDGE_FORMS, 'shared-position']
      : DEFAULT_EDGE_FORMS,
  };
}
