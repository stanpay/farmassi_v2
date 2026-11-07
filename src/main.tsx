import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import { listenNativeAuthRedirect } from './lib/nativeAuthRedirect'
import { registerServiceWorker } from './lib/push'

void registerServiceWorker()
listenNativeAuthRedirect()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
