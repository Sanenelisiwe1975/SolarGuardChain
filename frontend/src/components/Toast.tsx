import clsx from 'clsx'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tone = 'info' | 'success' | 'alarm' | 'error'
interface Toast { id: number; text: string; tone: Tone }

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {})
export const useToast = () => useContext(Ctx)

const styles: Record<Tone, string> = {
  info: 'bg-frame text-white',
  success: 'bg-grid text-white',
  alarm: 'bg-breach text-white',
  error: 'bg-sheet text-breach border border-breach',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'alarm' ? 7000 : 4000)
    if (tone === 'alarm' && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200])
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        aria-live="assertive"
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 md:top-auto md:bottom-6 md:right-6 md:left-auto md:items-end"
      >
        {toasts.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-[15px] font-medium shadow-lg', styles[t.tone])}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
