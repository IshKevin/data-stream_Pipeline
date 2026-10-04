const TOKEN_KEY = 'drd.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable: the session just won't survive a reload */
  }
}

export interface ApiErrorDetail {
  episode?: string | number
  reason?: string
}

export class ApiError extends Error {
  status: number
  code: string | undefined
  errors: ApiErrorDetail[] | undefined

  constructor(status: number, message: string, code?: string, errors?: ApiErrorDetail[]) {
    super(message)
    this.status = status
    this.code = code
    this.errors = errors
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn
}

/** FastAPI validation errors come back as `detail: [{loc, msg}]`; domain errors as `detail: string`. */
function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return detail
        .map((d: { loc?: unknown[]; msg?: string }) => {
          const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body').join('.') : ''
          return field ? `${field}: ${d.msg}` : (d.msg ?? '')
        })
        .join('; ')
    }
  }
  return fallback
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; form?: FormData; query?: Record<string, string | number | undefined | null> } = {},
): Promise<T> {
  const url = new URL(`/api${path}`, window.location.origin)
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (options.form) body = options.form
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  let res: Response
  try {
    res = await fetch(url, { method: options.method ?? 'GET', headers, body })
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.')
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON error page (e.g. proxy) */
  }
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized()
    const j = json as { code?: string; errors?: ApiErrorDetail[] } | null
    throw new ApiError(res.status, messageFrom(json, `Request failed (${res.status})`), j?.code, j?.errors)
  }
  return json as T
}
