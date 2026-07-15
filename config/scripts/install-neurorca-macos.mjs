#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync
} from 'node:fs'
import { arch, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  expandHomePath,
  loadNeurorcaOperationsConfig,
  parseCommandJson,
  projectDir
} from './neurorca-operations-config.mjs'
import { readNeurorcaProvenance } from './neurorca-build-provenance.mjs'

export function parseMacInstallArgs(argv) {
  const options = { appPath: null, dryRun: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--app') {
      options.appPath = argv[++index]
      if (!options.appPath) {
        throw new Error('--app requires a path.')
      }
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

export function selectMacBuildApp(config, cpuArch = arch()) {
  const relative = config.macos.buildApps[cpuArch]
  if (!relative) {
    throw new Error(`No Neurorca macOS build path is configured for ${cpuArch}.`)
  }
  return join(projectDir, relative)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectDir,
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000,
    stdio: options.inherit ? 'inherit' : 'pipe'
  })
  if (result.error) {
    throw result.error
  }
  return result
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()}`)
  }
}

function readBundleValue(appPath, key) {
  const plist = join(appPath, 'Contents', 'Info.plist')
  const result = run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist])
  return result.status === 0 ? result.stdout.trim() : null
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function appBinary(appPath) {
  return join(appPath, 'Contents', 'MacOS', 'Neurorca')
}

function appProvenance(appPath, config) {
  return readNeurorcaProvenance(
    join(appPath, 'Contents', 'Resources', config.provenance.resourceName)
  )
}

export function shouldPruneMacApp(appPath, canonicalPath, bundleId, obsoleteBundleIds) {
  if (resolve(appPath) === resolve(canonicalPath)) {
    return false
  }
  return bundleId === 'com.neurocore.neurorca' || obsoleteBundleIds.includes(bundleId)
}

function relatedApplicationCopies(config) {
  return readdirSync('/Applications', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => join('/Applications', entry.name))
    .map((appPath) => ({ appPath, bundleId: readBundleValue(appPath, 'CFBundleIdentifier') }))
    .filter(({ appPath, bundleId }) => {
      return (
        shouldPruneMacApp(
          appPath,
          config.macos.canonicalAppPath,
          bundleId,
          config.macos.obsoleteBundleIds
        ) || resolve(appPath) === resolve(config.macos.canonicalAppPath)
      )
    })
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function canonicalAppRunning(canonicalPath) {
  return applicationRunning(canonicalPath)
}

function applicationRunning(appPath) {
  const executableName = readBundleValue(appPath, 'CFBundleExecutable')
  if (!executableName) {
    return false
  }
  const executable = join(appPath, 'Contents', 'MacOS', executableName)
  return run('/usr/bin/pgrep', ['-f', '-x', executable]).status === 0
}

function waitForCanonicalAppExit(canonicalPath) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!canonicalAppRunning(canonicalPath)) {
      return
    }
    wait(250)
  }
  throw new Error('Neurorca did not quit gracefully; refusing to kill it or its session daemon.')
}

function liveTerminalCount(cliPath) {
  if (!existsSync(cliPath)) {
    return null
  }
  const result = run(cliPath, ['terminal', 'list', '--limit', '1', '--json'])
  if (result.status !== 0) {
    return null
  }
  return parseCommandJson(result.stdout, 'Neurorca terminal list').result?.totalCount ?? null
}

function waitForReady(cliPath) {
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = run(cliPath, ['status', '--json'], { timeout: 5_000 })
    if (result.status === 0) {
      try {
        const parsed = parseCommandJson(result.stdout, 'Neurorca status')
        if (parsed.ok === true && parsed.result?.runtime?.state === 'ready') {
          return
        }
      } catch {
        // The app can briefly emit incomplete startup output before readiness.
      }
    }
    wait(250)
  }
  throw new Error('The newly installed Neurorca app did not become ready within 30 seconds.')
}

function unregisterApplication(appPath) {
  const lsregister =
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/' +
    'LaunchServices.framework/Support/lsregister'
  run(lsregister, ['-u', appPath])
}

function pruneApplicationCopies(config) {
  const canonical = config.macos.canonicalAppPath
  for (const { appPath, bundleId } of relatedApplicationCopies(config)) {
    if (
      shouldPruneMacApp(appPath, canonical, bundleId, config.macos.obsoleteBundleIds) &&
      existsSync(appPath)
    ) {
      if (applicationRunning(appPath)) {
        throw new Error(`Refusing to remove a running obsolete app: ${appPath}`)
      }
      unregisterApplication(appPath)
      rmSync(appPath, { recursive: true, force: true })
    }
  }
}

function currentCliTarget(config) {
  const cliPath = expandHomePath(config.macos.cliPath)
  if (!existsSync(cliPath)) {
    return null
  }
  return lstatSync(cliPath).isSymbolicLink() ? readlinkSync(cliPath) : cliPath
}

export function installNeurorcaMac(options = {}) {
  if (platform() !== 'darwin') {
    throw new Error('The Neurorca macOS installer must run on macOS.')
  }
  const config = loadNeurorcaOperationsConfig()
  const sourceApp = resolve(options.appPath ?? selectMacBuildApp(config))
  const canonical = config.macos.canonicalAppPath
  const bundleId = readBundleValue(sourceApp, 'CFBundleIdentifier')
  if (!existsSync(sourceApp) || bundleId !== config.macos.bundleId) {
    throw new Error(`${sourceApp} is not a Neurorca app bundle (${config.macos.bundleId}).`)
  }
  requireSuccess(
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', sourceApp]),
    'Neurorca code-signature verification'
  )

  const version = readBundleValue(sourceApp, 'CFBundleShortVersionString')
  const sourceProvenance = appProvenance(sourceApp, config)
  const sourceHash = sha256(appBinary(sourceApp))
  const installedHash = existsSync(appBinary(canonical)) ? sha256(appBinary(canonical)) : null
  let installedCommit = null
  try {
    installedCommit = appProvenance(canonical, config).sourceCommit
  } catch {
    // Older local builds had no provenance and must be replaced once.
  }
  const sameBuild =
    sourceHash === installedHash && sourceProvenance.sourceCommit === installedCommit
  const duplicateCount = relatedApplicationCopies(config).filter(
    ({ appPath }) => resolve(appPath) !== resolve(canonical)
  ).length
  if (options.dryRun) {
    return {
      sourceApp,
      canonical,
      version,
      sourceHash,
      installedHash,
      sourceCommit: sourceProvenance.sourceCommit,
      installedCommit,
      duplicateCount,
      cliTarget: currentCliTarget(config),
      changed: !sameBuild || duplicateCount > 0
    }
  }
  if (sameBuild) {
    pruneApplicationCopies(config)
    return {
      sourceApp,
      canonical,
      version,
      sourceHash,
      sourceCommit: sourceProvenance.sourceCommit,
      changed: duplicateCount > 0
    }
  }

  const staged = `/Applications/.Neurorca.install-${process.pid}.app`
  const rollback = `/Applications/.Neurorca.rollback-${process.pid}.app`
  rmSync(staged, { recursive: true, force: true })
  rmSync(rollback, { recursive: true, force: true })
  requireSuccess(run('/usr/bin/ditto', [sourceApp, staged]), 'Staging Neurorca')
  requireSuccess(
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged]),
    'Staged Neurorca code-signature verification'
  )

  const wasRunning = canonicalAppRunning(canonical)
  const cliBefore = expandHomePath(config.macos.cliPath)
  const terminalCount = liveTerminalCount(cliBefore)
  if (wasRunning) {
    requireSuccess(
      run('/usr/bin/osascript', ['-e', `tell application id "${config.macos.bundleId}" to quit`]),
      'Graceful Neurorca quit'
    )
    waitForCanonicalAppExit(canonical)
  }

  let movedCurrent = false
  let preserveRollback = false
  try {
    if (existsSync(canonical)) {
      renameSync(canonical, rollback)
      movedCurrent = true
    }
    renameSync(staged, canonical)
    requireSuccess(run('/usr/bin/open', [canonical]), 'Launching Neurorca')
    const installedCli = join(canonical, 'Contents', 'Resources', 'bin', 'neurorca')
    waitForReady(installedCli)
    pruneApplicationCopies(config)
    rmSync(rollback, { recursive: true, force: true })
    return {
      sourceApp,
      canonical,
      version,
      sourceHash,
      sourceCommit: sourceProvenance.sourceCommit,
      changed: true,
      terminalCount
    }
  } catch (error) {
    if (canonicalAppRunning(canonical)) {
      // Why: removing a live bundle can orphan helpers; preserve both bundles
      // when graceful shutdown cannot make rollback safe.
      const quit = run('/usr/bin/osascript', [
        '-e',
        `tell application id "${config.macos.bundleId}" to quit`
      ])
      try {
        requireSuccess(quit, 'Graceful quit before rollback')
        waitForCanonicalAppExit(canonical)
      } catch (quitError) {
        preserveRollback = true
        throw new Error(
          `${error.message} Rollback was not attempted because the new app would not quit. ` +
            `The previous bundle remains at ${rollback}. ${quitError.message}`
        )
      }
    }
    rmSync(canonical, { recursive: true, force: true })
    if (movedCurrent && existsSync(rollback)) {
      renameSync(rollback, canonical)
      if (wasRunning) {
        run('/usr/bin/open', [canonical])
      }
    }
    throw error
  } finally {
    rmSync(staged, { recursive: true, force: true })
    if (!preserveRollback) {
      rmSync(rollback, { recursive: true, force: true })
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  const result = installNeurorcaMac(parseMacInstallArgs(argv))
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main()
}
