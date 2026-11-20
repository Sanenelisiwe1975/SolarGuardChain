import type { SensorState } from './api'

const rtf = new Intl.RelativeTimeFormat('en-ZA', { numeric: 'auto' })

export function ago(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const s = Math.round(ts - Date.now() / 1000)
  const abs = Math.abs(s)
  if (abs < 10) return 'just now'
  if (abs < 60) return `${abs} seconds ago`
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 45) return rtf.format(Math.round(s / 86400), 'day')
  return date(ts)
}

export function date(ts: number | null | undefined): string {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function shortHash(h: string): string {
  return h.length > 16 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h
}

export const sensorCopy: Record<SensorState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = {
  no_sensor: { label: 'No sensor', tone: 'idle' },
  normal: { label: 'Secure', tone: 'ok' },
  wind: { label: 'Wind, no risk', tone: 'warn' },
  theft: { label: 'Being moved', tone: 'bad' },
  offline_outage: { label: 'Offline, power outage', tone: 'idle' },
  signal_lost: { label: 'Signal lost', tone: 'bad' },
}

export const eventCopy: Record<string, string> = {
  registered: 'Registered',
  transferred: 'Ownership transferred',
  reported_stolen: 'Reported stolen',
  recovered: 'Recovered',
}
