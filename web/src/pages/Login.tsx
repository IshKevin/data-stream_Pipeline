import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { SESSION_EXPIRED_KEY, useAuth } from '../auth'
import { BrandMark, Icon } from '../components/Icon'
import { ErrorBanner, InfoBanner } from '../components/ui'
import { APP_NAME, useDocumentTitle } from '../lib/hooks'

function sessionExpired(): boolean {
  try {
    return sessionStorage.getItem(SESSION_EXPIRED_KEY) === '1'
  } catch {
    return false
  }
}

export function Login() {
  useDocumentTitle('Sign in')
  const { user, login } = useAuth()
  const location = useLocation()
  const [expired] = useState(sessionExpired)
  useEffect(() => {
    // show the notice once, then forget it (done in an effect so StrictMode's double render can't lose it)
    try {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY)
    } catch {
      /* ignore */
    }
  }, [])
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/requests'
    return <Navigate to={from} replace />
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login-wrap">
      <form className="card login" onSubmit={submit} aria-labelledby="login-title">
        <div>
          <span className="brand">
            <BrandMark />
            {APP_NAME}
          </span>
          <h1 id="login-title">Sign in</h1>
          <p className="muted">Use your work account to continue.</p>
        </div>
        {expired && !error && (
          <InfoBanner>Your session has ended. Please sign in again.</InfoBanner>
        )}
        <ErrorBanner error={error} />
        <label className="field">
          Email
          <span className="input-icon">
            <Icon name="mail" size={16} />
            <input
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </span>
        </label>
        <label className="field">
          Password
          <span className="input-icon password-wrap">
            <Icon name="lock" size={16} />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost btn-small btn-icon"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} />
            </button>
          </span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? (
            'Signing in…'
          ) : (
            <>
              <Icon name="log-out" size={16} className="icon-flip" />
              Sign in
            </>
          )}
        </button>
      </form>
    </main>
  )
}
