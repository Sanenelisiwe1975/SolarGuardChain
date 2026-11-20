import { useQuery } from '@tanstack/react-query'
import { OctagonAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { RegistryBadge, SensorBadge } from '../components/Badges'
import { PanelGlyph } from '../components/PanelGlyph'
import { api } from '../lib/api'
import { ago } from '../lib/format'

export function Fleet() {
  const panels = useQuery({ queryKey: ['panels'], queryFn: api.panels })
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const s = stats.data

  return (
    <div>
      <h1 className="text-2xl font-bold md:text-3xl">Your panels</h1>
      {s && (
        <p className="mt-1.5 text-muted">
          {s.panels} registered, {s.monitored} with a live sensor
          {s.stolen > 0 && <>, {s.stolen} reported stolen</>}.
        </p>
      )}

      {s && s.openAlerts > 0 && (
        <Link
          to="/alerts"
          className="mt-5 flex items-center gap-3 rounded-xl bg-breach px-4 py-3.5 text-white hover:bg-[#A50D26]"
        >
          <OctagonAlert className="alarm-pulse shrink-0" aria-hidden />
          <span className="flex-1 font-semibold">
            {s.openAlerts === 1 ? '1 alert needs your decision' : `${s.openAlerts} alerts need your decision`}
          </span>
          <span className="text-sm underline underline-offset-2">Review</span>
        </Link>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-rule bg-sheet">
        <div className="hidden grid-cols-[88px_1.2fr_1fr_1fr_110px] gap-4 border-b border-rule px-5 py-2.5 text-sm text-muted md:grid">
          <span />
          <span>Panel</span>
          <span>Registry</span>
          <span>Sensor</span>
          <span className="text-right">Last signal</span>
        </div>

        {panels.isLoading && <p className="p-5 text-muted">Loading panels…</p>}
        {panels.isError && <p className="p-5 text-breach">Could not load panels. Check that the API is running.</p>}
        {panels.data?.length === 0 && (
          <div className="p-6">
            <p className="font-medium">No panels yet.</p>
            <Link to="/register" className="btn-primary mt-3">Register a panel</Link>
          </div>
        )}

        <ul>
          {panels.data?.map((p) => (
            <li key={p.serial} className="border-b border-rule last:border-0">
              <Link
                to={`/panels/${p.serial}`}
                className="grid grid-cols-[64px_1fr] items-center gap-x-4 gap-y-2 px-4 py-4 hover:bg-silicon/60 md:grid-cols-[88px_1.2fr_1fr_1fr_110px] md:px-5"
              >
                <PanelGlyph state={p.sensorState} status={p.status} tilt={p.tilt} />
                <div className="min-w-0">
                  <p className="text-lg font-bold" style={{ fontStretch: '115%' }}>{p.serial}</p>
                  <p className="truncate text-sm text-muted">{p.ownerName}, {p.area}</p>
                </div>
                <div className="col-start-2 flex flex-wrap gap-2 md:col-start-auto md:block">
                  <RegistryBadge status={p.status} />
                  <span className="md:hidden"><SensorBadge state={p.sensorState} /></span>
                </div>
                <div className="hidden md:block"><SensorBadge state={p.sensorState} /></div>
                <p className="hidden text-right text-sm text-muted md:block">{ago(p.lastSeen)}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
