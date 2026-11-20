import { useEffect, useRef, useState } from 'react'

interface Props {
  onResult: (text: string) => void
  onClose: () => void
}

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

/** Reads the barcode laminated on the panel. Uses the browser's built-in
 *  BarcodeDetector where available (Chrome on Android) and ZXing elsewhere
 *  (iPhone Safari, desktop). */
export function Scanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let zxingControls: { stop: () => void } | null = null

    const finish = (text: string) => {
      if (stopped) return
      stopped = true
      onResult(text.trim())
    }

    async function start() {
      const video = videoRef.current
      if (!video) return
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot open the camera. Type the serial instead.')
        return
      }
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
      try {
        if (BD) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          video.srcObject = stream
          await video.play()
          const detector = new BD({ formats: ['code_128', 'code_39', 'qr_code', 'data_matrix', 'ean_13'] })
          const tick = async () => {
            if (stopped) return
            try {
              const codes = await detector.detect(video)
              if (codes[0]?.rawValue) return finish(codes[0].rawValue)
            } catch { /* frame not ready */ }
            requestAnimationFrame(tick)
          }
          tick()
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          zxingControls = await reader.decodeFromConstraints(
            { video: { facingMode: 'environment' } },
            video,
            (result) => { if (result) finish(result.getText()) },
          )
        }
      } catch (e) {
        const name = (e as Error).name
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in your browser settings, or type the serial.'
            : 'The camera could not start. Type the serial instead.',
        )
      }
    }

    start()
    return () => {
      stopped = true
      zxingControls?.stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onResult])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-frame/95 text-white" role="dialog" aria-label="Scan panel serial">
      <div className="flex items-center justify-between p-4">
        <p className="font-semibold">Point the camera at the serial barcode</p>
        <button className="btn bg-white/10 text-white hover:bg-white/20" onClick={onClose}>Close</button>
      </div>
      <div className="relative flex flex-1 items-center justify-center p-4">
        {error ? (
          <p className="max-w-sm text-center text-lg">{error}</p>
        ) : (
          <>
            <video ref={videoRef} className="max-h-full w-full max-w-xl rounded-xl object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-sun md:inset-x-1/4" />
          </>
        )}
      </div>
    </div>
  )
}
