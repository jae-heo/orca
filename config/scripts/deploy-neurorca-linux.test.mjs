import { describe, expect, it } from 'vitest'
import { parseLinuxDeployArgs, shellQuote } from './deploy-neurorca-linux.mjs'

describe('Neurorca Linux deployment contract', () => {
  it('defaults to a safe deployment without live-session loss', () => {
    expect(parseLinuxDeployArgs([])).toEqual({
      host: null,
      artifact: null,
      allowLiveTerminalLoss: false,
      dryRun: false
    })
  })

  it('makes the destructive override explicit', () => {
    expect(
      parseLinuxDeployArgs([
        '--',
        '--host',
        'linux-jae',
        '--artifact',
        '/tmp/Neurorca build.AppImage',
        '--allow-live-terminal-loss',
        '--dry-run'
      ])
    ).toEqual({
      host: 'linux-jae',
      artifact: '/tmp/Neurorca build.AppImage',
      allowLiveTerminalLoss: true,
      dryRun: true
    })
  })

  it('quotes remote shell arguments', () => {
    expect(shellQuote('/tmp/Neurorca build.AppImage')).toBe("'/tmp/Neurorca build.AppImage'")
    expect(shellQuote("a'b")).toBe("'a'\"'\"'b'")
  })
})
