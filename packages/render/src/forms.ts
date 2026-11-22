import { DEFAULT_EDGE_FORMS, LINE_DASH, LINE_STYLES, type EdgeStyle } from '@relgraph/core';

/** A line may inherit a sheet-specific rhythm (including custom dash patterns). */
const forms = new Map<string, (style: EdgeStyle) => readonly number[] | undefined>([
  ['line', (style) => style.dash],
  ...LINE_STYLES.map((name) => [name, () => LINE_DASH[name]] as const),
]);

export interface FormDiagnostic {
  code: 'FORM_NOT_ALLOWED' | 'FORM_UNAVAILABLE';
  id: string;
  kind: string;
  form: string;
}

export function resolveEdgeForm(
  style: EdgeStyle,
  kind: string,
  id: string,
  form: string,
): { dash: readonly number[] | undefined } | { diagnostic: FormDiagnostic } {
  const allowed = style.forms ?? DEFAULT_EDGE_FORMS;
  if (!allowed.includes(form)) return { diagnostic: { code: 'FORM_NOT_ALLOWED', id, kind, form } };
  const draw = forms.get(form);
  if (!draw) return { diagnostic: { code: 'FORM_UNAVAILABLE', id, kind, form } };
  return { dash: draw(style) };
}
