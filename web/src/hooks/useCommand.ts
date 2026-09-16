import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api'
import { useGrill } from '@/stores/grill'

/**
 * Run a controller command with a busy flag and error toast.
 * Success is silent by default: the state stream is the confirmation.
 */
export function useCommand() {
  const command = useGrill((s) => s.command)
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async (name: string, args?: Record<string, unknown>, opts: { success?: string } = {}) => {
      setBusy(name)
      try {
        const r = await command(name, args)
        if (opts.success) toast.success(opts.success)
        return r
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : (e as Error).message
        toast.error(msg || 'Command failed')
        throw e
      } finally {
        setBusy(null)
      }
    },
    [command],
  )
  return { run, busy }
}
