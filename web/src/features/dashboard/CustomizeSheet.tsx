import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useCommand } from '@/hooks/useCommand'
import type { GrillState } from '@/types/state'

/** Cards that can be hidden besides the probe cards (same names PiFire's Default dashboard used). */
export const FIXED_CARDS: { id: string; label: string }[] = [
  { id: 'status', label: 'Status strip' },
  { id: 'timer', label: 'Timer' },
]

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  state: GrillState
}

/** Show/hide dashboard cards. Stored in the grill's settings so every phone and the cloud app agree. */
export function CustomizeSheet({ open, onOpenChange, state }: Props) {
  const { run, busy } = useCommand()
  const [hidden, setHidden] = useState<string[]>(state.dashboard?.hidden_cards ?? [])
  useEffect(() => {
    if (open) setHidden(state.dashboard?.hidden_cards ?? [])
  }, [open, state.dashboard?.hidden_cards])

  const cards = [
    ...state.probes.filter((p) => p.enabled && p.type !== 'Aux').map((p) => ({ id: p.label, label: p.name })),
    ...FIXED_CARDS,
  ]
  const toggle = (id: string, on: boolean) => setHidden((h) => (on ? h.filter((x) => x !== id) : [...h, id]))
  const save = async () => {
    await run('settings.patch', { patch: { dashboard: { dashboards: { Default: { custom: { hidden_cards: hidden } } } } } }, { success: 'Dashboard updated' })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto rounded-t-2xl sm:max-w-md pb-safe">
        <SheetHeader>
          <SheetTitle>Customize dashboard</SheetTitle>
          <SheetDescription>Choose which cards are shown. Gauge ranges are under Settings → General.</SheetDescription>
        </SheetHeader>
        <div className="space-y-2 px-4 pb-4">
          {cards.map((c) => (
            <label key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label className="text-sm">{c.label}</Label>
              <Switch checked={!hidden.includes(c.id)} onCheckedChange={(on) => toggle(c.id, on)} />
            </label>
          ))}
          <Button className="mt-2 w-full" onClick={save} disabled={!!busy}>
            {busy === 'settings.patch' && <Loader2 className="size-4 animate-spin" />} Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
