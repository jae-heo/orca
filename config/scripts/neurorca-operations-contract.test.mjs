import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadNeurorcaOperationsConfig, projectDir } from './neurorca-operations-config.mjs'

function read(relativePath) {
  return readFileSync(join(projectDir, relativePath), 'utf8')
}

describe('Neurorca durable operations handoff', () => {
  it('keeps every public operation wired through package scripts', () => {
    const packageJson = JSON.parse(read('package.json'))
    expect(packageJson.scripts).toMatchObject({
      'neurorca:doctor': 'node config/scripts/doctor-neurorca.mjs',
      'neurorca:install:mac': 'node config/scripts/install-neurorca-macos.mjs',
      'neurorca:build:linux:remote': 'node config/scripts/build-neurorca-linux-remote.mjs',
      'neurorca:deploy:linux': 'node config/scripts/deploy-neurorca-linux.mjs'
    })
  })

  it('makes the operational handoff mandatory for future agents', () => {
    const agents = read('AGENTS.md')
    expect(agents).toContain('docs/reference/neurorca-operations.md')
    expect(agents).toContain('pnpm neurorca:doctor')
    expect(agents).toContain('Never identify a detached Neurorca terminal daemon as stale')
    expect(agents).toContain('Pairing URLs and device tokens are secrets')
  })

  it('documents protected state and the Mac to Linux to p8 topology', () => {
    const operations = read('docs/reference/neurorca-operations.md')
    expect(operations).toContain('/Applications/Neurorca.app')
    expect(operations).toContain('/home/jae/.config/Neurorca')
    expect(operations).toContain('linux-jae')
    expect(operations).toContain('ssh-p8')
    expect(operations).toContain('--allow-live-terminal-loss')
  })

  it('keeps destructive process cleanup out of the Linux root installer', () => {
    const installer = read('config/scripts/install-neurorca-linux-root.sh')
    const terminalGate = installer.indexOf('terminal list --limit 1 --json')
    const restart = installer.indexOf('systemctl restart "$service"')
    expect(terminalGate).toBeGreaterThan(-1)
    expect(restart).toBeGreaterThan(terminalGate)
    expect(installer).not.toMatch(/\bpkill\b|kill\s+--\s+-|daemon-v22\.sock.*rm/)
    expect(installer).toContain('rollback_install')
  })

  it('stores only stable topology values in the machine-readable config', () => {
    const config = loadNeurorcaOperationsConfig()
    expect(config.requiredBranch).toBe('local/neurorca')
    expect(config.macos.canonicalAppPath).toBe('/Applications/Neurorca.app')
    expect(config.linux.installedAppImage).toBe('/usr/local/libexec/neurorca-server.AppImage')
    expect(JSON.stringify(config)).not.toMatch(/runtimeId|deviceToken|pair\?code/)
  })

  it('drives upstream sync from the same machine-readable branch contract', () => {
    const syncScript = read('config/scripts/sync-neurorca-upstream.mjs')
    expect(syncScript).toContain('loadNeurorcaOperationsConfig')
    expect(syncScript).toContain('operationsConfig.requiredBranch')
    expect(syncScript).toContain('operationsConfig.featureRefs')
  })
})
