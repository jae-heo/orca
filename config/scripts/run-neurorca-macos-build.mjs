#!/usr/bin/env node

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectDir = resolve(import.meta.dirname, '../..')
const CLT_PACKAGE_IDS = [
  'com.apple.pkg.CLTools_Executables',
  'com.apple.pkg.DeveloperToolsCLILeo',
  'com.apple.pkg.DeveloperToolsCLI'
]

export function parseAppleClangVersion(output) {
  const match = output.match(/Apple clang version\s+(\d+)(?:\.(\d+))?/)
  if (!match) {
    throw new Error('Could not derive an Xcode-compatible version from `xcrun clang --version`.')
  }
  return `${match[1]}.${match[2] ?? '0'}`
}

export function createXcodebuildVersionShim(version) {
  const major = version.split('.')[0]
  return `#!/bin/sh
if [ "$1" = "-version" ]; then
  echo "Xcode ${version}"
  echo "Build version ${major}A000"
  exit 0
fi
exec /usr/bin/xcodebuild "$@"
`
}

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' })
}

function hasGypDiscoverableDeveloperToolsVersion() {
  const xcode = run('/usr/bin/xcodebuild', ['-version'])
  if (xcode.status === 0 && /^Xcode\s+/m.test(xcode.stdout)) {
    return true
  }

  for (const packageId of CLT_PACKAGE_IDS) {
    const receipt = run('/usr/sbin/pkgutil', ['--pkg-info', packageId])
    if (receipt.status === 0 && /^version:\s+/m.test(receipt.stdout)) {
      return true
    }
  }

  const history = run('/usr/sbin/softwareupdate', ['--history'])
  return history.status === 0 && /Command Line Tools for Xcode\s+\S+/.test(history.stdout)
}

function requireWorkingCltCommand(command, args, label) {
  const result = run(command, args)
  if (result.status !== 0) {
    throw new Error(
      `${label} is unavailable. Install or repair Xcode Command Line Tools before building Neurorca.`
    )
  }
  return result.stdout
}

function prepareBuildEnvironment() {
  const env = { ...process.env, NEURORCA_BUILD: '1' }
  if (hasGypDiscoverableDeveloperToolsVersion()) {
    return { env, temporaryDirectory: null }
  }

  requireWorkingCltCommand('/usr/bin/xcrun', ['--show-sdk-path'], 'The macOS SDK')
  const clangVersionOutput = requireWorkingCltCommand(
    '/usr/bin/xcrun',
    ['clang', '--version'],
    'Apple clang'
  )
  requireWorkingCltCommand('/usr/bin/make', ['--version'], 'make')

  const xcodeVersion = parseAppleClangVersion(clangVersionOutput)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'neurorca-xcodebuild-'))
  const shimPath = join(temporaryDirectory, 'xcodebuild')
  writeFileSync(shimPath, createXcodebuildVersionShim(xcodeVersion), { mode: 0o755 })
  chmodSync(shimPath, 0o755)
  env.PATH = `${temporaryDirectory}${delimiter}${env.PATH ?? ''}`
  console.warn(
    `[neurorca] CLT binaries are available but their version receipt is missing; ` +
      `using a temporary Xcode ${xcodeVersion} version shim for node-gyp.`
  )
  return { env, temporaryDirectory }
}

export function main() {
  if (process.platform !== 'darwin') {
    throw new Error('The Neurorca macOS build command must run on macOS.')
  }

  const { env, temporaryDirectory } = prepareBuildEnvironment()
  try {
    const result = spawnSync('pnpm', ['run', 'build:mac'], {
      cwd: projectDir,
      env,
      stdio: 'inherit'
    })
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1
    }
  } finally {
    if (temporaryDirectory) {
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main()
}
