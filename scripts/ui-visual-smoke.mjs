import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { app, BrowserWindow } from 'electron'
import { createServer } from 'vite'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = process.env.PZ_UI_VISUAL_OUTPUT ?? path.join(projectRoot, '.release-smoke', 'ui-visual')

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const waitFor = async (window, predicate, label, timeout = 8000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    if (await window.webContents.executeJavaScript(predicate)) return
    await wait(100)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

const finishFiniteAnimations = (window) => window.webContents.executeJavaScript(`
  document.getAnimations().forEach((animation) => {
    if (animation.effect?.getTiming().iterations !== Infinity) animation.finish()
  })
`)

const revealFinalFrame = (window) => window.webContents.executeJavaScript(`
  if (!document.querySelector('#visual-smoke-final-frame')) {
    const style = document.createElement('style')
    style.id = 'visual-smoke-final-frame'
    style.textContent = '.view-stage,.enter,.command-backdrop,.command-palette{animation:none!important;opacity:1!important;transform:none!important;filter:none!important}'
    document.head.append(style)
  }
`)

const main = async () => {
  await fs.mkdir(outputRoot, { recursive: true })
  const server = await createServer({
    configFile: false,
    root: path.join(projectRoot, 'src', 'renderer'),
    plugins: [react()],
    resolve: { alias: { '@renderer': path.join(projectRoot, 'src', 'renderer', 'src') } },
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error'
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local?.[0]
  if (!baseUrl) throw new Error('Vite did not expose a local preview URL.')
  await app.whenReady()
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    frame: false,
    backgroundColor: '#060a08',
    webPreferences: { backgroundThrottling: false }
  })
  const capture = async (name, query) => {
    await window.loadURL(`${baseUrl}?${query}`)
    await window.webContents.executeJavaScript('document.fonts.ready')
    await waitFor(window, "Boolean(document.querySelector('.view-stage h1'))", `${name} page content`)
    await revealFinalFrame(window)
    await wait(250)
    await finishFiniteAnimations(window)
    await window.capturePage()
    await wait(100)
    const image = await window.capturePage()
    const destination = path.join(outputRoot, `${name}.png`)
    await fs.writeFile(destination, image.toPNG())
    return destination
  }
  const captures = []
  for (const view of ['console', 'mods', 'versions', 'maintenance', 'help', 'settings']) captures.push(await capture(view, `view=${view}&versionView=radar`))
  await window.loadURL(`${baseUrl}?view=console`)
  await window.webContents.executeJavaScript('document.fonts.ready')
  await waitFor(window, "Boolean(document.querySelector('.view-stage h1'))", 'console page content')
  await window.webContents.executeJavaScript("document.querySelector('.command-trigger')?.click()")
  await waitFor(window, "Boolean(document.querySelector('.command-palette'))", 'command palette')
  await revealFinalFrame(window)
  await wait(150)
  await finishFiniteAnimations(window)
  const commandImage = await window.capturePage()
  const commandPath = path.join(outputRoot, 'command-palette.png')
  await fs.writeFile(commandPath, commandImage.toPNG())
  captures.push(commandPath)
  console.log(`UI_VISUAL_SMOKE=${JSON.stringify({ outputRoot, width: 1440, height: 900, captures })}`)
  window.destroy()
  await server.close()
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`UI_VISUAL_SMOKE_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
