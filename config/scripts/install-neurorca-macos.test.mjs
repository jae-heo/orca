import { describe, expect, it } from 'vitest'
import { loadNeurorcaOperationsConfig } from './neurorca-operations-config.mjs'
import {
  parseMacInstallArgs,
  selectMacBuildApp,
  shouldPruneMacApp
} from './install-neurorca-macos.mjs'

describe('Neurorca macOS installation contract', () => {
  const config = loadNeurorcaOperationsConfig()

  it('selects the architecture-specific build output', () => {
    expect(selectMacBuildApp(config, 'arm64')).toMatch(/dist\/mac-arm64\/Neurorca\.app$/)
    expect(selectMacBuildApp(config, 'x64')).toMatch(/dist\/mac\/Neurorca\.app$/)
  })

  it('parses dry-run and explicit app options', () => {
    expect(parseMacInstallArgs(['--', '--dry-run', '--app', '/tmp/Neurorca.app'])).toEqual({
      appPath: '/tmp/Neurorca.app',
      dryRun: true
    })
    expect(() => parseMacInstallArgs(['--app'])).toThrow('--app requires a path')
    expect(() => parseMacInstallArgs(['--unknown'])).toThrow('Unknown argument')
  })

  it('keeps only the canonical integration app', () => {
    const canonical = '/Applications/Neurorca.app'
    expect(
      shouldPruneMacApp(
        canonical,
        canonical,
        'com.neurocore.neurorca',
        config.macos.obsoleteBundleIds
      )
    ).toBe(false)
    expect(
      shouldPruneMacApp(
        '/Applications/Neurorca.previous.app',
        canonical,
        'com.neurocore.neurorca',
        config.macos.obsoleteBundleIds
      )
    ).toBe(true)
    expect(
      shouldPruneMacApp(
        '/Applications/Orca PR.app',
        canonical,
        'com.stablyai.orca',
        config.macos.obsoleteBundleIds
      )
    ).toBe(true)
  })
})
