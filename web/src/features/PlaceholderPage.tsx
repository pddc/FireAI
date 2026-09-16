import { Card, CardContent } from '@/components/ui/card'

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Coming in a later slice.</CardContent>
      </Card>
    </div>
  )
}
