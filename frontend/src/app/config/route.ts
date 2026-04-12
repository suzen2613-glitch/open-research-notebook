import { NextResponse } from 'next/server'

/**
 * Runtime Configuration Endpoint
 *
 * This endpoint provides server-side runtime config to the client.
 * By default it returns an empty API URL so the browser uses same-origin `/api/*`
 * routes via the Next.js rewrite proxy. This keeps auth cookies and image URLs
 * on the public domain instead of jumping to an internal `:5055` port.
 *
 * Environment Variables:
 * - API_URL / NEXT_PUBLIC_API_URL: Optional direct browser API URL override when
 *   the frontend should talk to a separate public API origin.
 */
export async function GET() {
  const envApiUrl = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL

  if (envApiUrl) {
    return NextResponse.json({
      apiUrl: envApiUrl,
    })
  }

  return NextResponse.json({
    apiUrl: '',
  })
}
