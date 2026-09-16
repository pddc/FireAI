import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { httpsCallable } from 'firebase/functions'
import { Loader2, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/native-select'
import { firebaseFunctions } from '@/lib/firebase'
import { useCloud } from '@/stores/cloud'

interface Member {
  uid: string
  email: string
  displayName: string
  role: 'owner' | 'operator' | 'viewer'
}

const ROLES = [
  { value: 'operator', label: 'Operator — can control the grill' },
  { value: 'viewer', label: 'Viewer — can watch only' },
]

/** Cloud mode: who can see and control this grill. */
export function MembersPage() {
  const { grillId } = useParams()
  const qc = useQueryClient()
  const me = useCloud((s) => s.user)
  const list = useQuery({
    queryKey: ['members', grillId],
    queryFn: async () => (await httpsCallable<{ grillId: string }, { members: Member[]; ownerUid: string }>(firebaseFunctions(), 'listMembers')({ grillId: grillId! })).data,
    enabled: !!grillId,
  })
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('operator')
  const set = useMutation({
    mutationFn: (v: { email: string; role: string }) => httpsCallable(firebaseFunctions(), 'setMember')({ grillId, ...v }),
    onSuccess: () => {
      setEmail('')
      qc.invalidateQueries({ queryKey: ['members', grillId] })
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const isOwner = list.data?.ownerUid === me?.uid

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (email.trim()) set.mutate({ email: email.trim(), role })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Members</h1>
        <p className="text-sm text-muted-foreground">People who can see this grill in their FireAI app. Changes apply to them within an hour, or immediately after they sign in again.</p>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" /> Current members</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {!list.data && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
          {list.data?.members.map((m) => (
            <div key={m.uid} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{m.displayName || m.email}</div>
                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
              </div>
              {isOwner && m.role !== 'owner' ? (
                <NativeSelect className="w-40" value={m.role} onValueChange={(r) => set.mutate({ email: m.email, role: r })} options={[{ value: 'operator', label: 'Operator' }, { value: 'viewer', label: 'Viewer' }]} />
              ) : (
                <Badge variant={m.role === 'owner' ? 'default' : 'secondary'} className="capitalize">{m.role}</Badge>
              )}
              {isOwner && m.role !== 'owner' && (
                <Button variant="ghost" size="icon-sm" aria-label="Remove member" onClick={() => set.mutate({ email: m.email, role: 'remove' })}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {isOwner && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="size-4" /> Invite</CardTitle>
            <CardDescription>They need a FireAI account first (any sign-in creates one).</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
              <Input type="email" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <NativeSelect className="sm:w-64" value={role} onValueChange={setRole} options={ROLES} />
              <Button type="submit" disabled={set.isPending}>{set.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Add'}</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
