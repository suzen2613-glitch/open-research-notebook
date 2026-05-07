import type { WikiCardStatus } from '@/lib/api/wiki-cards'

type TranslationObject = {
  wikiCards: {
    batchRefreshCompleted: string
    batchRefreshInProgress: string
    batchGenerationCompleted: string
    batchGenerationInProgress: string
    all: string
    missing: string
    pending: string
    completed: string
    failed: string
  }
}

export function getBatchProgressTitle(
  mode: 'generate_missing' | 'refresh_existing',
  t: TranslationObject,
  isComplete: boolean
) {
  if (mode === 'refresh_existing') {
    return isComplete ? t.wikiCards.batchRefreshCompleted : t.wikiCards.batchRefreshInProgress
  }
  return isComplete ? t.wikiCards.batchGenerationCompleted : t.wikiCards.batchGenerationInProgress
}

export function getStatusLabel(status: WikiCardStatus | 'all', t: TranslationObject) {
  const labels: Record<WikiCardStatus | 'all', string> = {
    all: t.wikiCards.all,
    missing: t.wikiCards.missing,
    pending: t.wikiCards.pending,
    completed: t.wikiCards.completed,
    failed: t.wikiCards.failed,
  }
  return labels[status]
}

export function getBadgeVariant(status: WikiCardStatus) {
  switch (status) {
    case 'completed':
      return 'secondary' as const
    case 'failed':
      return 'destructive' as const
    default:
      return 'outline' as const
  }
}
