import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'

const AREAS = ['Soweto', 'Midrand', 'Kempton Park', 'Sandton', 'Tembisa', 'Pretoria East']

export function Register() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    serial: '', ownerName: '', ownerContact: '', installer: 'Sunbelt Installers (demo)', area: '', model: '',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const m = useMutation({
    mutationFn: () => api.register({ ...form, serial: form.serial.trim().toUpperCase() }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['panels'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      toast(`${p.serial} registered`, 'success')
      navigate(`/panels/${p.serial}`)
    },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold md:text-3xl">Register a panel</h1>
      <p className="mt-1.5 text-muted">
        Installers register each panel at installation, using the serial laminated under the glass.
        The owner's name and contact stay private; the registry stores an anonymous owner ID.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-rule bg-sheet p-5 md:p-7">
        <div>
          <label className="label" htmlFor="serial">Panel serial</label>
          <input id="serial" className="field font-semibold uppercase" required minLength={3} maxLength={64}
            placeholder="SG-0108" value={form.serial} onChange={set('serial')} autoCapitalize="characters" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="on">Owner's name</label>
            <input id="on" className="field" required value={form.ownerName} onChange={set('ownerName')} />
          </div>
          <div>
            <label className="label" htmlFor="oc">Owner's phone or email</label>
            <input id="oc" className="field" required minLength={3} value={form.ownerContact} onChange={set('ownerContact')} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="area">Area</label>
            <input id="area" className="field" required list="areas" value={form.area} onChange={set('area')} />
            <datalist id="areas">{AREAS.map((a) => <option key={a} value={a} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="model">Panel model (optional)</label>
            <input id="model" className="field" placeholder="JA Solar 550W" value={form.model} onChange={set('model')} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="inst">Installer</label>
          <input id="inst" className="field" required value={form.installer} onChange={set('installer')} />
        </div>
        <button className="btn-primary w-full sm:w-auto" disabled={m.isPending}>
          {m.isPending ? 'Writing to registry…' : 'Register panel'}
        </button>
      </form>
    </div>
  )
}
