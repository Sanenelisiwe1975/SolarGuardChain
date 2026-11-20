/** Which photo (from /public) each panel shows, chosen by serial number so a
 *  panel looks the same on every page. Edit this file to change photos. */

export interface PanelPhotoSource {
  src: string
  /** CSS object-position that keeps the solar panels in frame when cropped. */
  position: string
}

const PHOTOS = {
  'solar-1': { src: '/solar-1.jpg', position: '50% 55%' },
  'solar-2': { src: '/solar-2.jpg', position: '50% 75%' },
  'solar-3': { src: '/solar-3.jpg', position: '35% 50%' },
  'solar-5': { src: '/solar-5.jpg', position: '50% 35%' },
} satisfies Record<string, PanelPhotoSource>

type PhotoKey = keyof typeof PHOTOS

/** Fixed assignments. Each serial here gets its own photo. */
const BY_SERIAL: Record<string, PhotoKey> = {
  'SG-0042': 'solar-1',
  'SG-0043': 'solar-2',
  'SG-0107': 'solar-3',
  'SG-0666': 'solar-5',
}

const POOL = Object.keys(PHOTOS) as PhotoKey[]

/** Small stable string hash (FNV-1a), so unlisted serials always land on the same photo. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function photoForSerial(serial: string): PanelPhotoSource {
  const key = BY_SERIAL[serial.trim().toUpperCase()] ?? POOL[hash(serial.trim().toUpperCase()) % POOL.length]
  return PHOTOS[key]
}
