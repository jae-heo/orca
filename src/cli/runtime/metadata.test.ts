import { afterEach, describe, expect, it } from 'vitest'
import { getDefaultUserDataPath } from './metadata'

const originalAppData = process.env.APPDATA
const originalCliCommand = process.env.ORCA_CLI_COMMAND
const originalOverride = process.env.ORCA_USER_DATA_PATH
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME

afterEach(() => {
  restoreEnv('APPDATA', originalAppData)
  restoreEnv('ORCA_CLI_COMMAND', originalCliCommand)
  restoreEnv('ORCA_USER_DATA_PATH', originalOverride)
  restoreEnv('XDG_CONFIG_HOME', originalXdgConfigHome)
})

describe('getDefaultUserDataPath', () => {
  it('keeps the official Orca paths unchanged', () => {
    process.env.APPDATA = 'C:\\Users\\jae\\AppData\\Roaming'
    process.env.XDG_CONFIG_HOME = '/home/jae/config'

    expect(getDefaultUserDataPath('darwin', '/Users/jae', 'orca')).toBe(
      '/Users/jae/Library/Application Support/orca'
    )
    expect(getDefaultUserDataPath('win32', 'C:\\Users\\jae', 'orca')).toBe(
      'C:\\Users\\jae\\AppData\\Roaming/orca'
    )
    expect(getDefaultUserDataPath('linux', '/home/jae', 'orca')).toBe('/home/jae/config/orca')
  })

  it('uses an isolated Neurorca path on every desktop platform', () => {
    process.env.APPDATA = 'C:\\Users\\jae\\AppData\\Roaming'
    process.env.XDG_CONFIG_HOME = '/home/jae/config'

    expect(getDefaultUserDataPath('darwin', '/Users/jae', 'neurorca')).toBe(
      '/Users/jae/Library/Application Support/Neurorca'
    )
    expect(getDefaultUserDataPath('win32', 'C:\\Users\\jae', 'neurorca')).toBe(
      'C:\\Users\\jae\\AppData\\Roaming/Neurorca'
    )
    expect(getDefaultUserDataPath('linux', '/home/jae', 'neurorca')).toBe(
      '/home/jae/config/Neurorca'
    )
  })

  it('detects the Neurorca distribution from its packaged launcher marker', () => {
    process.env.ORCA_CLI_COMMAND = 'neurorca'

    expect(getDefaultUserDataPath('darwin', '/Users/jae')).toBe(
      '/Users/jae/Library/Application Support/Neurorca'
    )
  })

  it('prefers an explicit runtime path over distribution defaults', () => {
    process.env.ORCA_USER_DATA_PATH = '/tmp/custom-neurorca'

    expect(getDefaultUserDataPath('darwin', '/Users/jae', 'neurorca')).toBe('/tmp/custom-neurorca')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
