import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/** Subscribes to the server's event stream and refreshes whatever changed.
 *  Every screen stays live on phone and laptop without polling. */
export function useLiveUpdates(onAlert?: (title: string) => void) {
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (e) => {
      try {
        const { topic, data } = JSON.parse(e.data) as { topic: string; data: Record<string, unknown> }
        if (topic === 'reset') { qc.invalidateQueries(); return }
        if (topic === 'panels') {
          qc.invalidateQueries({ queryKey: ['panels'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          if (data.serial) {
            qc.invalidateQueries({ queryKey: ['panel', data.serial] })
            qc.invalidateQueries({ queryKey: ['lookup', data.serial] })
          }
        }
        if (topic === 'alerts') {
          qc.invalidateQueries({ queryKey: ['alerts'] })
          qc.invalidateQueries({ queryKey: ['stats'] })
          qc.invalidateQueries({ queryKey: ['panels'] })
          if (data.title && onAlert) onAlert(String(data.title))
        }
        if (topic === 'outages') qc.invalidateQueries({ queryKey: ['outages'] })
      } catch { /* ignore malformed events */ }
    }
    return () => es.close()
  }, [qc, onAlert])

  return connected
}
