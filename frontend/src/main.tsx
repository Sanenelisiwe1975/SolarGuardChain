import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/Toast'
import './index.css'
import { Account } from './pages/Account'
import { Alerts } from './pages/Alerts'
import { Check } from './pages/Check'
import { Demo } from './pages/Demo'
import { Fleet } from './pages/Fleet'
import { PanelDetail } from './pages/PanelDetail'
import { Register } from './pages/Register'
import { Sensor } from './pages/Sensor'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
})

function NotFound() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link to="/" className="btn-quiet mt-4">Go to your panels</Link>
    </div>
  )
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Fleet /> },
      { path: '/panels/:serial', element: <PanelDetail /> },
      { path: '/alerts', element: <Alerts /> },
      { path: '/check', element: <Check /> },
      { path: '/check/:serial', element: <Check /> },
      { path: '/register', element: <Register /> },
      { path: '/account', element: <Account /> },
      { path: '/sensor', element: <Sensor /> },
      { path: '/demo', element: <Demo /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
