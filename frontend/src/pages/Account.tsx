import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRightLeft, Inbox, LogOut } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { RegistryBadge, SensorBadge } from '../components/Badges'
import { PanelGlyph } from '../components/PanelGlyph'
import { useToast } from '../components/Toast'
import { api, ApiError, getToken, setToken, type Me, type Panel, type TransferOffer } from '../lib/api'
import { ago } from '../lib/format'

export function Account() {
  const [token, setLocalToken] = useState(getToken())
  const q = useQuery({ queryKey: ['me', token], queryFn: api.me, enabled: Boolean(token), retry: false })

  const signIn = (t: string | null) => { setToken(t); setLocalToken(t) }

  // An expired or unknown session shows the login form again.
  if (!token || (q.error instanceof ApiError && q.error.status === 401)) return <AuthForm onToken={signIn} />
  if (q.isLoading) return <p className="text-muted">Loading your profile…</p>
  if (q.isError || !q.data) return <p className="text-breach">Could not load your profile. Check that the API is running.</p>

  return <Profile me={q.data} onLogout={() => signIn(null)} />
}

/* ---------- log in / create profile ---------- */

function AuthForm({ onToken }: { onToken: (t: string) => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [form, setForm] = useState({ name: '', contact: '', password: '' })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const m = useMutation({
    mutationFn: () => (mode === 'login'
      ? api.login({ contact: form.contact, password: form.password })
      : api.signup(form)),
    onSuccess: (r) => { onToken(r.token); toast(`Welcome, ${r.user.name}`, 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }

  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold md:text-3xl">{mode === 'login' ? 'Log in' : 'Create your profile'}</h1>
      <p className="mt-1.5 text-muted">
        Panels registered to your phone number or email appear here. You can hand a panel over to a new owner,
        and receive panels you buy.
      </p>

      <div className="mt-5 grid grid-cols-2 rounded-xl bg-sheet p-1 ring-1 ring-rule" role="tablist">
        {(['login', 'signup'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={clsx('rounded-lg py-2 font-medium', mode === k ? 'bg-cell text-white' : 'text-muted hover:text-frame')}
          >
            {k === 'login' ? 'Log in' : 'Create profile'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-4 space-y-4 rounded-2xl border border-rule bg-sheet p-5 md:p-7">
        {mode === 'signup' && (
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" className="field" required autoComplete="name" value={form.name} onChange={set('name')} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="contact">Phone number or email</label>
          <input id="contact" className="field" required minLength={3} autoComplete="username"
            placeholder="071 000 0042" value={form.contact} onChange={set('contact')} />
          {mode === 'signup' && (
            <p className="mt-1 text-sm text-muted">Use the number your installer registered, so your panels find you.</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" type="password" className="field" required minLength={mode === 'signup' ? 8 : 1}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password} onChange={set('password')} />
          {mode === 'signup' && <p className="mt-1 text-sm text-muted">At least 8 characters.</p>}
        </div>
        <button className="btn-primary w-full" disabled={m.isPending}>
          {m.isPending ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create profile'}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Demo profiles: 071 000 0042 (Thandi, owns two panels) and 074 000 0200 (Ayanda, a buyer). Password: solarguard
      </p>
    </div>
  )
}

/* ---------- signed in ---------- */

function useMeMutation<T>(fn: (arg: T) => Promise<Me>, success: (me: Me, arg: T) => string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: fn,
    onSuccess: (me, arg) => {
      qc.setQueryData(['me', getToken()], me)
      qc.invalidateQueries({ queryKey: ['panels'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      toast(success(me, arg), 'success')
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })
}

function Profile({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const qc = useQueryClient()
  const logout = async () => {
    try { await api.logout() } catch { /* the session is dropped locally either way */ }
    qc.removeQueries({ queryKey: ['me'] })
    onLogout()
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">{me.user.name}</h1>
          <p className="mt-1 text-muted">{me.user.contact} · Owner ID on registry {me.user.ownerId}</p>
        </div>
        <button className="btn-quiet" onClick={logout}><LogOut size={17} aria-hidden /> Log out</button>
      </div>

      {me.incoming.length > 0 && <Incoming offers={me.incoming} />}

      <h2 className="mt-8 text-xl font-bold">My panels</h2>
      {me.panels.length === 0 ? (
        <p className="mt-2 max-w-prose text-muted">
          No panels are registered to {me.user.contact} yet. When you buy a panel, give the seller this phone number
          or email so they can transfer it to you.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {me.panels.map((p) => (
            <MyPanel key={p.serial} panel={p} pending={me.outgoing.find((o) => o.serial === p.serial)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Incoming({ offers }: { offers: TransferOffer[] }) {
  const accept = useMeMutation((id: number) => api.acceptTransfer(id), (_, id) =>
    `${offers.find((o) => o.id === id)?.serial} is now registered to you`)
  const decline = useMeMutation((id: number) => api.declineTransfer(id), () => 'Transfer declined')
  const busy = accept.isPending || decline.isPending

  return (
    <section className="mt-6 rounded-2xl border-2 border-sun bg-sheet p-5 md:p-6">
      <h2 className="flex items-center gap-2 text-xl font-bold"><Inbox size={20} aria-hidden /> Panels offered to you</h2>
      <p className="mt-1 text-sm text-muted">
        Accepting writes the change of owner to the registry. Check the serial under the glass matches before you accept.
      </p>
      <ul className="mt-4 space-y-3">
        {offers.map((o) => (
          <li key={o.id} className="flex flex-col gap-3 rounded-xl bg-silicon p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-lg font-bold">{o.serial}{o.model ? <span className="font-normal text-muted">, {o.model}</span> : null}</p>
              <p className="text-sm text-muted">From {o.fromName}, {ago(o.createdAt)}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary flex-1" disabled={busy} onClick={() => accept.mutate(o.id)}>
                {accept.isPending ? 'Writing to registry…' : 'Accept'}
              </button>
              <button className="btn-quiet flex-1" disabled={busy} onClick={() => decline.mutate(o.id)}>Decline</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MyPanel({ panel: p, pending }: { panel: Panel; pending?: TransferOffer }) {
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const offer = useMeMutation(() => api.offerTransfer(p.serial, to), (me) => {
    setOpen(false); setTo('')
    const sent = me.outgoing.find((o) => o.serial === p.serial)
    return `Sent to ${sent?.toName ?? 'the new owner'}. ${p.serial} moves once they accept.`
  })
  const cancel = useMeMutation((id: number) => api.cancelTransfer(id), () => 'Transfer cancelled')
  const submit = (e: FormEvent) => { e.preventDefault(); offer.mutate(undefined) }

  return (
    <li className="rounded-xl border border-rule bg-sheet p-4">
      <div className="grid grid-cols-[64px_1fr] items-center gap-4">
        <PanelGlyph state={p.sensorState} status={p.status} tilt={p.tilt} />
        <div className="min-w-0">
          <Link to={`/panels/${p.serial}`} className="text-lg font-bold hover:underline">{p.serial}</Link>
          <p className="truncate text-sm text-muted">{p.model || 'Model not recorded'}, {p.area}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <RegistryBadge status={p.status} />
            <SensorBadge state={p.sensorState} />
          </div>
        </div>
      </div>

      {pending ? (
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-gust-soft p-3 text-[15px] sm:flex-row sm:items-center">
          <p className="flex-1">Waiting for <strong>{pending.toName}</strong> ({pending.toContact}) to accept.</p>
          <button className="btn-quiet" disabled={cancel.isPending} onClick={() => cancel.mutate(pending.id)}>Cancel transfer</button>
        </div>
      ) : p.status === 'stolen' ? (
        <p className="mt-4 text-sm text-muted">A panel reported stolen cannot change owner until it is recovered.</p>
      ) : open ? (
        <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg bg-silicon p-4">
          <div>
            <label className="label" htmlFor={`to-${p.serial}`}>New owner's phone number or email</label>
            <input id={`to-${p.serial}`} className="field" required minLength={3} value={to}
              onChange={(e) => setTo(e.target.value)} placeholder="074 000 0200" />
            <p className="mt-1 text-sm text-muted">They need a SolarGuard profile. Nothing changes until they accept.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={offer.isPending}>
              {offer.isPending ? 'Sending…' : 'Send transfer'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn-quiet mt-4 w-full sm:w-auto" onClick={() => setOpen(true)}>
          <ArrowRightLeft size={17} aria-hidden /> Transfer to a new owner
        </button>
      )}
    </li>
  )
}
