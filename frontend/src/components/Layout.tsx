import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bell, LayoutGrid, PlusSquare, ScanLine, Smartphone, SlidersHorizontal } from 'lucide-react'
import { useCallback } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { api } from '../lib/api'
import { useLiveUpdates } from '../lib/live'
import { useToast } from './Toast'

const nav = [
  { to: '/', label: 'Fleet', icon: LayoutGrid, end: true },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/check', label: 'Check a panel', short: 'Check', icon: ScanLine },
  { to: '/register', label: 'Register', icon: PlusSquare },
  { to: '/sensor', label: 'Phone sensor', short: 'Sensor', icon: Smartphone },
]

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" className="size-8" />
      <span className="text-lg font-bold" style={{ fontStretch: '120%' }}>SolarGuard</span>
    </div>
  )
}

export function Layout() {
  const toast = useToast()
  const onAlert = useCallback((title: string) => toast(title, 'alarm'), [toast])
  const connected = useLiveUpdates(onAlert)
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const open = stats?.openAlerts ?? 0

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-sheet px-4 py-5 md:flex">
        <Brand />
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx('flex items-center gap-3 rounded-lg px-3 py-2.5 font-medium', isActive ? 'bg-cell text-white' : 'text-frame hover:bg-silicon')
              }
            >
              <Icon size={19} aria-hidden />
              <span className="flex-1">{label}</span>
              {to === '/alerts' && open > 0 && (
                <span className="rounded-full bg-breach px-2 text-xs font-bold leading-5 text-white">{open}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <NavLink to="/demo" className="flex items-center gap-2 text-sm text-muted hover:text-frame">
            <SlidersHorizontal size={16} aria-hidden /> Demo controls
          </NavLink>
          <RegistryLine label={stats?.registry.label} connected={connected} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-rule bg-sheet/95 px-4 py-3 backdrop-blur md:hidden">
        <Brand />
        <NavLink to="/demo" aria-label="Demo controls" className="rounded-lg p-2 text-muted hover:bg-silicon">
          <SlidersHorizontal size={20} />
        </NavLink>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-rule bg-sheet md:hidden">
        {nav.map(({ to, label, short, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              clsx('relative flex flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-medium', isActive ? 'text-cell' : 'text-muted')
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx('absolute top-0 h-0.5 w-8 rounded-full', isActive ? 'bg-sun' : 'bg-transparent')} />
                <Icon size={22} aria-hidden />
                {short ?? label}
                {to === '/alerts' && open > 0 && (
                  <span className="absolute right-[22%] top-1.5 rounded-full bg-breach px-1.5 text-[10px] font-bold leading-4 text-white">{open}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function RegistryLine({ label, connected }: { label?: string; connected: boolean }) {
  return (
    <div className="rounded-lg bg-silicon px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2">
        <span className={clsx('size-2 rounded-full', connected ? 'bg-grid' : 'bg-muted')} aria-hidden />
        <span className="font-medium">{connected ? 'Live' : 'Reconnecting'}</span>
      </div>
      <p className="mt-0.5 text-muted">Registry: {label ?? '…'}</p>
    </div>
  )
}
