import { useState } from 'react'
import { Bell, BellOff, Download, Loader2, Moon, Smartphone, Sun, Monitor } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useUi } from '@/stores/ui'
import { useInstall, isIos, isStandalone } from '@/lib/install'
import { IS_CLOUD } from '@/lib/mode'
import { cn } from '@/lib/utils'

function PushCard() {
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)

  // Lazy so the local build never imports firebase/messaging.
  const load = async () => {
    const push = await import('@/lib/push')
    setSupported(await push.pushSupported())
    setEnabled(push.pushEnabled())
    return push
  }
  if (supported === null) load()

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      const push = await load()
      const { useCloud } = await import('@/stores/cloud')
      const uid = useCloud.getState().user?.uid
      if (!uid) throw new Error('Sign in first')
      if (on) await push.enablePush(uid)
      else await push.disablePush(uid)
      setEnabled(on)
      toast.success(on ? 'Push notifications on for this device' : 'Push notifications off')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">{enabled ? <Bell className="size-4 text-ember" /> : <BellOff className="size-4" />} Push notifications</CardTitle>
        <CardDescription>Probe targets, timers and errors from every grill you belong to, delivered to this device. {isIos() && !isStandalone() ? 'On iPhone, add FireAI to your Home Screen first.' : ''}</CardDescription>
      </CardHeader>
      <CardContent>
        {supported === false ? (
          <p className="text-sm text-muted-foreground">This browser does not support web push.</p>
        ) : (
          <label className="flex items-center justify-between rounded-lg border p-3">
            <Label className="text-sm">Notify this device</Label>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Switch checked={!!enabled} onCheckedChange={toggle} disabled={supported === null} />}
          </label>
        )}
      </CardContent>
    </Card>
  )
}

/** App-level preferences: theme, install, push. */
export function AppPage() {
  const { theme, setTheme } = useUi()
  const { deferred, installed, promptInstall } = useInstall()
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">App</h1>
        <p className="text-sm text-muted-foreground">How FireAI looks and behaves on this device.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          {([['dark', 'Dark', Moon], ['light', 'Light', Sun], ['system', 'System', Monitor]] as const).map(([value, label, Icon]) => (
            <button key={value} type="button" onClick={() => setTheme(value)} className={cn('flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-medium transition-colors', theme === value ? 'border-ember bg-ember-soft text-ember' : 'hover:bg-muted')}>
              <Icon className="size-5" /> {label}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="size-4" /> Install</CardTitle>
          <CardDescription>Installed, FireAI opens full-screen like a native app and stays on your home screen.</CardDescription>
        </CardHeader>
        <CardContent>
          {installed || isStandalone() ? (
            <p className="text-sm text-muted-foreground">Installed on this device.</p>
          ) : deferred ? (
            <Button onClick={() => promptInstall()}><Download className="size-4" /> Install FireAI</Button>
          ) : isIos() ? (
            <p className="text-sm text-muted-foreground">In Safari: tap the Share button, then “Add to Home Screen”.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Use your browser's “Install app” option from the address bar or menu.</p>
          )}
        </CardContent>
      </Card>

      {IS_CLOUD && <PushCard />}
    </div>
  )
}
