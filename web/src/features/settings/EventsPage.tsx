import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { NativeSelect } from '@/components/ui/native-select'
import { get } from '@/lib/api'
import { useGrill } from '@/stores/grill'
import { IS_CLOUD } from '@/lib/mode'
import { cn } from '@/lib/utils'

function levelClass(line: string) {
  if (/\[ERROR\]|ERROR/.test(line)) return 'text-destructive'
  if (/\[WARNING\]|WARNING/.test(line)) return 'text-warn'
  if (/\[DEBUG\]/.test(line)) return 'text-muted-foreground'
  return ''
}

export function EventsPage() {
  const source = useGrill((s) => s.source)
  const events = useQuery({ queryKey: ['events', source?.kind], queryFn: () => source!.getEvents(300), enabled: !!source, refetchInterval: 10_000 })
  const logs = useQuery({ queryKey: ['logs'], queryFn: () => get<{ logs: { name: string; size: number }[] }>('/api/v1/logs'), enabled: !IS_CLOUD })
  const [logName, setLogName] = useState('events.log')
  const tail = useQuery({ queryKey: ['log', logName], queryFn: () => get<{ lines: string[] }>(`/api/v1/logs/${logName}?lines=500`), enabled: !IS_CLOUD && !!logName })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Events &amp; logs</h1>
        <Button variant="ghost" size="sm" onClick={() => { events.refetch(); tail.refetch() }}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events</TabsTrigger>
          {!IS_CLOUD && <TabsTrigger value="logs">Log files</TabsTrigger>}
        </TabsList>
        <TabsContent value="events">
          <Card>
            <CardContent className="p-0">
              {!events.data ? (
                <div className="p-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
              ) : events.data.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No events yet.</div>
              ) : (
                <ul className="max-h-[70dvh] divide-y overflow-y-auto font-mono text-xs">
                  {[...events.data].reverse().map((e, i) => (
                    <li key={i} className={cn('flex gap-3 px-3 py-1.5', levelClass(e.message))}>
                      <span className="shrink-0 text-muted-foreground">{e.date} {e.time}</span>
                      <span className="break-words">{e.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {!IS_CLOUD && (
          <TabsContent value="logs">
            <Card>
              <CardContent className="space-y-3 p-3">
                <NativeSelect className="w-full sm:w-64" value={logName} onValueChange={setLogName} options={(logs.data?.logs ?? [{ name: 'events.log', size: 0 }]).map((l) => ({ value: l.name, label: `${l.name} (${Math.round(l.size / 1024)} KB)` }))} />
                <pre className="max-h-[65dvh] overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed">
                  {tail.data ? tail.data.lines.map((l, i) => <div key={i} className={levelClass(l)}>{l}</div>) : '…'}
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
