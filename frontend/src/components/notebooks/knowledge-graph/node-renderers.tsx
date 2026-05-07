import React from 'react'
import { cn } from '@/lib/utils'
import type { SourceWikiCardResponse } from '@/lib/api/wiki-cards'
import {
  PAPER_TYPE_STYLES,
  PAPER_NODE_WIDTH,
  PAPER_NODE_HEIGHT,
  CONCEPT_BASE_SIZE,
  CONCEPT_MAX_SIZE,
} from './graph-constants'
import { normalizePaperType } from './graph-helpers'
import type { LabelRenderers } from './graph-types'

/* ------------------------------------------------------------------ */
/* Node label components                                               */
/* ------------------------------------------------------------------ */

function PaperNodeLabel({ card, degree, dim }: { card: SourceWikiCardResponse; degree: number; dim?: boolean }) {
  const pt = normalizePaperType(card.paper_type)
  const style = pt ? PAPER_TYPE_STYLES[pt] : PAPER_TYPE_STYLES.method
  const title = card.short_title || card.title || card.source_title || card.source_id
  const year = card.year ? String(card.year) : ''
  const metaParts = [style.label, year].filter(Boolean)
  return (
    <div
      className={cn(
        'w-full rounded-md border border-l-4 bg-white/95 px-2.5 py-2 text-left shadow-sm transition',
        style.border,
        card.is_key_paper ? 'ring-1 ring-amber-300' : 'border-slate-200',
        dim && 'opacity-20'
      )}
      style={{ width: PAPER_NODE_WIDTH, height: PAPER_NODE_HEIGHT }}
    >
      <div className="line-clamp-2 text-[13px] font-semibold leading-[1.15] text-slate-900">{title}</div>
      <div className={cn('mt-1 flex items-center gap-1.5 text-[11px]', style.text)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
        <span className="truncate">{metaParts.join(' · ') || 'paper'}</span>
        {card.is_key_paper && (
          <span className="ml-auto rounded bg-amber-400 px-1 text-[10px] font-medium text-white">KEY</span>
        )}
      </div>
      {degree > 0 && (
        <div className="mt-0.5 text-[10px] text-slate-400">{degree} link{degree > 1 ? 's' : ''}</div>
      )}
    </div>
  )
}

function ConceptNodeLabel({ name, degree, dim }: { name: string; degree: number; dim?: boolean }) {
  const size = Math.min(CONCEPT_MAX_SIZE, CONCEPT_BASE_SIZE + degree * 6)
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-50 text-center shadow-sm transition',
        dim && 'opacity-20'
      )}
      style={{ width: size, height: size }}
    >
      <div className="px-2 text-[11px] font-semibold leading-tight text-emerald-900 line-clamp-3">{name}</div>
      <div className="text-[10px] text-emerald-700">{degree}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Label renderers factory                                             */
/* ------------------------------------------------------------------ */

export function createLabelRenderers(): LabelRenderers {
  return {
    paper: (card, degree, dim) => <PaperNodeLabel card={card} degree={degree} dim={dim} />,
    concept: (name, degree, dim) => <ConceptNodeLabel name={name} degree={degree} dim={dim} />,
  }
}
