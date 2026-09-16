import { useParams, Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useGrill } from '@/stores/grill'
import { get } from '@/lib/api'
import { IS_CLOUD } from '@/lib/mode'
import { SchemaSectionForm, type SettingsSchema } from './SchemaForm'
import type { Units } from '@/types/state'

async function loadSchema(source: NonNullable<ReturnType<typeof useGrill.getState>['source']>): Promise<SettingsSchema> {
  if (source.kind === 'local') return get<SettingsSchema>('/api/v1/settings/schema')
  // Cloud: the bridge mirrors the schema next to the settings document.
  const { doc, getDoc } = await import('firebase/firestore')
  const { firebaseFirestore } = await import('@/lib/firebase')
  const grillId = (source as unknown as { grillId: string }).grillId
  const snap = await getDoc(doc(firebaseFirestore(), 'grills', grillId, 'settings', 'schema'))
  if (!snap.exists()) throw new Error('The grill has not published its settings schema yet.')
  return snap.data() as SettingsSchema
}

/** Renders one settings section from the schema, saving each group through settings.patch. */
export function SettingsSectionPage() {
  const { section: sectionId } = useParams()
  const source = useGrill((s) => s.source)
  const qc = useQueryClient()
  const schema = useQuery({ queryKey: ['settings-schema', source?.kind], queryFn: () => loadSchema(source!), enabled: !!source, staleTime: 60_000 })
  const values = useQuery({ queryKey: ['settings', source?.kind], queryFn: () => source!.getSettings(), enabled: !!source })

  if (!sectionId) return <Navigate to=".." replace />
  if (schema.isError || values.isError) {
    return <Alert variant="destructive"><AlertDescription>{((schema.error ?? values.error) as Error).message}</AlertDescription></Alert>
  }
  if (!schema.data || !values.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }
  const section = schema.data.sections.find((s) => s.id === sectionId)
  if (!section) return <Navigate to=".." replace />
  if (IS_CLOUD && section.local_only) return <Navigate to=".." replace />

  const units = ((values.data as { globals?: { units?: Units } }).globals?.units ?? schema.data.units) as Units
  const onSave = async (patch: Record<string, unknown>) => {
    await source!.patchSettings(patch)
    await qc.invalidateQueries({ queryKey: ['settings'] })
    // controller / display selection changes the dynamic groups
    if ('controller' in patch || 'modules' in patch || 'platform' in patch) await qc.invalidateQueries({ queryKey: ['settings-schema'] })
  }
  return <SchemaSectionForm section={section} values={values.data} units={units} onSave={onSave} />
}
