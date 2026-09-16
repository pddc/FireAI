import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Flame, Loader2, LogOut, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useCloud } from '@/stores/cloud'
import { useGrill } from '@/stores/grill'
import { CloudSource } from '@/lib/source/CloudSource'

function Frame({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-ember-soft">
            <Flame className="size-6 text-ember" />
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

function friendly(e: unknown): string {
  const code = (e as { code?: string }).code ?? ''
  if (code.includes('wrong-password') || code.includes('invalid-credential')) return 'Wrong email or password.'
  if (code.includes('user-not-found')) return 'No account with that email.'
  if (code.includes('email-already-in-use')) return 'That email already has an account — sign in instead.'
  if (code.includes('weak-password')) return 'Use at least 6 characters.'
  if (code.includes('popup-closed')) return 'Sign-in was cancelled.'
  return (e as Error).message || 'Something went wrong.'
}

export function SignInPage() {
  const { user, ready, signInWithGoogle, signInWithEmail, signUpWithEmail } = useCloud()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (ready && user) return <Navigate to="/grills" replace />

  const run = async (fn: () => Promise<void>) => {
    setErr(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setErr(friendly(e))
    } finally {
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => (mode === 'signin' ? signInWithEmail(email, pw) : signUpWithEmail(email, pw)))
  }

  return (
    <Frame title="FireAI" description="Sign in to see your grills from anywhere.">
      <div className="space-y-4">
        <Button variant="outline" size="lg" className="w-full" onClick={() => run(signInWithGoogle)} disabled={busy}>
          Continue with Google
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" /> or <Separator className="flex-1" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pw">Password</Label>
            <Input id="pw" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} required />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />} {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <button type="button" className="w-full text-center text-xs text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </div>
    </Frame>
  )
}

/** Redirects to /signin until Firebase Auth reports a user. */
export function CloudAuthGate() {
  const { user, ready, init } = useCloud()
  useEffect(() => init(), [init])
  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    )
  }
  if (!user) return <Navigate to="/signin" replace />
  return <Outlet />
}

export function GrillsPage() {
  const { grills, grillsLoading, signOut, user } = useCloud()
  return (
    <div className="mx-auto min-h-dvh max-w-lg p-4 pt-safe">
      <div className="flex items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Flame className="size-6 text-ember" />
          <span className="text-lg font-semibold">FireAI</span>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{user?.email}</p>
      <div className="space-y-2">
        {grillsLoading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
        {!grillsLoading && grills.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">No grills yet. Pair one to get started.</CardContent>
          </Card>
        )}
        {grills.map((g) => (
          <Link key={g.id} to={`/g/${g.id}`} className="flex items-center justify-between rounded-xl border bg-card p-4 transition-colors hover:bg-muted">
            <div>
              <div className="font-medium">{g.name}</div>
              <div className="text-xs capitalize text-muted-foreground">{g.role}</div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
        <Link to="/grills/pair" className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Plus className="size-4" /> Pair a grill
        </Link>
      </div>
    </div>
  )
}

export function PairPage() {
  const { pair } = useCloud()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const id = await pair(code.replace(/\D/g, ''), name)
      navigate(`/g/${id}`, { replace: true })
    } catch (e) {
      setErr((e as Error).message || 'Pairing failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Frame title="Pair a grill" description="On the grill: Settings → Cloud → Pair. Enter the 6-digit code it shows.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="code">Pairing code</Label>
          <Input id="code" inputMode="numeric" pattern="[0-9 ]*" maxLength={7} className="text-center text-2xl tracking-[0.4em] tabular" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1">
          <Label htmlFor="name">Name (optional)</Label>
          <Input id="name" placeholder="Backyard smoker" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || code.replace(/\D/g, '').length !== 6}>
          {busy && <Loader2 className="size-4 animate-spin" />} Pair
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => navigate('/grills')}>
          Cancel
        </Button>
      </form>
    </Frame>
  )
}

/** Attaches a CloudSource for the grill in the URL, then renders the shell. */
export function CloudGrillGate() {
  const { grillId } = useParams()
  const attach = useGrill((s) => s.attach)
  const detach = useGrill((s) => s.detach)
  const source = useGrill((s) => s.source)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!grillId) return
    if (source && source.kind === 'cloud' && (source as CloudSource).grillId === grillId) return
    const src = new CloudSource(grillId)
    attach(src).catch((e) => setErr((e as Error).message))
    return () => detach()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grillId])

  if (!grillId) return <Navigate to="/grills" replace />
  if (err) {
    return (
      <Frame title="Can't open this grill" description={err}>
        <Button className="w-full" onClick={() => location.assign('/grills')}>
          Back to grills
        </Button>
      </Frame>
    )
  }
  return <Outlet />
}
