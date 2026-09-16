import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { useGrill } from '@/stores/grill'
import { get } from '@/lib/api'
import { SchemaGroupCard, type SettingsSchema } from './SchemaForm'
import type { Units } from '@/types/state'

/** Renders the groups of one schema section without the page header (embedded in hand-built pages). */
export function SettingsSectionInline({ sectionId }: { sectionId: string }) {
  const source = useGrill((s) => s.source)
  const qc = useQueryClient()
  const schema = useQuery({ queryKey: ['settings-schema', 'local'], queryFn: () => get<SettingsSchema>('/api/v1/settings/schema'), enabled: !!source, staleTime: 60_000 })
  const values = useQuery({ queryKey: ['settings', source?.kind], queryFn: () => source!.getSettings(), enabled: !!source })
  if (!schema.data || !values.data) return <Skeleton className="h-32 w-full rounded-xl" />
  const section = schema.data.sections.find((s) => s.id === sectionId)
  if (!section) return null
  const units = ((values.data as { globals?: { units?: Units } }).globals?.units ?? schema.data.units) as Units
  const onSave = async (patch: Record<string, unknown>) => {
    await source!.patchSettings(patch)
    await qc.invalidateQueries({ queryKey: ['settings'] })
    await qc.invalidateQueries({ queryKey: ['settings-schema'] })
  }
  return (
    <>
      {section.groups.map((g) => (
        <SchemaGroupCard key={g.title} group={g} values={values.data!} units={units} showAdvanced onSave={onSave} />
      ))}
    </>
  )
}
