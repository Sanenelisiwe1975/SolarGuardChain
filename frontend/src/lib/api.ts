export type PanelStatus = 'clean' | 'stolen'
export type SensorState = 'no_sensor' | 'normal' | 'wind' | 'theft' | 'offline_outage' | 'signal_lost'

export interface LedgerEvent {
  id: number
  kind: 'registered' | 'transferred' | 'reported_stolen' | 'recovered'
  detail: string
  fromOwner: string | null
  toOwner: string | null
  txHash: string
  explorerUrl: string | null
  actor: string
  ts: number
}

export interface Panel {
  serial: string
  ownerName: string
  ownerContact: string
  ownerHash: string
  installer: string
  area: string
  model: string
  status: PanelStatus
  monitored: boolean
  sensorState: SensorState
  tilt: number | null
  rms: number | null
  lastSeen: number | null
  registeredAt: number
  updatedAt: number
  openAlerts: number
  history?: LedgerEvent[]
}

export interface Alert {
  id: number
  serial: string
  kind: 'movement' | 'signal_lost'
  severity: 'high' | 'medium' | 'low'
  title: string
  message: string
  context: string
  status: 'open' | 'confirmed' | 'dismissed'
  createdAt: number
  resolvedAt: number | null
  area: string | null
  ownerName: string | null
  panelStatus: PanelStatus | null
}

export interface RegistryInfo {
  mode: 'local' | 'fuji'
  label: string
  network: string
  contractAddress: string | null
  explorerUrl: string | null
  entries?: number
  intact?: boolean
}

export interface Stats {
  panels: number
  monitored: number
  stolen: number
  openAlerts: number
  registry: RegistryInfo
}

export interface Lookup {
  serial: string
  result: 'clean' | 'stolen' | 'unregistered'
  installer?: string
  model?: string
  registeredAt?: number
  transfers?: number
  currentOwner?: string
  history: LedgerEvent[]
  registry?: string
  verifiedOnRegistry?: boolean
  matchesRegistry?: boolean
}

export interface Outage { area: string; active: boolean }

export interface User { id: number; name: string; contact: string; ownerId: string }

export interface TransferOffer {
  id: number
  serial: string
  model: string
  fromName: string | null
  toName: string | null
  toContact: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled'
  createdAt: number
  resolvedAt: number | null
}

export interface Me {
  user: User
  panels: Panel[]
  incoming: TransferOffer[]
  outgoing: TransferOffer[]
}

/* The session token lives in this browser only. Storage can be blocked
   (private windows, cleared site data), so every access is guarded. */
const TOKEN_KEY = 'solarguard.token'
let token: string | null = null
try { token = localStorage.getItem(TOKEN_KEY) } catch { /* not available */ }

export function getToken() { return token }
export function setToken(t: string | null) {
  token = t
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* not available */ }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join('. ')
    } catch { /* keep default */ }
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  stats: () => request<Stats>('/stats'),
  panels: () => request<Panel[]>('/panels'),
  panel: (serial: string) => request<Panel>(`/panels/${encodeURIComponent(serial)}`),
  lookup: (serial: string) => request<Lookup>(`/lookup/${encodeURIComponent(serial)}`),
  alerts: (status?: string) => request<Alert[]>(`/alerts${status ? `?status=${status}` : ''}`),
  register: (body: { serial: string; ownerName: string; ownerContact: string; installer: string; area: string; model: string }) =>
    post<Panel>('/panels', body),
  transfer: (serial: string, body: { newOwnerName: string; newOwnerContact: string }) =>
    post<Panel>(`/panels/${encodeURIComponent(serial)}/transfer`, body),
  reportStolen: (serial: string, caseRef: string) =>
    post<Panel>(`/panels/${encodeURIComponent(serial)}/report-stolen`, { caseRef }),
  recover: (serial: string) => post<Panel>(`/panels/${encodeURIComponent(serial)}/recover`),
  confirmAlert: (id: number, caseRef = '') => post<Alert>(`/alerts/${id}/confirm`, { caseRef }),
  dismissAlert: (id: number) => post<Alert>(`/alerts/${id}/dismiss`),
  sensorEvent: (body: Record<string, unknown>) => post<{ state: string; alert: Alert | null }>('/sensor/events', body),
  outages: () => request<Outage[]>('/demo/outages'),
  setOutage: (area: string, active: boolean) => post<Outage[]>('/demo/outages', { area, active }),
  reset: () => post<{ ok: boolean }>('/demo/reset'),

  signup: (body: { name: string; contact: string; password: string }) =>
    post<{ token: string; user: User }>('/auth/signup', body),
  login: (body: { contact: string; password: string }) =>
    post<{ token: string; user: User }>('/auth/login', body),
  logout: () => post<{ ok: boolean }>('/auth/logout'),
  me: () => request<Me>('/me'),
  offerTransfer: (serial: string, toContact: string) =>
    post<Me>(`/me/panels/${encodeURIComponent(serial)}/transfer`, { toContact }),
  acceptTransfer: (id: number) => post<Me>(`/me/transfers/${id}/accept`),
  declineTransfer: (id: number) => post<Me>(`/me/transfers/${id}/decline`),
  cancelTransfer: (id: number) => post<Me>(`/me/transfers/${id}/cancel`),
}
