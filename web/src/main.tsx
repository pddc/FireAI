import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { configureApi } from '@/lib/api'
import { useAuth } from '@/stores/auth'
import { applyTheme, useUi } from '@/stores/ui'
import { AppRouter } from '@/app/router'
import './index.css'

configureApi({
  getToken: () => useAuth.getState().token,
  onUnauthorized: () => {
    if (!useAuth.getState().authDisabled) useAuth.getState().logout()
  },
})
applyTheme(useUi.getState().theme)

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
