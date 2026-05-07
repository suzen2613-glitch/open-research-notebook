'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export type ModalType = 'source' | 'note' | 'insight' | 'evidence'

export interface ModalAnchor {
  start: number
  end: number
}

export interface OpenModalOptions {
  anchor?: ModalAnchor
}

export function useModalManager() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // Read current modal state from URL params
  const modalType = searchParams?.get('modal') as ModalType | null
  const modalId = searchParams?.get('id')

  const rawAnchorStart = searchParams?.get('anchor_start')
  const rawAnchorEnd = searchParams?.get('anchor_end')
  const modalAnchor: ModalAnchor | null = (() => {
    if (rawAnchorStart === null || rawAnchorStart === undefined) return null
    if (rawAnchorEnd === null || rawAnchorEnd === undefined) return null
    const start = Number(rawAnchorStart)
    const end = Number(rawAnchorEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null
    return { start, end }
  })()

  /**
   * Open a modal by updating URL params without navigation
   */
  const openModal = (type: ModalType, id: string, options?: OpenModalOptions) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('modal', type)
    params.set('id', id)
    // Anchor lives only on the current modal session — clear whenever a
    // different modal is opened without one.
    params.delete('anchor_start')
    params.delete('anchor_end')
    if (options?.anchor) {
      params.set('anchor_start', String(options.anchor.start))
      params.set('anchor_end', String(options.anchor.end))
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  /**
   * Close the currently open modal by removing modal params from URL
   */
  const closeModal = () => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.delete('modal')
    params.delete('id')
    params.delete('anchor_start')
    params.delete('anchor_end')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return {
    modalType,
    modalId,
    modalAnchor,
    openModal,
    closeModal,
    isOpen: !!modalType && !!modalId,
  }
}
