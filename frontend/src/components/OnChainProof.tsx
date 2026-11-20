import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ExternalLink, LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { api, type Lookup } from '../lib/api'

type Verdict = Lookup['result']

const ABI = [
  'function getPanel(string serial) view returns (tuple(bytes32 ownerHash, address registrar, uint64 registeredAt, uint64 updatedAt, uint32 transfers, uint8 status))',
]
const BY_STATUS: Verdict[] = ['unregistered', 'clean', 'stolen']
const LABEL: Record<Verdict, string> = { clean: 'Clean', stolen: 'Reported stolen', unregistered: 'Not registered' }

interface Target { address: string; rpcUrl: string; chainId: number | null }

/* A free view call from the buyer's own browser: no wallet, no server in between.
   ethers is loaded only when a check actually needs it. */
async function readContract({ address, rpcUrl, chainId }: Target, serial: string): Promise<Verdict> {
  const { Contract, JsonRpcProvider } = await import('ethers')
  const provider = new JsonRpcProvider(rpcUrl, chainId ?? undefined, { staticNetwork: true })
  try {
    const panel = await new Contract(address, ABI, provider).getPanel(serial)
    const verdict = BY_STATUS[Number(panel.status)]
    if (!verdict) throw new Error(`Unknown status ${panel.status}`)
    return verdict
  } finally {
    provider.destroy()
  }
}

/** Double-checks the server's verdict against the registry itself. */
export function OnChainProof({ result: r }: { result: Pick<Lookup, 'serial' | 'result'> }) {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const reg = stats.data?.registry
  const target: Target | null = reg?.mode === 'fuji' && reg.contractAddress && reg.rpcUrl
    ? { address: reg.contractAddress, rpcUrl: reg.rpcUrl, chainId: reg.chainId }
    : null

  const chain = useQuery({
    queryKey: ['onchain', target?.address, r.serial],
    queryFn: () => readContract(target!, r.serial),
    enabled: target !== null,
    retry: 1,
  })

  if (!reg) return null

  if (reg.mode === 'local') {
    return (
      <p className={clsx('mt-3 text-sm', reg.intact === false ? 'font-medium text-breach' : 'text-muted')}>
        Source: {reg.label}. {reg.intact === false ? 'Tampering detected in the ledger.' : 'The hash chain is intact.'}
      </p>
    )
  }
  if (!target) return null

  const network = reg.chainId === 43113 ? 'Avalanche Fuji' : reg.network
  const mismatch = chain.data !== undefined && chain.data !== r.result

  let icon: ReactNode
  let body: ReactNode
  if (chain.isPending) {
    icon = <LoaderCircle size={20} className="motion-safe:animate-spin" aria-hidden />
    body = 'Reading the contract on Avalanche…'
  } else if (chain.isError) {
    icon = <ShieldAlert size={20} aria-hidden />
    body = 'Could not reach Avalanche to double-check. The result above comes from our server.'
  } else if (mismatch) {
    icon = <ShieldAlert size={20} aria-hidden />
    body = <>The contract says <strong>{LABEL[chain.data].toLowerCase()}</strong>, which differs from our server. Trust the contract.</>
  } else {
    icon = <ShieldCheck size={20} className="text-grid" aria-hidden />
    body = <><strong>Confirmed on {network}:</strong> {LABEL[chain.data]}. Read directly from the contract in your browser, not from our server.</>
  }

  return (
    <div
      aria-live="polite"
      className={clsx(
        'mt-3 flex gap-3 rounded-xl border px-4 py-3 text-[15px]',
        mismatch ? 'border-breach bg-breach-soft text-breach' : 'border-rule bg-sheet',
        (chain.isPending || chain.isError) && 'text-muted',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        <p className={clsx(mismatch && 'font-medium')}>{body}</p>
        {reg.explorerUrl && (
          <a href={reg.explorerUrl} target="_blank" rel="noreferrer"
            className={clsx('mt-1 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-2',
              mismatch ? 'text-breach' : 'text-cell')}>
            View contract on the explorer <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}
