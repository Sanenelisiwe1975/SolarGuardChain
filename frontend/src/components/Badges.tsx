import clsx from 'clsx'
import { CircleCheck, OctagonAlert, Radio, RadioTower, WifiOff, Wind } from 'lucide-react'
import type { PanelStatus, SensorState } from '../lib/api'
import { sensorCopy } from '../lib/format'

const tones = {
  ok: 'bg-grid-soft text-grid',
  warn: 'bg-gust-soft text-gust',
  bad: 'bg-breach-soft text-breach',
  idle: 'bg-[#E6EAF0] text-muted',
}

export function RegistryBadge({ status }: { status: PanelStatus }) {
  const stolen = status === 'stolen'
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-semibold', stolen ? tones.bad : tones.ok)}>
      {stolen ? <OctagonAlert size={15} aria-hidden /> : <CircleCheck size={15} aria-hidden />}
      {stolen ? 'Reported stolen' : 'Clean'}
    </span>
  )
}

const sensorIcon: Record<SensorState, typeof Radio> = {
  no_sensor: Radio,
  normal: RadioTower,
  wind: Wind,
  theft: OctagonAlert,
  offline_outage: WifiOff,
  signal_lost: WifiOff,
}

export function SensorBadge({ state }: { state: SensorState }) {
  const { label, tone } = sensorCopy[state]
  const Icon = sensorIcon[state]
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-medium', tones[tone])}>
      <Icon size={15} aria-hidden />
      {label}
    </span>
  )
}
