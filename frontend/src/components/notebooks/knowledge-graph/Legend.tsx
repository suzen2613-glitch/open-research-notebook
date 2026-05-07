import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { PAPER_TYPE_STYLES, RELATION_STYLES, type PaperType, type RelationType } from './graph-constants'

export function Legend() {
  const { t } = useTranslation()
  return (
    <div className="absolute bottom-3 right-3 z-10 max-w-[260px] rounded-lg border bg-white/95 p-3 shadow-lg">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.knowledgeGraph.legend}</div>
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-slate-600">{t.knowledgeGraph.paperTypesLegend}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
          {(Object.entries(PAPER_TYPE_STYLES) as [PaperType, typeof PAPER_TYPE_STYLES[PaperType]][])
            .filter(([k]) => k !== 'survey')
            .map(([key, style]) => (
              <div key={key} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', style.dot)} />
                <span>{style.label}</span>
              </div>
            ))}
        </div>
        <div className="mt-1.5 text-[11px] font-medium text-slate-600">{t.knowledgeGraph.relationTypesLegend}</div>
        <div className="grid grid-cols-1 gap-y-0.5 text-[11px] text-slate-600">
          {(Object.entries(RELATION_STYLES) as [RelationType, typeof RELATION_STYLES[RelationType]][]).map(([key, style]) => (
            <div key={key} className="flex items-center gap-1.5">
              <svg width="28" height="8">
                <line x1="0" y1="4" x2="28" y2="4" stroke={style.color} strokeWidth={Math.max(1, style.width)} strokeDasharray={style.dash} />
              </svg>
              <span>{style.label}</span>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="h-3 w-3 rounded-full border-2 border-emerald-400 bg-emerald-50" />
          <span>{t.knowledgeGraph.conceptSize}</span>
        </div>
      </div>
    </div>
  )
}
