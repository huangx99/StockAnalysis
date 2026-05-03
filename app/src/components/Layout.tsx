import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'
import Footer from './Footer'
import { useIsMobile } from '@/hooks/use-mobile'

export default function Layout() {
  const location = useLocation()
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  // Close sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) setSidebarOpen(false)
  }, [isMobile])

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: 'var(--bg-base)' }}>
      <Navbar
        showMenuButton={isMobile}
        onMenuClick={() => setSidebarOpen((o) => !o)}
      />
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left sidebar: always visible on desktop, drawer on mobile */}
        {!isMobile && <Sidebar />}
        {isMobile && sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
              onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed left-0 top-[56px] bottom-0 z-50">
              <Sidebar />
            </div>
          </>
        )}

        <main className="flex-1 flex flex-col overflow-y-auto">
          <div className="flex-1">
            <Outlet />
          </div>
          <Footer />
        </main>
      </div>
    </div>
  )
}
