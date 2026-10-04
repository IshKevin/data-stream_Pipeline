import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isStaff, useAuth } from './auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { SkeletonRows } from './components/ui'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { NewRequest } from './pages/NewRequest'
import { RequestDetail } from './pages/RequestDetail'
import { Requests } from './pages/Requests'

// Staff/admin pages are loaded on demand: clients never download them.
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })))
const Import = lazy(() => import('./pages/Import').then((m) => ({ default: m.Import })))
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })))

/** UI-level gate only (hides pages a role can't use). The API enforces the real rules. */
function Guard({ allow, children }: { allow: 'any' | 'client' | 'staff' | 'admin'; children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <SkeletonRows rows={4} label="Loading" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  const ok =
    allow === 'any' ||
    (allow === 'client' && user.role === 'client') ||
    (allow === 'staff' && isStaff(user)) ||
    (allow === 'admin' && user.role === 'admin')
  return ok ? <>{children}</> : <Navigate to="/requests" replace />
}

const lazyPage = (node: ReactNode) => <Suspense fallback={<SkeletonRows rows={5} label="Loading page" />}>{node}</Suspense>

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <Guard allow="any">
              <Layout />
            </Guard>
          }
        >
          <Route path="/" element={<Navigate to="/requests" replace />} />
          <Route path="/requests" element={<Requests />} />
          <Route
            path="/requests/new"
            element={
              <Guard allow="client">
                <NewRequest />
              </Guard>
            }
          />
          <Route path="/requests/:id" element={<RequestDetail />} />
          <Route
            path="/analytics"
            element={<Guard allow="staff">{lazyPage(<Analytics />)}</Guard>}
          />
          <Route path="/import" element={<Guard allow="staff">{lazyPage(<Import />)}</Guard>} />
          <Route path="/users" element={<Guard allow="admin">{lazyPage(<Users />)}</Guard>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  )
}
