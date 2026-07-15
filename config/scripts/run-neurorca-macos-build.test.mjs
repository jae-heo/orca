import { describe, expect, it } from 'vitest'
import { createXcodebuildVersionShim, parseAppleClangVersion } from './run-neurorca-macos-build.mjs'

describe('Neurorca macOS build CLT fallback', () => {
  it('derives the node-gyp Xcode version from Apple clang', () => {
    expect(parseAppleClangVersion('Apple clang version 16.0.0 (clang-1600.0.26.3)')).toBe('16.0')
    expect(parseAppleClangVersion('Apple clang version 17.1.2')).toBe('17.1')
  })

  it('rejects compiler output that cannot identify Apple clang', () => {
    expect(() => parseAppleClangVersion('clang version unknown')).toThrow(
      'Could not derive an Xcode-compatible version'
    )
  })

  it('creates a version-only shim that delegates every other invocation', () => {
    const shim = createXcodebuildVersionShim('16.0')

    expect(shim).toContain('echo "Xcode 16.0"')
    expect(shim).toContain('echo "Build version 16A000"')
    expect(shim).toContain('exec /usr/bin/xcodebuild "$@"')
  })
})
