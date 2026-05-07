'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { isAxiosError } from 'axios'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

import { modelsApi } from '@/lib/api/models'
import { useModels, useModelDefaults, useProviders } from '@/lib/hooks/use-models'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'

/**
 * Shared hook for resolving preferred AI models.
 * Used by WikiCardsColumn and SummariesColumn which have identical model resolution logic.
 */
export function useModelResolver() {
  const { t } = useTranslation()
  const { data: models = [] } = useModels()
  const { data: modelDefaults } = useModelDefaults()
  const { data: providerAvailability } = useProviders()
  const validatedModelIdsRef = useRef<Set<string>>(new Set())

  const languageModels = useMemo(
    () =>
      [...models]
        .filter((model) => model.type === 'language')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [models]
  )

  const availableProviderNames = useMemo(
    () => new Set((providerAvailability?.available ?? []).map(provider => provider.toLowerCase())),
    [providerAvailability?.available]
  )

  const availableLanguageModels = useMemo(() => {
    if (!providerAvailability) {
      return languageModels
    }

    return languageModels.filter((model) =>
      availableProviderNames.has(model.provider.replaceAll('_', '-').toLowerCase())
    )
  }, [availableProviderNames, languageModels, providerAvailability])

  const preferredModelId = useMemo(() => {
    const preferredIds = [
      modelDefaults?.default_transformation_model,
      modelDefaults?.default_chat_model,
    ].filter((value): value is string => Boolean(value))

    for (const preferredId of preferredIds) {
      if (availableLanguageModels.some((model) => model.id === preferredId)) {
        return preferredId
      }
    }

    return availableLanguageModels[0]?.id
  }, [
    availableLanguageModels,
    modelDefaults?.default_chat_model,
    modelDefaults?.default_transformation_model,
  ])

  const resolveModelId = useCallback(() => {
    if (preferredModelId) {
      return preferredModelId
    }

    toast.error(t.apiErrors.pleaseConfigureModels)
    return null
  }, [preferredModelId, t.apiErrors.pleaseConfigureModels])

  const getErrorMessage = useCallback((error: unknown) => {
    if (isAxiosError(error)) {
      const detail =
        typeof error.response?.data === 'object' &&
        error.response?.data &&
        'detail' in error.response.data
          ? String(error.response.data.detail)
          : null
      return detail || error.message || t.common.error
    }

    if (error instanceof Error) {
      return error.message
    }

    return t.common.error
  }, [t.common.error])

  const validateModel = useCallback(async (modelId: string) => {
    if (validatedModelIdsRef.current.has(modelId)) {
      return true
    }

    try {
      const result = await modelsApi.testModel(modelId)
      if (result.success) {
        validatedModelIdsRef.current.add(modelId)
        return true
      }

      toast.error(result.message || t.apiErrors.pleaseConfigureModels)
      return false
    } catch (error) {
      toast.error(getErrorMessage(error))
      return false
    }
  }, [getErrorMessage, t.apiErrors.pleaseConfigureModels])

  return {
    preferredModelId,
    resolveModelId,
    getErrorMessage,
    validateModel,
    validatedModelIdsRef,
  }
}

/**
 * Shared hook for batch progress auto-reset pattern.
 * Used by WikiCardsColumn and SummariesColumn.
 */
export function useBatchProgressReset<T extends { completed: number; failed: number; total: number }>(
  batchProgress: T | null,
  setBatchProgress: (value: T | null) => void
) {
  const batchProgressResetTimeoutRef = useRef<number | null>(null)

  const batchProcessedCount = (batchProgress?.completed ?? 0) + (batchProgress?.failed ?? 0)
  const batchProgressPercent = batchProgress?.total
    ? Math.round((batchProcessedCount / batchProgress.total) * 100)
    : 0
  const isBatchProgressComplete = Boolean(
    batchProgress && batchProcessedCount >= batchProgress.total
  )

  useEffect(() => {
    if (batchProgressResetTimeoutRef.current) {
      window.clearTimeout(batchProgressResetTimeoutRef.current)
      batchProgressResetTimeoutRef.current = null
    }

    if (!batchProgress || !isBatchProgressComplete) {
      return
    }

    batchProgressResetTimeoutRef.current = window.setTimeout(() => {
      setBatchProgress(null)
      batchProgressResetTimeoutRef.current = null
    }, 4000)

    return () => {
      if (batchProgressResetTimeoutRef.current) {
        window.clearTimeout(batchProgressResetTimeoutRef.current)
        batchProgressResetTimeoutRef.current = null
      }
    }
  }, [batchProgress, isBatchProgressComplete, setBatchProgress])

  return {
    batchProcessedCount,
    batchProgressPercent,
    isBatchProgressComplete,
  }
}

/**
 * Shared date formatting utilities.
 */
export function useFormattedDates() {
  const { t, language } = useTranslation()

  const parseValidDate = useCallback((value?: string | null) => {
    if (!value) {
      return null
    }

    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }, [])

  const formatRelativeDate = useCallback((value?: string | null) => {
    const date = parseValidDate(value)
    if (!date) {
      return t.common.unknown
    }

    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: getDateLocale(language),
    })
  }, [language, parseValidDate, t.common.unknown])

  return { parseValidDate, formatRelativeDate }
}
