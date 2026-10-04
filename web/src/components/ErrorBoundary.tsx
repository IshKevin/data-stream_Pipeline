import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './Icon'

interface State {
  error: Error | null
}

/** Last line of defence: a render error shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="login-wrap">
        <div className="card login" role="alert">
          <span className="empty-icon">
            <Icon name="alert" />
          </span>
          <h1>Something went wrong</h1>
          <p className="muted">The page hit an unexpected error. Your data is safe – try reloading.</p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              <Icon name="refresh" size={16} />
              Reload page
            </button>
            <a className="btn" href="/">
              Go to start
            </a>
          </div>
        </div>
      </div>
    )
  }
}
