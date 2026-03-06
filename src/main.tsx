import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const MIN_LOADING_DISPLAY_MS = 2000
const LOADING_FADE_OUT_MS = 400
const APP_BOOT_TIMEOUT_MS = 10000

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Missing #root element.')
}

const root = createRoot(rootElement)
const loadingScreen = document.getElementById('loading-screen')
const bootStartedAt = performance.now()

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}

function toBootMessage(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message
  }

  return 'Unknown bootstrap error.'
}

async function hideLoadingScreen(): Promise<void> {
  if (loadingScreen === null) {
    return
  }

  const elapsed = performance.now() - bootStartedAt
  const remaining = Math.max(0, MIN_LOADING_DISPLAY_MS - elapsed)

  await wait(remaining)
  loadingScreen.style.transition = `opacity ${LOADING_FADE_OUT_MS}ms ease-out`
  loadingScreen.style.opacity = '0'
  await wait(LOADING_FADE_OUT_MS)
  loadingScreen.remove()
}

function renderBootError(caught: unknown): void {
  const message = toBootMessage(caught)

  root.render(
    <StrictMode>
      <main className="game-shell">
        <section className="hub-frame" aria-label="app-boot-error">
          <header className="hub-header">
            <div>
              <h1>App Boot Failed</h1>
            </div>
          </header>
          <p className="error-toast">{message}</p>
        </section>
      </main>
    </StrictMode>,
  )
}

async function loadAppModule(): Promise<typeof import('./App.tsx')> {
  return await new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`App bootstrap timed out after ${APP_BOOT_TIMEOUT_MS}ms.`))
    }, APP_BOOT_TIMEOUT_MS)

    void import('./App.tsx').then(
      (module) => {
        window.clearTimeout(timeoutId)
        resolve(module)
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

async function bootstrap(): Promise<void> {
  try {
    const { default: App } = await loadAppModule()
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  } catch (caught) {
    console.error('Failed to bootstrap app.', caught)
    renderBootError(caught)
  } finally {
    await hideLoadingScreen()
  }
}

void bootstrap()
