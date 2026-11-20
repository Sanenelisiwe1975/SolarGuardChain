import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { RegistryBadge, SensorBadge } from '../components/Badges'
import { PanelPhoto } from '../components/PanelPhoto'
import { Timeline } from '../components/Timeline'
import { useToast } from '../components/Toast'
import { api, type Panel } from '../lib/api'
import { ago, date } from '../lib/format'

export function PanelDetail() {
  const { serial = '' } = useParams()
  const q = useQuery({ queryKey: ['panel', serial], queryFn: () => api.panel(serial) })

  if (q.isLoading) return <p className="text-muted">Loading {serial}…</p>
  if (q.isError || !q.data)
    return (
      <div>
        <p className="font-semibold">Panel {serial} is not in your fleet.</p>
        <Link to="/" className="btn-quiet mt-4">Back to panels</Link>
      </div>
    )

  const p = q.data
  return (
    <div>
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-frame">
        <ArrowLeft size={16} aria-hidden /> Panels
      </Link>

      <section className="mt-4 grid gap-6 rounded-2xl border border-rule bg-sheet p-5 md:grid-cols-[340px_1fr] md:p-7">
        <div className="flex items-center justify-center rounded-xl bg-silicon p-4">
          <PanelPhoto state={p.sensorState} status={p.status} tilt={p.tilt} serial={p.serial} size="lg" />
        </div>
        <div>
          <h1 className="text-3xl font-bold md:text-4xl">{p.serial}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <RegistryBadge status={p.status} />
            <SensorBadge state={p.sensorState} />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[15px]">
            <Fact term="Owner" value={p.ownerName} />
            <Fact term="Contact" value={p.ownerContact} />
            <Fact term="Location" value={p.area} />
            <Fact term="Model" value={p.model || 'Not recorded'} />
            <Fact term="Installed by" value={p.installer} />
            <Fact term="Registered" value={date(p.registeredAt)} />
            <Fact term="Last signal" value={ago(p.lastSeen)} />
            <Fact term="Owner ID on registry" value={p.ownerHash} />
          </dl>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="rounded-2xl border border-rule bg-sheet p-5 md:p-7">
          <h2 className="text-xl font-bold">Ownership history</h2>
          <p className="mb-5 mt-1 text-sm text-muted">
            Every change is written to the registry. Names and phone numbers stay off it.
          </p>
          <Timeline events={p.history ?? []} />
        </section>
        <Actions panel={p} />
      </div>
    </div>
  )
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  )
}

function Actions({ panel }: { panel: Panel }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [mode, setMode] = useState<'none' | 'stolen' | 'transfer'>('none')
  const [caseRef, setCaseRef] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')

  const done = (p: Panel, msg: string) => {
    qc.setQueryData(['panel', p.serial], p)
    qc.invalidateQueries({ queryKey: ['panels'] })
    qc.invalidateQueries({ queryKey: ['stats'] })
    setMode('none')
    toast(msg, 'success')
  }
  const fail = (e: Error) => toast(e.message, 'error')

  const stolen = useMutation({
    mutationFn: () => api.reportStolen(panel.serial, caseRef),
    onSuccess: (p) => done(p, `${p.serial} reported stolen`),
    onError: fail,
  })
  const recover = useMutation({
    mutationFn: () => api.recover(panel.serial),
    onSuccess: (p) => done(p, `${p.serial} marked recovered`),
    onError: fail,
  })
  const transfer = useMutation({
    mutationFn: () => api.transfer(panel.serial, { newOwnerName: name, newOwnerContact: contact }),
    onSuccess: (p) => { setName(''); setContact(''); done(p, `${p.serial} transferred to ${p.ownerName}`) },
    onError: fail,
  })

  const submitStolen = (e: FormEvent) => { e.preventDefault(); stolen.mutate() }
  const submitTransfer = (e: FormEvent) => { e.preventDefault(); transfer.mutate() }

  return (
    <section className="h-fit rounded-2xl border border-rule bg-sheet p-5 md:p-7">
      <h2 className="text-xl font-bold">Actions</h2>

      {panel.status === 'stolen' ? (
        <div className="mt-4">
          <p className="text-[15px] text-muted">
            Anyone who checks this serial is told not to buy it. Mark it recovered once it is back on your roof.
          </p>
          <button className="btn-quiet mt-4 w-full" onClick={() => recover.mutate()} disabled={recover.isPending}>
            {recover.isPending ? 'Writing to registry…' : 'Mark recovered'}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {mode !== 'stolen' && (
            <button className="btn-danger w-full" onClick={() => setMode('stolen')}>Report stolen</button>
          )}
          {mode === 'stolen' && (
            <form onSubmit={submitStolen} className="rounded-xl bg-breach-soft p-4">
              <label className="label text-breach" htmlFor="case">SAPS case number (optional)</label>
              <input id="case" className="field" placeholder="CAS 123/11/2026" value={caseRef} onChange={(e) => setCaseRef(e.target.value)} />
              <div className="mt-3 flex gap-2">
                <button className="btn-danger flex-1" disabled={stolen.isPending}>
                  {stolen.isPending ? 'Writing to registry…' : 'Report stolen'}
                </button>
                <button type="button" className="btn-quiet" onClick={() => setMode('none')}>Cancel</button>
              </div>
            </form>
          )}

          {mode !== 'transfer' && (
            <button className="btn-quiet w-full" onClick={() => setMode('transfer')}>Transfer ownership</button>
          )}
          {mode === 'transfer' && (
            <form onSubmit={submitTransfer} className="space-y-3 rounded-xl bg-silicon p-4">
              <div>
                <label className="label" htmlFor="nn">New owner's name</label>
                <input id="nn" className="field" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="nc">New owner's phone or email</label>
                <input id="nc" className="field" required minLength={3} value={contact} onChange={(e) => setContact(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button className="btn-primary flex-1" disabled={transfer.isPending}>
                  {transfer.isPending ? 'Writing to registry…' : 'Transfer ownership'}
                </button>
                <button type="button" className="btn-quiet" onClick={() => setMode('none')}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      <Link to={`/check/${panel.serial}`} className="mt-5 block text-sm font-medium text-cell underline underline-offset-2">
        See what a buyer sees for this serial
      </Link>
    </section>
  )
}
