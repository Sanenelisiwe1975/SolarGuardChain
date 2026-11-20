import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { PanelGlyph } from '../components/PanelGlyph'
import { api, type SensorState } from '../lib/api'

/* Thresholds mirror the server's classifier (backend/app/intelligence.py). */
const WINDOW_MS = 1000
const TILT_THEFT_DEG = 25
const RMS_WIND = 0.6
const RMS_THEFT = 2.5
const SUSTAIN_MS = 1500
const HEARTBEAT_MS = 2000

type Local = 'normal' | 'wind' | 'theft'
interface Sample { t: number; gx: number; gy: number; gz: number; ax: number; ay: number; az: number }
interface Row extends Sample { label: string }

const copy: Record<Local, { title: string; body: string; cls: string }> = {
  normal: { title: 'Secure', body: 'Panel is still. Heartbeat is being sent.', cls: 'bg-grid text-white' },
  wind: { title: 'Wind', body: 'Shaking without lifting. No alert is raised.', cls: 'bg-sun text-frame' },
  theft: { title: 'Being moved', body: 'Lift detected. The owner is being alerted.', cls: 'bg-breach text-white' },
}

export function Sensor() {
  const panels = useQuery({ queryKey: ['panels'], queryFn: api.panels })
  const [serial, setSerial] = useState('SG-0042')
  const [running, setRunning] = useState(false)
  const [state, setState] = useState<Local>('normal')
  const [tilt, setTilt] = useState(0)
  const [rms, setRms] = useState(0)
  const [sent, setSent] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState<string | null>(null)
  const [rows, setRows] = useState(0)

  const samples = useRef<Sample[]>([])
  const baseline = useRef<{ x: number; y: number; z: number } | null>(null)
  const theftSince = useRef<number | null>(null)
  const last = useRef<Local>('normal')
  const label = useRef<string | null>(null)
  const recorded = useRef<Row[]>([])
  const serialRef = useRef(serial)
  serialRef.current = serial

  useEffect(() => {
    if (!running) return

    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity
      const a = e.acceleration
      if (!g || g.x === null || g.y === null || g.z === null) return
      const s: Sample = { t: Date.now(), gx: g.x, gy: g.y, gz: g.z, ax: a?.x ?? 0, ay: a?.y ?? 0, az: a?.z ?? 0 }
      if (!baseline.current) baseline.current = { x: g.x, y: g.y, z: g.z }
      samples.current.push(s)
      if (label.current) recorded.current.push({ ...s, label: label.current })
    }

    const send = (body: Record<string, unknown>) =>
      api.sensorEvent({ serial: serialRef.current, ...body })
        .then(() => { setSent((n) => n + 1); setError(null) })
        .catch((e: Error) => setError(e.message))

    const tick = window.setInterval(() => {
      const now = Date.now()
      samples.current = samples.current.filter((s) => now - s.t < WINDOW_MS)
      const b = baseline.current
      const lastS = samples.current[samples.current.length - 1]
      if (!b || !lastS) return

      const dot = lastS.gx * b.x + lastS.gy * b.y + lastS.gz * b.z
      const n1 = Math.hypot(lastS.gx, lastS.gy, lastS.gz)
      const n2 = Math.hypot(b.x, b.y, b.z)
      const t = (Math.acos(Math.min(1, Math.max(-1, dot / (n1 * n2)))) * 180) / Math.PI
      const r = Math.sqrt(samples.current.reduce((acc, s) => acc + s.ax ** 2 + s.ay ** 2 + s.az ** 2, 0) / samples.current.length)

      let next: Local = 'normal'
      if (t > TILT_THEFT_DEG || r > RMS_THEFT) {
        theftSince.current ??= now
        if (now - theftSince.current > SUSTAIN_MS) next = 'theft'
      } else {
        theftSince.current = null
        if (r > RMS_WIND) next = 'wind'
      }
      if (last.current === 'theft' && next !== 'theft' && t > TILT_THEFT_DEG / 2) next = 'theft'

      setTilt(t)
      setRms(r)
      if (next !== last.current) {
        send({ type: 'state_change', from: last.current, to: next, tilt: t, rms: r })
        last.current = next
        setState(next)
      }
    }, 250)

    const beat = window.setInterval(() => send({ type: 'heartbeat', state: last.current }), HEARTBEAT_MS)
    send({ type: 'heartbeat', state: 'normal' })
    window.addEventListener('devicemotion', onMotion)

    return () => {
      window.removeEventListener('devicemotion', onMotion)
      window.clearInterval(tick)
      window.clearInterval(beat)
    }
  }, [running])

  const start = async () => {
    setError(null)
    if (!window.isSecureContext) {
      setError('Motion sensors need HTTPS. Open this page through your https:// link (ngrok or a deployed URL).')
      return
    }
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }
    if (typeof DME.requestPermission === 'function') {
      const p = await DME.requestPermission()
      if (p !== 'granted') { setError('Motion access was denied. Allow it and tap Start again.'); return }
    }
    baseline.current = null
    theftSince.current = null
    last.current = 'normal'
    setState('normal')
    setRunning(true)
  }

  const stop = () => setRunning(false)

  const record = (l: string) => {
    label.current = l
    setRecording(l)
    window.setTimeout(() => {
      label.current = null
      setRecording(null)
      setRows(recorded.current.length)
    }, 10000)
  }

  const download = () => {
    const head = 't,gx,gy,gz,ax,ay,az,label\n'
    const body = recorded.current.map((s) => [s.t, s.gx, s.gy, s.gz, s.ax, s.ay, s.az, s.label].join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([head + body], { type: 'text/csv' }))
    a.download = `solarguard_training_${serial}.csv`
    a.click()
  }

  const view = copy[state]
  const glyphState: SensorState = running ? state : 'no_sensor'

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold md:text-3xl">Phone sensor</h1>
      <p className="mt-1.5 text-muted">
        Turns this phone into the panel's motion sensor. Lay it flat on the panel, keep it still for two seconds, then
        test with a fan (wind) and by lifting the panel (theft).
      </p>

      <div className="mt-5 rounded-2xl border border-rule bg-sheet p-5">
        <label className="label" htmlFor="ser">Panel this phone is attached to</label>
        <select id="ser" className="field" value={serial} onChange={(e) => setSerial(e.target.value)} disabled={running}>
          {(panels.data ?? []).map((p) => <option key={p.serial} value={p.serial}>{p.serial}, {p.area}</option>)}
        </select>
        <div className="mt-4">
          {running ? (
            <button className="btn-quiet w-full" onClick={stop}>Stop sensor</button>
          ) : (
            <button className="btn-primary w-full" onClick={start}>Start sensor</button>
          )}
        </div>
        {error && <p className="mt-3 text-sm font-medium text-breach">{error}</p>}
      </div>

      <div className={clsx('mt-4 rounded-2xl px-5 py-6 transition-colors', running ? view.cls : 'bg-[#E6EAF0] text-muted')}>
        <div className="flex items-center gap-5">
          <PanelGlyph state={glyphState} status="clean" tilt={tilt} />
          <div>
            <p className="text-3xl font-extrabold" style={{ fontStretch: '125%' }}>{running ? view.title : 'Not running'}</p>
            <p className="mt-0.5">{running ? view.body : 'Tap Start sensor to begin.'}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          <Metric term="Tilt" value={`${tilt.toFixed(0)}°`} />
          <Metric term="Shake" value={rms.toFixed(2)} />
          <Metric term="Messages sent" value={String(sent)} />
        </dl>
      </div>

      <div className="mt-4 rounded-2xl border border-rule bg-sheet p-5">
        <h2 className="font-bold">Record training data</h2>
        <p className="mt-1 text-sm text-muted">
          Each recording lasts 10 seconds. Record several of each, then download the file to tune the classifier.
          {rows > 0 && ` ${rows} samples recorded.`}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button className="btn-quiet" onClick={() => record('wind')} disabled={!running || !!recording}>
            {recording === 'wind' ? 'Recording wind…' : 'Record wind'}
          </button>
          <button className="btn-quiet" onClick={() => record('theft')} disabled={!running || !!recording}>
            {recording === 'theft' ? 'Recording theft…' : 'Record theft'}
          </button>
        </div>
        <button className="btn-quiet mt-2 w-full" onClick={download} disabled={rows === 0}>Download training data</button>
      </div>
    </div>
  )
}

function Metric({ term, value }: { term: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/10 py-2">
      <dt className="text-xs opacity-80">{term}</dt>
      <dd className="text-xl font-bold">{value}</dd>
    </div>
  )
}
