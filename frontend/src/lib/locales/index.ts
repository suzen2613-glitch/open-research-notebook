import { zhCN } from './zh-CN';
import { enUS } from './en-US';
import { zhTW } from './zh-TW';
import { ptBR } from './pt-BR';
import { jaJP } from './ja-JP';
import { itIT } from './it-IT';
import { frFR } from './fr-FR';
import { ruRU } from './ru-RU';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const mergeWithEnglish = <T extends Record<string, unknown>>(
  base: Record<string, unknown>,
  override: T,
): T => {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      merged[key] = mergeWithEnglish(baseValue, value);
      continue;
    }
    merged[key] = value;
  }

  return merged as T;
};

export const resources = {
  'zh-CN': { translation: zhCN },
  'en-US': { translation: enUS },
  'zh-TW': { translation: mergeWithEnglish(enUS, zhTW) },
  'pt-BR': { translation: mergeWithEnglish(enUS, ptBR) },
  'ja-JP': { translation: mergeWithEnglish(enUS, jaJP) },
  'it-IT': { translation: mergeWithEnglish(enUS, itIT) },
  'fr-FR': { translation: mergeWithEnglish(enUS, frFR) },
  'ru-RU': { translation: mergeWithEnglish(enUS, ruRU) },
} as const;

export type TranslationKeys = typeof enUS;

export type LanguageCode = 'zh-CN' | 'en-US' | 'zh-TW' | 'pt-BR' | 'ja-JP' | 'it-IT' | 'fr-FR' | 'ru-RU';

export type Language = {
  code: LanguageCode;
  label: string;
};

export const languages: Language[] = [
  { code: 'en-US', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'pt-BR', label: 'Português' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'it-IT', label: 'Italiano' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'ru-RU', label: 'Русский' },
];

export { zhCN, enUS, zhTW, ptBR, jaJP, itIT, frFR, ruRU };
