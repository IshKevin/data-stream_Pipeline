import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { isStaff, useAuth } from '../auth'
import { useOnline } from '../lib/hooks'
import { subscribeToEvents } from '../lib/sse'
import { APP_NAME } from '../lib/hooks'
import { BrandMark, Icon } from './Icon'
import { RoleBadge } from './ui'

export function Layout() {
  const { user, logout } = useAuth()
  const queryClient = useQueryClient()
  const online = useOnline()
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const [live, setLive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

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

  // On navigation: close the mobile menu and move focus to the page content (keyboard / screen-reader users).
  useEffect(() => {
    setMenuOpen(false)
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  if (!user) return null
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {!online && (
        <div className="banner-offline" role="status">
          <span className="offline-banner-inner">
            <Icon name="wifi-off" size={16} />
            You are offline – changes will not be saved until the connection returns.
          </span>
        </div>
      )}
      <header className={`topbar ${menuOpen ? 'topbar-open' : ''}`}>
        <div className="topbar-inner">
          <Link to="/requests" className="brand">
            <BrandMark />
            {APP_NAME}
          </Link>
          <button
            className="btn btn-ghost menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} />
            {menuOpen ? 'Close' : 'Menu'}
          </button>
          <nav className="nav" id="primary-nav" aria-label="Main">
            <NavLink to="/requests">
              <Icon name="list" />
              Requests
            </NavLink>
            {isStaff(user) && (
              <NavLink to="/analytics">
                <Icon name="bar-chart" />
                Analytics
              </NavLink>
            )}
            {isStaff(user) && (
              <NavLink to="/import">
                <Icon name="upload" />
                Import
              </NavLink>
            )}
            {user.role === 'admin' && (
              <NavLink to="/users">
                <Icon name="users" />
                Users
              </NavLink>
            )}
          </nav>
          <div className="topbar-end">
            <span className={`live ${live ? 'live-on' : ''}`} role="status">
              <span className="dot" aria-hidden="true" />
              {live ? 'Live' : 'Offline'}
              <span className="sr-only">{live ? ' – live updates connected' : ' – reconnecting'}</span>
            </span>
            <span className="who">
              <span>{user.name}</span>
              <RoleBadge role={user.role} />
            </span>
            <button className="btn btn-small" onClick={logout}>
              <Icon name="log-out" size={16} />
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="container" id="main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
    </>
  )
}
