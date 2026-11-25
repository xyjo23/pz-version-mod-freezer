import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helperPath = fileURLToPath(new URL('./lock-file-helper.ps1', import.meta.url))
const denyReadHelperPath = fileURLToPath(new URL('./deny-read-helper.ps1', import.meta.url))

export type HeldFileLock = {
  release: () => Promise<void>
}

const holdPowerShellFault = (scriptPath: string, readyMarker: string, filePath: string): Promise<HeldFileLock> => new Promise((resolve, reject) => {
  const child: ChildProcessWithoutNullStreams = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath, '-LiteralPath', filePath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  let settled = false
  const fail = (error: Error): void => {
    if (settled) return
    settled = true
    reject(error)
  }
  child.on('error', fail)
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
    if (settled || !stdout.includes(readyMarker)) return
    settled = true
    resolve({
      release: () => new Promise<void>((releaseResolve, releaseReject) => {
        child.once('error', releaseReject)
        child.once('close', (code) => code === 0 ? releaseResolve() : releaseReject(new Error(`File-lock helper exited with ${code}: ${stderr.trim()}`)))
        child.stdin.end('\n')
      })
    })
  })
  child.once('close', (code) => {
    if (!settled) fail(new Error(`File-lock helper exited before acquiring the lock (${code}): ${stderr.trim()}`))
  })
})

export const holdExclusiveFileLock = (filePath: string): Promise<HeldFileLock> => holdPowerShellFault(helperPath, 'LOCKED', filePath)

export const holdReadDenied = (filePath: string): Promise<HeldFileLock> => holdPowerShellFault(denyReadHelperPath, 'DENIED', filePath)
