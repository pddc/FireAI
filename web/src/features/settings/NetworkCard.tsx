import { useEffect, useRef } from 'react'
import { Wifi, Network } from 'lucide-react'
import qrcode from 'qrcode-generator'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export interface NetworkInfo {
  hostname: string
  interfaces: { name: string; ip: string; up: boolean | null }[]
  wifi: { interface: string; quality_percent: number | null; signal_dbm: number } | null
}

/** QR code of a URL, drawn on a canvas (no network, no dependencies beyond the tiny generator). */
export function QrCode({ text, size = 128 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    const cell = Math.floor(size / (n + 4))
    const px = cell * (n + 4)
    canvas.width = px
    canvas.height = px
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, px, px)
    ctx.fillStyle = '#000'
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + 2) * cell, (r + 2) * cell, cell, cell)
  }, [text, size])
  return <canvas ref={ref} role="img" aria-label={`QR code for ${text}`} className="rounded-md" />
}

/** Hostname, addresses and WiFi signal; QR code so a phone can open the grill (PiFire's Admin → System Info). */
export function NetworkCard({ net }: { net: NetworkInfo | undefined }) {
  const primary = net?.interfaces.find((i) => i.up !== false) ?? net?.interfaces[0]
  const url = primary ? `http://${primary.ip}/` : window.location.origin + '/'
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><Network className="size-4" /> Network</CardTitle>
        <CardDescription>Scan the code with a phone on the same WiFi to open the grill; then add it to the home screen.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <QrCode text={url} />
        <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">Hostname</div><div className="font-medium">{net?.hostname ?? '—'}</div></div>
          <div><div className="text-xs text-muted-foreground">URL</div><div className="break-all font-medium">{url}</div></div>
          {net?.interfaces.map((i) => (
            <div key={i.name}><div className="text-xs text-muted-foreground">{i.name}</div><div className="font-mono text-xs">{i.ip}{i.up === false ? ' (down)' : ''}</div></div>
          ))}
          <div>
            <div className="text-xs text-muted-foreground">WiFi</div>
            <div className="flex items-center gap-1 font-medium">
              <Wifi className="size-4" />
              {net?.wifi ? `${net.wifi.quality_percent != null ? `${net.wifi.quality_percent}% · ` : ''}${net.wifi.signal_dbm} dBm` : 'not connected / wired'}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
