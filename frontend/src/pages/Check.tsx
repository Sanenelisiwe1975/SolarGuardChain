import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CircleCheck, CircleHelp, OctagonAlert, ScanLine, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Scanner } from '../components/Scanner'
import { Timeline } from '../components/Timeline'
import { api, type Lookup } from '../lib/api'
import { date } from '../lib/format'

export function Check() {
  const { serial: routeSerial } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(routeSerial ?? '')
  const [scanning, setScanning] = useState(false)

  useEffect(() => { setInput(routeSerial ?? '') }, [routeSerial])

  const q = useQuery({
    queryKey: ['lookup', routeSerial?.toUpperCase()],
    queryFn: () => api.lookup(routeSerial!),
    enabled: Boolean(routeSerial),
    retry: false,
  })

  const go = (s: string) => {
    const clean = s.trim().toUpperCase()
    if (clean) navigate(`/check/${encodeURIComponent(clean)}`)
  }
  const submit = (e: FormEvent) => { e.preventDefault(); go(input) }
  const onScan = useCallback((text: string) => { setScanning(false); go(text) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <h1 className="text-2xl font-bold md:text-3xl">Check a second-hand panel</h1>
      <p className="mt-1.5 max-w-prose text-muted">
        Scan the barcode laminated under the panel's glass, or type the serial. You see the registry status and
        ownership history, never anyone's personal details.
      </p>

      <form onSubmit={submit} className="mt-5 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="serial" className="sr-only">Panel serial</label>
        <input
          id="serial"
          className="field text-lg font-semibold uppercase sm:flex-1"
          placeholder="SG-0042"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <div className="flex gap-2">
          <button className="btn-primary flex-1 sm:flex-none" disabled={!input.trim()}>Check serial</button>
          <button type="button" className="btn-quiet flex-1 sm:flex-none" onClick={() => setScanning(true)}>
            <ScanLine size={18} aria-hidden /> Scan barcode
          </button>
        </div>
      </form>

      {scanning && <Scanner onResult={onScan} onClose={() => setScanning(false)} />}

      {q.isFetching && <p className="mt-6 text-muted">Checking the registry…</p>}
      {q.isError && <p className="mt-6 font-medium text-breach">{(q.error as Error).message}</p>}
      {q.data && !q.isFetching && <Verdict result={q.data} />}
    </div>
  )
}

function Verdict({ result: r }: { result: Lookup }) {
  const view = {
    clean: {
      icon: CircleCheck,
      title: 'Clean',
      body: `No theft report. Registered ${date(r.registeredAt)} by ${r.installer}, with ${r.transfers ?? 0} recorded change${r.transfers === 1 ? '' : 's'} of owner.`,
      cls: 'bg-grid text-white',
    },
    stolen: {
      icon: OctagonAlert,
      title: 'Reported stolen',
      body: 'Do not buy this panel. Keep the seller\'s details and report them to SAPS.',
      cls: 'bg-breach text-white',
    },
    unregistered: {
      icon: CircleHelp,
      title: 'Not registered',
      body: 'This serial is not in the registry. Ask the seller for proof of purchase or an installation certificate before you pay.',
      cls: 'bg-frame text-white',
    },
  }[r.result]
  const Icon = view.icon

  return (
    <section className="mt-6" aria-live="polite">
      <div className={clsx('rounded-2xl px-5 py-6 md:px-8 md:py-8', view.cls)}>
        <div className="flex items-center gap-3">
          <Icon size={34} aria-hidden />
          <p className="text-4xl font-extrabold md:text-5xl" style={{ fontStretch: '125%' }}>{view.title}</p>
        </div>
        <p className="mt-1 text-lg font-semibold opacity-90">{r.serial}{r.model ? `, ${r.model}` : ''}</p>
        <p className="mt-3 max-w-prose text-[17px] leading-relaxed">{view.body}</p>
      </div>

      {r.registry && (
        <p className={clsx('mt-3 flex items-center gap-2 text-sm', r.verifiedOnRegistry ? 'text-muted' : 'font-medium text-breach')}>
          {r.verifiedOnRegistry ? <ShieldCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
          {r.verifiedOnRegistry
            ? `Verdict read directly from the registry (${r.registry}), not from SolarGuard's own database.`
            : `The registry (${r.registry}) could not be reached. This result comes from SolarGuard's copy; check again later.`}
        </p>
      )}

      {r.history.length > 0 && (
        <div className="mt-5 rounded-2xl border border-rule bg-sheet p-5 md:p-7">
          <h2 className="text-lg font-bold">Registry history</h2>
          <p className="mb-5 mt-1 text-sm text-muted">Owners appear as anonymous IDs. Source: {r.registry}.</p>
          <Timeline events={r.history} />
        </div>
      )}
    </section>
  )
}
