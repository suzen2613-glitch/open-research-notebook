const COOKIE_AUTH_TOKEN = '__cookie_auth__'
const AUTH_DISABLED_TOKEN = 'not-required'

type StoredAuthState = {
  state?: {
    token?: string | null
  }
}

function getStoredAuthState(): StoredAuthState | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem('auth-storage')
  if (!raw) {
    return null
  }

  try {
    return JSON.parse(raw) as StoredAuthState
  } catch (error) {
    console.error('Failed to parse auth storage', error)
    return null
  }
}

export function isBearerToken(token: string | null | undefined): token is string {
  return Boolean(token) && token !== COOKIE_AUTH_TOKEN && token !== AUTH_DISABLED_TOKEN
}

export function getStoredAuthToken(): string | null {
  return getStoredAuthState()?.state?.token ?? null
}

export function getStoredBearerToken(): string | null {
  const token = getStoredAuthToken()
  return isBearerToken(token) ? token : null
}

export { AUTH_DISABLED_TOKEN, COOKIE_AUTH_TOKEN }
