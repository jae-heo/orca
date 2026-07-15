import { describe, expect, it } from 'vitest'
import { linuxAppImageName } from './run-neurorca-linux-build.mjs'

describe('Neurorca Linux build wrapper', () => {
  it('uses electron-builder architecture names', () => {
    expect(linuxAppImageName('x64')).toBe('neurorca-linux-x86_64.AppImage')
    expect(linuxAppImageName('arm64')).toBe('neurorca-linux-arm64.AppImage')
  })
})
