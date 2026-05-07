import { useState } from 'react'
import { Eye, EyeOff, Filter, RotateCcw, Search, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { RELATION_STYLES, type RelationType } from './graph-constants'
import type { Filters } from './graph-types'

interface ToolbarProps {
  filters: Filters
  onChange: (patch: Partial<Filters>) => void
  allDomains: { id: string; count: number }[]
  allPaperTypes: { id: string; count: number }[]
  nodeCount: { papers: number; concepts: number }
  edgeCount: number
  onReset: () => void
  onFitView: () => void
}

export function Toolbar({ filters, onChange, allDomains, allPaperTypes, nodeCount, edgeCount, onReset, onFitView }: ToolbarProps) {
  const { t } = useTranslation()
  const [showFilters, setShowFilters] = useState(false)
  return (
    <div className="border-b bg-white/95 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder={t.knowledgeGraph.searchPlaceholder}
            className="h-9 pl-8"
          />
        </div>
        <Button
          size="sm"
          variant={showFilters ? 'default' : 'outline'}
          onClick={() => setShowFilters((s) => !s)}
        >
          <Filter className="mr-1.5 h-4 w-4" />
          {t.knowledgeGraph.filters}
        </Button>
        <Button
          size="sm"
          variant={filters.onlyKeyPapers ? 'default' : 'outline'}
          onClick={() => onChange({ onlyKeyPapers: !filters.onlyKeyPapers })}
        >
          <Sparkles className="mr-1.5 h-4 w-4" />
          {t.knowledgeGraph.keyOnly}
        </Button>
        <Button
          size="sm"
          variant={filters.showRelatedWork ? 'default' : 'outline'}
          onClick={() => onChange({ showRelatedWork: !filters.showRelatedWork })}
        >
          {filters.showRelatedWork ? <Eye className="mr-1.5 h-4 w-4" /> : <EyeOff className="mr-1.5 h-4 w-4" />}
          {t.knowledgeGraph.genericLinks}
        </Button>
        <Button size="sm" variant="outline" onClick={onFitView}>
          {t.knowledgeGraph.fit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset}>
          <RotateCcw className="mr-1.5 h-4 w-4" />
          {t.knowledgeGraph.reset}
        </Button>
        <div className="ml-auto flex gap-1.5">
          <Badge variant="secondary">{t.knowledgeGraph.papers.replace('{count}', String(nodeCount.papers))}</Badge>
          <Badge variant="secondary">{t.knowledgeGraph.concepts.replace('{count}', String(nodeCount.concepts))}</Badge>
          <Badge variant="secondary">{t.knowledgeGraph.edges.replace('{count}', String(edgeCount))}</Badge>
        </div>
      </div>
      {showFilters && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.knowledgeGraph.domains}</div>
            <div className="flex flex-wrap gap-2">
              {allDomains.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  <Checkbox
                    checked={filters.domains.has(d.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(filters.domains)
                      if (checked) next.add(d.id)
                      else next.delete(d.id)
                      onChange({ domains: next })
                    }}
                  />
                  <span>{d.id.replace(/_/g, ' ')}</span>
                  <span className="text-slate-400">({d.count})</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.knowledgeGraph.paperTypes}</div>
            <div className="flex flex-wrap gap-2">
              {allPaperTypes.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                  <Checkbox
                    checked={filters.paperTypes.has(p.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(filters.paperTypes)
                      if (checked) next.add(p.id)
                      else next.delete(p.id)
                      onChange({ paperTypes: next })
                    }}
                  />
                  <span>{p.id}</span>
                  <span className="text-slate-400">({p.count})</span>
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t.knowledgeGraph.relationTypes}</div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(RELATION_STYLES) as RelationType[]).map((rt) => {
                const style = RELATION_STYLES[rt]
                const active = filters.relationTypes.has(rt)
                return (
                  <button
                    key={rt}
                    type="button"
                    onClick={() => {
                      const next = new Set(filters.relationTypes)
                      if (active) next.delete(rt)
                      else next.add(rt)
                      onChange({ relationTypes: next })
                    }}
                    className={cn(
                      'flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition',
                      active
                        ? 'border-slate-800 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    )}
                  >
                    <svg width="22" height="6">
                      <line x1="0" y1="3" x2="22" y2="3" stroke={active ? '#fff' : style.color} strokeWidth="1.5" strokeDasharray={style.dash} />
                    </svg>
                    {style.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
