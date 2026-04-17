'use client'

import { ImgHTMLAttributes, useEffect, useState } from 'react'
import { getApiUrl } from '@/lib/config'

const LOCAL_ONLY_IMAGE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

function buildAbsoluteApiPath(apiUrl: string, path: string): string {
  return apiUrl ? `${apiUrl}${path}` : path
}

function rewriteLegacyLocalImageUrl(src: string, apiUrl: string): string | null {
  try {
    const parsed = new URL(src)
    const isLocalHost = LOCAL_ONLY_IMAGE_HOSTS.has(parsed.hostname)
    if (!isLocalHost) {
      return null
    }

    const currentPath = parsed.pathname
    if (!currentPath) {
      return null
    }

    if (currentPath.startsWith('/api/images/')) {
      return buildAbsoluteApiPath(apiUrl, currentPath)
    }

    if (currentPath.startsWith('/images/')) {
      return buildAbsoluteApiPath(apiUrl, `/api${currentPath}`)
    }

    if (parsed.port === '8888') {
      return buildAbsoluteApiPath(apiUrl, `/api/images${currentPath}`)
    }

    return null
  } catch {
    return null
  }
}

function resolveMarkdownImageUrl(src: string, apiUrl: string): string {
  const legacyLocalUrl = rewriteLegacyLocalImageUrl(src, apiUrl)
  if (legacyLocalUrl) {
    return legacyLocalUrl
  }

  if (/^(https?:|data:|blob:)/i.test(src)) {
    return src
  }

  if (!apiUrl) {
    return src
  }

  if (src.startsWith('/')) {
    return `${apiUrl}${src}`
  }

  return `${apiUrl}/${src}`
}

export function MarkdownImage({
  src,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(
    typeof src === 'string' ? src : undefined
  )

  useEffect(() => {
    let cancelled = false

    if (typeof src !== 'string' || !src) {
      setResolvedSrc(undefined)
      return () => {
        cancelled = true
      }
    }

    void (async () => {
      const apiUrl = await getApiUrl()
      if (!cancelled) {
        setResolvedSrc(resolveMarkdownImageUrl(src, apiUrl))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [src])

  if (!resolvedSrc) {
    return null
  }

  return <img {...props} src={resolvedSrc} alt={alt} loading={props.loading ?? 'lazy'} />
}
