import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { isStaff, useAuth } from '../auth'
import { subscribeToEvents } from '../lib/sse'

export function Layout() {
  const { user, logout } = useAuth()
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)

  // Live updates: any server event just invalidates the cached lists/details, which then refetch.
  useEffect(() => {
    return subscribeToEvents(
      (event) => {
        void queryClient.invalidateQueries({ queryKey: ['requests'] })
        void queryClient.invalidateQueries({ queryKey: ['request', event.request_id] })
      },
      setLive,
    )
  }, [queryClient])

  if (!user) return null
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">data-stream_Pipeline</span>
          <nav>
            <NavLink to="/requests">Requests</NavLink>
            {isStaff(user) && <NavLink to="/analytics">Analytics</NavLink>}
            {isStaff(user) && <NavLink to="/import">Import</NavLink>}
            {user.role === 'admin' && <NavLink to="/users">Users</NavLink>}
          </nav>
          <span className="spacer" />
          <span className={`live ${live ? 'live-on' : ''}`} title={live ? 'Live updates connected' : 'Reconnecting…'}>
            <span className="dot" /> {live ? 'Live' : 'Offline'}
          </span>
          <span className="who">
            {user.name} <small>({user.role})</small>
          </span>
          <button className="btn btn-ghost" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}
