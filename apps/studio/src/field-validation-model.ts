import {
  APPEARANCE_FIELD_RULES,
  validAppearanceField,
  type AppearanceKind,
} from '@relgraph/core';

export type AppearanceDraftResult =
  | { ok: true; value: string | number | boolean | undefined; message: '' }
  | { ok: false; message: string };

const valuesFor = (kind: AppearanceKind, field: string) =>
  APPEARANCE_FIELD_RULES[kind][field];

export function appearanceFieldHint(kind: AppearanceKind, field: string): string {
  const rule = valuesFor(kind, field);
  if (!rule) return '';
  switch (rule.type) {
    case 'number':
      return `有效范围：${rule.min}–${rule.max}；留空继承`;
    case 'color':
      return '颜色格式：#RRGGBB；留空继承';
    case 'enum':
    case 'boolean':
      return '留空继承';
    case 'image':
      return '通过图片上传控件设置';
  }
}

/**
 * An empty, completed field means "inherit". Incomplete native numeric input
 * is a different state: Chromium may expose value="" while validity.badInput.
 */
export function parseAppearanceDraft(
  kind: AppearanceKind,
  field: string,
  raw: string,
  badInput = false,
): AppearanceDraftResult {
  const rule = valuesFor(kind, field);
  if (!rule) return { ok: false, message: '不支持的样式字段。' };
  if (badInput) return { ok: false, message: '数字输入尚未完成，请修正后再应用。' };
  if (raw === '') return { ok: true, value: undefined, message: '' };

  let value: string | number | boolean = raw;
  switch (rule.type) {
    case 'number':
      if (!raw.trim() || !Number.isFinite(Number(raw))) {
        return { ok: false, message: `请输入 ${rule.min}–${rule.max} 范围内的数字。` };
      }
      value = Number(raw);
      if (!validAppearanceField(kind, field, value))
        return { ok: false, message: `数值必须在 ${rule.min}–${rule.max} 之间。` };
      break;
    case 'color':
      if (!validAppearanceField(kind, field, value))
        return { ok: false, message: '请输入六位十六进制颜色，如 #336699。' };
      break;
    case 'enum':
      if (typeof rule.values[0] === 'number') {
        if (!raw.trim()) return { ok: false, message: '请选择有效选项。' };
        value = Number(raw);
      }
      if (!validAppearanceField(kind, field, value))
        return { ok: false, message: '请选择有效选项。' };
      break;
    case 'boolean':
      if (raw !== 'true' && raw !== 'false')
        return { ok: false, message: '请选择有效选项。' };
      value = raw === 'true';
      break;
    case 'image':
      if (!validAppearanceField(kind, field, value))
        return { ok: false, message: '图片引用无效。' };
      break;
  }
  return { ok: true, value, message: '' };
}
