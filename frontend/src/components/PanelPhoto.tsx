import clsx from 'clsx'
import type { PanelStatus, SensorState } from '../lib/api'
import { photoForSerial } from '../lib/panelPhotos'

interface Props {
  state: SensorState
  status: PanelStatus
  /** Panel serial; picks the photo via lib/panelPhotos so it matches on every page. */
  serial: string
  tilt?: number | null
  size?: 'sm' | 'lg'
  className?: string
}

/** A real photo of the panel whose frame and motion follow the live state:
 *  sways in wind, shakes and pulses red when theft is detected, greys out when
 *  the sensor is silent, and carries a red border and badge when stolen. */
export function PanelPhoto({ state, status, serial, tilt, size = 'sm', className }: Props) {
  const photo = photoForSerial(serial)
  const stolen = status === 'stolen'
  const moving = state === 'theft'
  const silent = state === 'signal_lost' || state === 'offline_outage'
  const lg = size === 'lg'
  const lift = moving ? Math.min(Math.max(tilt ?? 30, 18), 55) : 0

  return (
    <div
      className={clsx('relative shrink-0', lg ? 'h-60 w-full' : 'h-20 w-24', className)}
      style={{ perspective: lg ? 900 : 300 }}
      role="img"
      aria-label={`Panel ${stolen ? 'reported stolen' : 'registered clean'}, sensor ${state.replace('_', ' ')}`}
    >
      <div
        className={clsx(
          'panel-3d h-full w-full',
          state === 'wind' && 'panel-gust',
          moving && 'panel-shake',
        )}
        style={{ transform: `rotateX(${lift / 2}deg)`, transformOrigin: '50% 100%' }}
      >
        <div
          className={clsx(
            'relative h-full w-full overflow-hidden bg-silicon shadow-[0_6px_14px_rgba(27,36,48,0.18)]',
            lg ? 'rounded-xl' : 'rounded-lg',
            stolen || moving ? 'border-[3px] border-[#C8102E]' : 'border border-rule',
          )}
        >
          <img
            src={photo.src}
            alt=""
            style={{ objectPosition: photo.position }}
            loading="lazy"
            draggable={false}
            className={clsx(
              'h-full w-full object-cover transition-[filter] duration-500',
              silent && 'grayscale opacity-70',
            )}
          />
          {silent && <div className="absolute inset-0 bg-[#9AA6B6]/45" aria-hidden />}
          {moving && <div className="alarm-pulse absolute inset-0 bg-[#C8102E]/35" aria-hidden />}
          {stolen && (
            <span
              className={clsx(
                'absolute left-1 top-1 rounded bg-[#C8102E] font-bold uppercase leading-none tracking-wide text-white',
                lg ? 'px-2 py-1 text-xs' : 'px-1 py-0.5 text-[9px]',
              )}
            >
              Reported stolen
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
