import { NotebookThemeColor, NotebookType } from '@/lib/types/api'

export interface NotebookThemeClasses {
  card: string
  soft: string
  badge: string
  accent: string
  text: string
  button: string
}

export const NOTEBOOK_TYPE_OPTIONS: NotebookType[] = ['academic', 'general']
export const NOTEBOOK_THEME_OPTIONS: NotebookThemeColor[] = ['slate', 'blue', 'emerald', 'amber', 'rose', 'violet']

const NOTEBOOK_THEME_CLASS_MAP: Record<NotebookThemeColor, NotebookThemeClasses> = {
  slate: {
    card: 'border-slate-200/80 bg-slate-50/40 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/30',
    soft: 'bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200',
    badge: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200',
    accent: 'bg-slate-500',
    text: 'text-slate-700 dark:text-slate-200',
    button: 'border-slate-300/70 bg-slate-50 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800',
  },
  blue: {
    card: 'border-blue-200/80 bg-blue-50/40 hover:border-blue-300 dark:border-blue-900 dark:bg-blue-950/20',
    soft: 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-200',
    badge: 'border-blue-300 text-blue-700 dark:border-blue-800 dark:text-blue-200',
    accent: 'bg-blue-500',
    text: 'text-blue-700 dark:text-blue-200',
    button: 'border-blue-300/70 bg-blue-50 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:hover:bg-blue-950/70',
  },
  emerald: {
    card: 'border-emerald-200/80 bg-emerald-50/40 hover:border-emerald-300 dark:border-emerald-900 dark:bg-emerald-950/20',
    soft: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200',
    badge: 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-200',
    accent: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-200',
    button: 'border-emerald-300/70 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/70',
  },
  amber: {
    card: 'border-amber-200/80 bg-amber-50/40 hover:border-amber-300 dark:border-amber-900 dark:bg-amber-950/20',
    soft: 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-200',
    badge: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-200',
    accent: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-200',
    button: 'border-amber-300/70 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-950/70',
  },
  rose: {
    card: 'border-rose-200/80 bg-rose-50/40 hover:border-rose-300 dark:border-rose-900 dark:bg-rose-950/20',
    soft: 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-200',
    badge: 'border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-200',
    accent: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-200',
    button: 'border-rose-300/70 bg-rose-50 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:hover:bg-rose-950/70',
  },
  violet: {
    card: 'border-violet-200/80 bg-violet-50/40 hover:border-violet-300 dark:border-violet-900 dark:bg-violet-950/20',
    soft: 'bg-violet-100 text-violet-700 dark:bg-violet-950/70 dark:text-violet-200',
    badge: 'border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-200',
    accent: 'bg-violet-500',
    text: 'text-violet-700 dark:text-violet-200',
    button: 'border-violet-300/70 bg-violet-50 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:hover:bg-violet-950/70',
  },
}

export function getNotebookThemeClasses(themeColor: NotebookThemeColor): NotebookThemeClasses {
  return NOTEBOOK_THEME_CLASS_MAP[themeColor] ?? NOTEBOOK_THEME_CLASS_MAP.blue
}

export function getNotebookTypeLabel(type: NotebookType, language?: string | null): string {
  const isZh = language?.startsWith('zh')
  if (type === 'general') {
    return isZh ? '普通笔记本' : 'General'
  }
  return isZh ? '学术笔记本' : 'Academic'
}

export function getNotebookThemeLabel(color: NotebookThemeColor, language?: string | null): string {
  const isZh = language?.startsWith('zh')
  const labels: Record<NotebookThemeColor, string> = {
    slate: isZh ? '石板灰' : 'Slate',
    blue: isZh ? '深蓝' : 'Blue',
    emerald: isZh ? '翠绿' : 'Emerald',
    amber: isZh ? '琥珀' : 'Amber',
    rose: isZh ? '玫瑰' : 'Rose',
    violet: isZh ? '紫罗兰' : 'Violet',
  }
  return labels[color]
}
