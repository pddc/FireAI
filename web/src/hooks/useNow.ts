import { useEffect, useState } from 'react'

/** Re-renders every `ms` with the current epoch seconds. For countdowns. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}
