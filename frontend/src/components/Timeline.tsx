import clsx from 'clsx'
import { ExternalLink } from 'lucide-react'
import type { LedgerEvent } from '../lib/api'
import { date, eventCopy, shortHash } from '../lib/format'

/** Ownership history, newest first. Each entry carries its registry transaction. */
export function Timeline({ events }: { events: LedgerEvent[] }) {
  if (!events.length) return <p className="text-muted">No registry history.</p>
  return (
    <ol className="relative ml-2 border-l-2 border-rule">
      {events.map((e) => {
        const bad = e.kind === 'reported_stolen'
        return (
          <li key={e.id} className="relative pb-6 pl-6 last:pb-0">
            <span
              className={clsx(
                'absolute -left-[9px] top-1 size-4 rounded-full border-2 border-sheet',
                bad ? 'bg-breach' : e.kind === 'recovered' ? 'bg-grid' : 'bg-cell',
              )}
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className={clsx('font-semibold', bad && 'text-breach')}>{eventCopy[e.kind] ?? e.kind}</p>
              <time className="text-sm text-muted">{date(e.ts)}</time>
            </div>
            <p className="text-sm text-muted">
              {e.kind === 'transferred' && e.fromOwner && e.toOwner
                ? `Owner ${e.fromOwner} to ${e.toOwner}, by ${e.actor}`
                : `${e.detail}${e.actor && !e.detail.includes(e.actor) ? `, by ${e.actor}` : ''}`}
            </p>
            {e.explorerUrl ? (
              <a
                href={e.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-cell underline underline-offset-2"
              >
                Transaction {shortHash(e.txHash)} <ExternalLink size={13} aria-hidden />
              </a>
            ) : (
              <p className="mt-1 text-sm text-muted">Ledger entry {shortHash(e.txHash)}</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
