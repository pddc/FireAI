import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bluetooth, Download, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { downloadUrl, get, post } from '@/lib/api'

interface BtDevice {
  name: string
  address: string
  info: string
}

/** Address field with a "Scan" button: the control process scans with bleak and the result is picked from a list. */
export function BtAddressField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const scan = useMutation({ mutationFn: () => post<{ devices: BtDevice[]; error: string | null }>('/api/v1/bluetooth/scan') })
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="xx:xx:xx:xx:xx:xx" className="w-full font-mono sm:w-64" />
        <Button type="button" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending} aria-label="Scan for Bluetooth devices">
          {scan.isPending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Scan
        </Button>
      </div>
      {scan.isPending && <p className="text-xs text-muted-foreground">Scanning for about 6 seconds… turn the thermometer on and keep it close.</p>}
      {scan.isError && <p className="text-xs text-destructive">{(scan.error as Error).message}</p>}
      {scan.data?.error && !scan.data.devices.length && <p className="text-xs text-destructive">{scan.data.error}</p>}
      {!!scan.data?.devices.length && (
        <div className="overflow-hidden rounded-lg border">
          {scan.data.devices.map((d) => (
            <button
              key={d.address}
              type="button"
              onClick={() => onChange(d.address)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted ${d.address === value ? 'bg-ember-soft' : ''}`}
            >
              <Bluetooth className="size-4 text-muted-foreground" />
              <span className="flex-1 truncate">{d.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{d.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** PiFire's bt_diag.py as a card: adapter, BlueZ, service state, capabilities. */
export function BluetoothDiagnostics() {
  const [open, setOpen] = useState(false)
  const diag = useQuery({ queryKey: ['bt-diag'], queryFn: () => get<{ sections: { title: string; output: string }[] }>('/api/v1/bluetooth/diagnostics'), enabled: open })
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Bluetooth className="size-4" /> Bluetooth diagnostics</CardTitle>
        <CardDescription>If a Bluetooth thermometer is never discovered, this report shows the adapter, BlueZ version, service state and permissions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => (open ? diag.refetch() : setOpen(true))} disabled={diag.isFetching}>
            {diag.isFetching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} {open ? 'Run again' : 'Run diagnostics'}
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<a href={downloadUrl('/api/v1/bluetooth/diagnostics?format=text')} download />}>
            <Download className="size-4" /> Download report
          </Button>
        </div>
        {diag.data && (
          <div className="space-y-2">
            {diag.data.sections.map((s) => (
              <details key={s.title} className="rounded-lg border" open={s.title === 'Python' || s.title === 'bluetooth.service'}>
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{s.title}</summary>
                <pre className="overflow-x-auto border-t bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">{s.output}</pre>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
