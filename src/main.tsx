import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const loadingScreen = document.getElementById('loading-screen')
if (loadingScreen) {
  const appReadyTime = performance.now()
  const minDisplayMs = 2000
  const elapsed = appReadyTime
  const remaining = Math.max(0, minDisplayMs - elapsed)
  setTimeout(() => {
    loadingScreen.style.transition = 'opacity 400ms ease-out'
    loadingScreen.style.opacity = '0'
    setTimeout(() => loadingScreen.remove(), 400)
  }, remaining)
}
