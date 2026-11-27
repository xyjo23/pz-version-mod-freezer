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

const scrollToSelector = (window, selector, offset = 18) => window.webContents.executeJavaScript(`(() => {
  const scroller = document.querySelector('.main-content')
  const target = document.querySelector(${JSON.stringify(selector)})
  if (!scroller || !target) return false
  scroller.style.scrollBehavior = 'auto'
  scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - ${offset}
  return true
})()`)

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
  const captureFrame = async (name) => {
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
  const capture = async (name, query) => {
    await window.loadURL(`${baseUrl}?${query}`)
    await window.webContents.executeJavaScript('document.fonts.ready')
    await waitFor(window, "Boolean(document.querySelector('.view-stage h1'))", `${name} page content`)
    return captureFrame(name)
  }
  const captures = []
  for (const view of ['console', 'mods', 'versions', 'maintenance', 'help', 'settings']) captures.push(await capture(view, `view=${view}&versionView=radar`))

  await window.loadURL(`${baseUrl}?view=versions&versionView=radar`)
  await waitFor(window, "document.querySelectorAll('.radar-blip').length > 1", 'version radar points')
  await window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll('.radar-blip')].find((element) => element.getAttribute('aria-pressed') === 'false')
    if (!target) return
    target.setAttribute('data-visual-target', 'true')
    target.click()
  })()`)
  await waitFor(window, "document.querySelector('[data-visual-target=\"true\"]')?.getAttribute('aria-pressed') === 'true'", 'radar selection change')
  captures.push(await captureFrame('versions-selected'))

  await window.loadURL(`${baseUrl}?view=maintenance`)
  await waitFor(window, "Boolean(document.querySelector('.migration-workflow input'))", 'migration workflow')
  await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.migration-workflow input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, '视觉验收迁移版本')
    input?.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(window, "Boolean(document.querySelector('.migration-preview.ready'))", 'ready migration preview')
  await scrollToSelector(window, '.migration-preview', 180)
  captures.push(await captureFrame('migration-ready'))

  const captureAnalysis = async (mode) => {
    await window.loadURL(`${baseUrl}?view=maintenance`)
    await waitFor(window, "Boolean(document.querySelector('.maintenance-mode-tabs'))", `${mode} analysis workspace`)
    await window.webContents.executeJavaScript("document.querySelectorAll('.maintenance-mode-tabs button')[1]?.click()")
    await waitFor(window, "document.querySelectorAll('.analysis-selector').length === 2", `${mode} analysis selectors`)
    const selectorIndex = mode === 'integrity' ? 0 : 1
    await window.webContents.executeJavaScript(`document.querySelectorAll('.analysis-selector .tool-action')[${selectorIndex}]?.click()`)
    await waitFor(window, `Boolean(document.querySelector('.${mode === 'integrity' ? 'integrity-report' : 'compatibility-report'}'))`, `${mode} report`)
    await scrollToSelector(window, '.analysis-result-workspace', 18)
    return captureFrame(`analysis-${mode}`)
  }
  captures.push(await captureAnalysis('integrity'))
  captures.push(await captureAnalysis('compatibility'))

  await window.loadURL(`${baseUrl}?view=console`)
  await window.webContents.executeJavaScript('document.fonts.ready')
  await waitFor(window, "Boolean(document.querySelector('.view-stage h1'))", 'console page content')
  await window.webContents.executeJavaScript("document.querySelector('.command-trigger')?.click()")
  await waitFor(window, "Boolean(document.querySelector('.command-palette'))", 'command palette')
  captures.push(await captureFrame('command-palette'))
  console.log(`UI_VISUAL_SMOKE=${JSON.stringify({ outputRoot, width: 1440, height: 900, captures })}`)
  window.destroy()
  await server.close()
}

void main().then(() => app.quit()).catch((error) => {
  console.error(`UI_VISUAL_SMOKE_FATAL=${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
