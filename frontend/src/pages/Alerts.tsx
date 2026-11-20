import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { OctagonAlert, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { api, type Alert } from '../lib/api'
import { ago } from '../lib/format'

export function Alerts() {
  const q = useQuery({ queryKey: ['alerts'], queryFn: () => api.alerts() })
  const open = q.data?.filter((a) => a.status === 'open') ?? []
  const resolved = q.data?.filter((a) => a.status !== 'open') ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold md:text-3xl">Alerts</h1>
      <p className="mt-1.5 text-muted">
        Wind and power outages are filtered out before anything reaches you. Confirm a real theft to report it stolen.
      </p>

      {q.isLoading && <p className="mt-6 text-muted">Loading alerts…</p>}

      <div className="mt-6 space-y-4">
        {!q.isLoading && open.length === 0 && (
          <div className="rounded-xl border border-rule bg-sheet p-5">
            <p className="font-semibold">All clear.</p>
            <p className="text-muted">Lift a panel with the phone sensor running to see an alert arrive here.</p>
          </div>
        )}
        {open.map((a) => <OpenAlert key={a.id} alert={a} />)}
      </div>

      {resolved.length > 0 && (
        <>
          <h2 className="mt-10 text-lg font-bold">Resolved</h2>
          <ul className="mt-3 divide-y divide-rule rounded-xl border border-rule bg-sheet">
            {resolved.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-sm text-muted">{ago(a.createdAt)}</p>
                </div>
                <span className={clsx('rounded-md px-2 py-0.5 text-sm font-medium',
                  a.status === 'confirmed' ? 'bg-breach-soft text-breach' : 'bg-[#E6EAF0] text-muted')}>
                  {a.status === 'confirmed' ? 'Reported stolen' : 'False alarm'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function OpenAlert({ alert: a }: { alert: Alert }) {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['alerts'] })
    qc.invalidateQueries({ queryKey: ['panels'] })
    qc.invalidateQueries({ queryKey: ['panel', a.serial] })
    qc.invalidateQueries({ queryKey: ['stats'] })
  }
  const confirm = useMutation({
    mutationFn: () => api.confirmAlert(a.id),
    onSuccess: () => { refresh(); toast(`${a.serial} reported stolen`, 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const dismiss = useMutation({
    mutationFn: () => api.dismissAlert(a.id),
    onSuccess: () => { refresh(); toast('Marked as a false alarm', 'info') },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const Icon = a.kind === 'movement' ? OctagonAlert : WifiOff
  const busy = confirm.isPending || dismiss.isPending

  return (
    <article className="overflow-hidden rounded-xl border-2 border-breach bg-sheet">
      <div className="flex items-start gap-3 bg-breach-soft px-4 py-3.5 md:px-5">
        <Icon className="mt-0.5 shrink-0 text-breach" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-breach" style={{ fontStretch: '110%' }}>{a.title}</h2>
          <p className="text-sm text-muted">{a.ownerName}, {a.area}, {ago(a.createdAt)}</p>
        </div>
      </div>
      <div className="px-4 py-4 md:px-5">
        <p className="text-[15px] leading-relaxed">{a.message}</p>
        {a.context && <p className="mt-2 text-sm text-muted">Checked: {a.context}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button className="btn-danger sm:flex-1" onClick={() => confirm.mutate()} disabled={busy}>
            {confirm.isPending ? 'Writing to registry…' : 'Report stolen'}
          </button>
          <button className="btn-quiet sm:flex-1" onClick={() => dismiss.mutate()} disabled={busy}>
            False alarm
          </button>
          <Link to={`/panels/${a.serial}`} className="btn-quiet">View panel</Link>
        </div>
      </div>
    </article>
  )
}
