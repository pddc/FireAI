import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { get, post } from '@/lib/api'
import { IS_CLOUD } from '@/lib/mode'
import { useGrill } from '@/stores/grill'

interface WhatsNew {
  version: string
  markdown: string
  show: boolean
}

/** Tiny markdown subset for release notes: headings, bullets, paragraphs, **bold** and `code`. */
export function renderNotes(md: string) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
      part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={i} className="rounded bg-muted px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code> : part,
    )
  const out: React.ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`} className="list-disc space-y-1 pl-5">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    list = []
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('- ')) { list.push(line.slice(2)); continue }
    flush()
    if (line.startsWith('# ')) continue // the dialog title already names the version
    if (line.startsWith('## ')) out.push(<h3 key={out.length} className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{line.slice(3)}</h3>)
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>)
  }
  flush()
  return out
}

/** Shown once after an upgrade (settings.globals.updated_message), like PiFire's post-update message. */
export function WhatsNewDialog() {
  const qc = useQueryClient()
  const connected = useGrill((s) => s.status === 'live')
  const q = useQuery({ queryKey: ['whats-new'], queryFn: () => get<WhatsNew>('/api/v1/system/whats-new'), enabled: !IS_CLOUD && connected, staleTime: Infinity })
  const dismiss = useMutation({ mutationFn: () => post('/api/v1/system/whats-new/dismiss'), onSuccess: () => qc.setQueryData<WhatsNew>(['whats-new'], (d) => (d ? { ...d, show: false } : d)) })
  const open = !!q.data?.show
  return (
    <Dialog open={open} onOpenChange={(o) => !o && dismiss.mutate()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift className="size-5 text-ember" /> FireAI {q.data?.version} is installed</DialogTitle>
          <DialogDescription>What changed in this release.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">{q.data && renderNotes(q.data.markdown)}</div>
        <DialogFooter>
          <Button onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
