import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { del, get, post } from '@/lib/api'

interface ApiKey {
  id: string
  name: string
  role: 'admin' | 'operator' | 'viewer'
  created: string
  last_used: string | null
}

/** Long-lived credentials for Home Assistant, Node-RED, the PiFire Android app… (PiFire-compatible /api + /api/v1). */
export function ApiKeysCard() {
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => get<{ keys: ApiKey[] }>('/api/v1/auth/api-keys') })
  const [name, setName] = useState('')
  const [role, setRole] = useState<ApiKey['role']>('operator')
  const [fresh, setFresh] = useState<{ name: string; key: string } | null>(null)
  const create = useMutation({
    mutationFn: () => post<ApiKey & { key: string }>('/api/v1/auth/api-keys', { name, role }),
    onSuccess: (r) => { setFresh({ name: r.name, key: r.key }); setName(''); qc.invalidateQueries({ queryKey: ['api-keys'] }) },
    onError: (e) => toast.error((e as Error).message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/v1/auth/api-keys/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
    onError: (e) => toast.error((e as Error).message),
  })
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Select the key and copy it manually')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4" /> API keys</CardTitle>
        <CardDescription>
          For integrations that can't sign in: Home Assistant, Node-RED, the PiFire Android app. Send the key as <code className="rounded bg-muted px-1">X-API-Key</code>,
          <code className="rounded bg-muted px-1">Authorization: Bearer</code> or <code className="rounded bg-muted px-1">?api_key=</code> to the PiFire-compatible <code className="rounded bg-muted px-1">/api/get|set|cmd</code> routes or to <code className="rounded bg-muted px-1">/api/v1</code>.
          Viewer keys read only; operator keys can control the cook; admin keys can also change settings and restart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fresh && (
          <div className="space-y-2 rounded-lg border border-ember/50 bg-ember-soft p-3 text-sm">
            <div className="font-medium">Key for “{fresh.name}” — copy it now, it is not shown again.</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all break-all rounded bg-background px-2 py-1 font-mono text-xs" data-testid="fresh-key">{fresh.key}</code>
              <Button size="icon-sm" variant="outline" aria-label="Copy key" onClick={() => copy(fresh.key)}><Copy className="size-4" /></Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Done</Button>
          </div>
        )}
        {keys.data?.keys.length ? (
          <div className="overflow-hidden rounded-lg border text-sm">
            {keys.data.keys.map((k, i) => (
              <div key={k.id} className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? 'border-t' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{k.name}</div>
                  <div className="text-xs text-muted-foreground">{k.role} · created {k.created}{k.last_used ? ` · last used ${k.last_used}` : ' · never used'}</div>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Revoke ${k.name}`} onClick={() => remove.mutate(k.id)} disabled={remove.isPending}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        ) : keys.isLoading ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        )}
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate()
          }}
        >
          <Input placeholder="Name (e.g. Home Assistant)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
          <NativeSelect value={role} onValueChange={(v) => setRole(v as ApiKey['role'])} className="sm:w-40" aria-label="Key role"
            options={[{ value: 'viewer', label: 'Viewer' }, { value: 'operator', label: 'Operator' }, { value: 'admin', label: 'Admin' }]} />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create key
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
