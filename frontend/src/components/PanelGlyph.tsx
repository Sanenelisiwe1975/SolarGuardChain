import clsx from 'clsx'
import type { PanelStatus, SensorState } from '../lib/api'

interface Props {
  state: SensorState
  status: PanelStatus
  tilt?: number | null
  size?: 'sm' | 'lg'
  className?: string
}

const COLS = 10
const ROWS = 6

/** A solar panel drawn as its photovoltaic cells. Colour and pose follow the
 *  live sensor state: it sways in wind, lifts toward you when moved, greys out
 *  when silent, and turns red when the registry says stolen. */
export function PanelGlyph({ state, status, tilt, size = 'sm', className }: Props) {
  const stolen = status === 'stolen'
  const moving = state === 'theft'
  const silent = state === 'signal_lost' || state === 'offline_outage'

  const cell = stolen || moving ? '#C8102E' : silent || state === 'no_sensor' ? '#9AA6B6' : '#1F3A68'
  const cellAlt = stolen || moving ? '#E04A5F' : silent || state === 'no_sensor' ? '#B4BECB' : '#2C4E86'
  const frame = stolen || moving || state === 'signal_lost' ? '#C8102E' : '#8B97A8'

  const lift = moving ? Math.min(Math.max(tilt ?? 30, 18), 55) : 0
  const w = size === 'lg' ? 320 : 64
  const cw = 100 / COLS
  const ch = 60 / ROWS

  return (
    <div
      className={clsx('relative shrink-0', className)}
      style={{ width: w, perspective: size === 'lg' ? 700 : 200 }}
      role="img"
      aria-label={`Panel ${stolen ? 'reported stolen' : 'registered clean'}, sensor ${state.replace('_', ' ')}`}
    >
      <div
        className={clsx('panel-3d', state === 'wind' && 'panel-gust', moving && 'alarm-pulse')}
        style={{ transform: `rotateX(${lift}deg) translateY(${lift ? -4 : 0}px)`, transformOrigin: '50% 100%' }}
      >
        <svg viewBox="-2 -2 104 64" className="block w-full h-auto drop-shadow-[0_6px_10px_rgba(27,36,48,0.18)]">
          <rect x="-1.5" y="-1.5" width="103" height="63" rx="2.5" fill="#E6EAF0" stroke={frame} strokeWidth="1.5" />
          {Array.from({ length: ROWS * COLS }, (_, i) => {
            const r = Math.floor(i / COLS)
            const c = i % COLS
            return (
              <rect
                key={i}
                x={c * cw + 0.6}
                y={r * ch + 0.6}
                width={cw - 1.2}
                height={ch - 1.2}
                rx="0.6"
                fill={(r + c) % 2 ? cellAlt : cell}
              />
            )
          })}
          {/* busbars */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2="100" y1={60 * f} y2={60 * f} stroke="#E6EAF0" strokeWidth="0.35" opacity="0.6" />
          ))}
          {stolen && (
            <g stroke="#FFFFFF" strokeWidth="1.2" opacity="0.85">
              <line x1="4" y1="4" x2="96" y2="56" />
              <line x1="96" y1="4" x2="4" y2="56" />
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}
