import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Flame, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/stores/auth'
import { ApiError } from '@/lib/api'

function AuthFrame({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-ember-soft">
            <Flame className="size-6 text-ember" />
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

export function SetupPage() {
  const { setupRequired, setup, bootstrap } = useAuth()
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (setupRequired === false) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (pw !== pw2) return setErr('Passwords do not match.')
    setBusy(true)
    try {
      await setup(pw)
      await bootstrap()
      navigate('/', { replace: true })
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Setup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title="Welcome to FireAI" description="Set an admin password. Nothing on this grill can be controlled from the network until you do.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pw">Password</Label>
          <Input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw2">Confirm password</Label>
          <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Create password
        </Button>
      </form>
    </AuthFrame>
  )
}

export function LoginPage() {
  const { setupRequired, role, token, authDisabled, login, bootstrap } = useAuth()
  const navigate = useNavigate()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (setupRequired) return <Navigate to="/setup" replace />
  if (role && (token || authDisabled)) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await login(pw)
      await bootstrap()
      navigate('/', { replace: true })
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? 'Wrong password.' : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title="Sign in" description="Enter the admin password for this grill.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pw">Password</Label>
          <Input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Sign in
        </Button>
      </form>
    </AuthFrame>
  )
}
