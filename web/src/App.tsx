import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { isStaff, useAuth } from './auth'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { Analytics } from './pages/Analytics'
import { Import } from './pages/Import'
import { Login } from './pages/Login'
import { NewRequest } from './pages/NewRequest'
import { RequestDetail } from './pages/RequestDetail'
import { Requests } from './pages/Requests'
import { Users } from './pages/Users'

/** UI-level gate only (hides pages a role can't use). The API enforces the real rules. */
function Guard({ allow, children }: { allow: 'any' | 'client' | 'staff' | 'admin'; children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  const ok =
    allow === 'any' ||
    (allow === 'client' && user.role === 'client') ||
    (allow === 'staff' && isStaff(user)) ||
    (allow === 'admin' && user.role === 'admin')
  return ok ? <>{children}</> : <Navigate to="/requests" replace />
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Guard allow="any">
            <Layout />
          </Guard>
        }
      >
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
          element={
            <Guard allow="staff">
              <Analytics />
            </Guard>
          }
        />
        <Route
          path="/import"
          element={
            <Guard allow="staff">
              <Import />
            </Guard>
          }
        />
        <Route
          path="/users"
          element={
            <Guard allow="admin">
              <Users />
            </Guard>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/requests" replace />} />
    </Routes>
  )
}
