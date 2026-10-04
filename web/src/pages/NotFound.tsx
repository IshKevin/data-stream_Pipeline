import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { useDocumentTitle } from '../lib/hooks'

export function NotFound() {
  useDocumentTitle('Page not found')
  return (
    <div className="card not-found">
      <div className="code" aria-hidden="true">
        404
      </div>
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or was moved.</p>
      <Link className="btn btn-primary" to="/requests">
        <Icon name="arrow-left" size={16} />
        Back to requests
      </Link>
    </div>
  )
}
