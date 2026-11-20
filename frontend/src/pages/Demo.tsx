import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ExternalLink } from 'lucide-react'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'

export function Demo() {
  const qc = useQueryClient()
  const toast = useToast()
  const outages = useQuery({ queryKey: ['outages'], queryFn: api.outages })
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const reg = stats.data?.registry

  const toggle = useMutation({
    mutationFn: ({ area, active }: { area: string; active: boolean }) => api.setOutage(area, active),
    onSuccess: (data) => qc.setQueryData(['outages'], data),
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const reset = useMutation({
    mutationFn: api.reset,
    onSuccess: () => { qc.invalidateQueries(); toast('Demo data restored', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const sensorUrl = `${window.location.origin}/sensor`

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">Demo controls</h1>
        <p className="mt-1.5 text-muted">For running the pitch. Not part of the product.</p>
      </div>

      <section className="rounded-2xl border border-rule bg-sheet p-5">
        <h2 className="font-bold">Power outages</h2>
        <p className="mt-1 text-sm text-muted">
          Switch an area's outage on, then cut the sensor (airplane mode). With an outage the panel goes quietly
          offline; without one, the owner gets a signal-lost alert.
        </p>
        <ul className="mt-4 divide-y divide-rule">
          {outages.data?.map((o) => (
            <li key={o.area} className="flex items-center justify-between py-3">
              <span className="font-medium">{o.area}</span>
              <button
                role="switch"
                aria-checked={o.active}
                aria-label={`Power outage in ${o.area}`}
                onClick={() => toggle.mutate({ area: o.area, active: !o.active })}
                className={clsx('relative h-7 w-12 rounded-full transition-colors', o.active ? 'bg-breach' : 'bg-rule')}
              >
                <span className={clsx('absolute top-1 size-5 rounded-full bg-white transition-all', o.active ? 'left-6' : 'left-1')} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-rule bg-sheet p-5">
        <h2 className="font-bold">Registry</h2>
        {reg && (
          <dl className="mt-3 space-y-2 text-[15px]">
            <div><dt className="text-sm text-muted">Network</dt><dd className="font-medium">
              {reg.network}
              {reg.chainId != null && <span className="font-normal text-muted"> · chain ID {reg.chainId}</span>}
            </dd></div>
            {reg.contractAddress && (
              <div>
                <dt className="text-sm text-muted">Contract</dt>
                <dd>
                  <a href={reg.explorerUrl ?? '#'} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 break-all font-medium text-cell underline underline-offset-2">
                    {reg.contractAddress} <ExternalLink size={13} aria-hidden />
                  </a>
                </dd>
              </div>
            )}
            {reg.mode === 'local' && (
              <div>
                <dt className="text-sm text-muted">Hash chain</dt>
                <dd className={clsx('font-medium', reg.intact ? 'text-grid' : 'text-breach')}>
                  {reg.entries} entries, {reg.intact ? 'intact' : 'tampering detected'}
                </dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-rule bg-sheet p-5">
        <h2 className="font-bold">Phone sensor link</h2>
        <p className="mt-1 text-sm text-muted">Open this on the phone taped to the panel. It must start with https.</p>
        <p className="mt-2 break-all rounded-lg bg-silicon px-3 py-2 font-medium">{sensorUrl}</p>
      </section>

      <section className="rounded-2xl border border-rule bg-sheet p-5">
        <h2 className="font-bold">Restore demo data</h2>
        <p className="mt-1 text-sm text-muted">Puts back the four demo panels and clears alerts. Local ledger only.</p>
        <button className="btn-quiet mt-3" onClick={() => reset.mutate()} disabled={reset.isPending}>
          {reset.isPending ? 'Restoring…' : 'Restore demo data'}
        </button>
      </section>
    </div>
  )
}
