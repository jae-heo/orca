#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  expandHomePath,
  loadNeurorcaOperationsConfig,
  parseCommandJson,
  projectDir
} from './neurorca-operations-config.mjs'

function parseArgs(argv) {
  const options = { host: null, json: false, skipRemote: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--host') {
      options.host = argv[++index]
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--skip-remote') {
      options.skipRemote = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? projectDir,
    encoding: 'utf8',
    timeout: options.timeout ?? 30_000
  })
}

function git(args) {
  return run('git', args)
}

function addCheck(checks, name, status, detail) {
  checks.push({ name, status, detail })
}

function commandText(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function readBundleId(appPath) {
  const plist = join(appPath, 'Contents', 'Info.plist')
  if (!existsSync(plist)) {
    return null
  }
  const result = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
  return result.status === 0 ? result.stdout.trim() : null
}

function inspectRepository(checks, config) {
  const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
  const requiredNode = packageJson.engines?.node
  const currentNode = process.versions.node
  const nodeMatches = !requiredNode || currentNode.split('.')[0] === String(requiredNode)
  addCheck(
    checks,
    'local-node',
    nodeMatches ? 'pass' : 'warn',
    `v${currentNode}${requiredNode ? `; package requires ${requiredNode}` : ''}`
  )

  const branch = git(['branch', '--show-current'])
  if (branch.status !== 0) {
    addCheck(checks, 'repository', 'fail', commandText(branch))
    return
  }
  const branchName = branch.stdout.trim()
  addCheck(
    checks,
    'branch',
    branchName === config.requiredBranch ? 'pass' : 'fail',
    `${branchName || '(detached)'}; expected ${config.requiredBranch}`
  )

  const status = git(['status', '--porcelain'])
  const changedCount = status.stdout.trim() ? status.stdout.trim().split('\n').length : 0
  addCheck(
    checks,
    'working-tree',
    changedCount === 0 ? 'pass' : 'warn',
    changedCount === 0 ? 'clean' : `${changedCount} changed path(s); upstream sync must wait`
  )

  for (const ref of config.featureRefs) {
    const exists = git(['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`])
    const merged = exists.status === 0 ? git(['merge-base', '--is-ancestor', ref, 'HEAD']) : null
    addCheck(
      checks,
      `feature:${ref}`,
      exists.status === 0 && merged?.status === 0 ? 'pass' : 'fail',
      exists.status === 0 ? (merged?.status === 0 ? 'merged' : 'not merged') : 'ref missing'
    )
  }
}

function inspectMac(checks, config) {
  if (platform() !== 'darwin') {
    addCheck(checks, 'macos-install', 'warn', `skipped on ${platform()}`)
    return
  }
  const canonical = config.macos.canonicalAppPath
  const bundleId = readBundleId(canonical)
  addCheck(
    checks,
    'macos-canonical-app',
    bundleId === config.macos.bundleId ? 'pass' : 'fail',
    bundleId ? `${canonical} (${bundleId})` : `${canonical} missing or unreadable`
  )

  const relatedApps = readdirSync('/Applications', { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => join('/Applications', entry.name))
    .filter((appPath) => {
      const id = readBundleId(appPath)
      return (
        id === config.macos.bundleId ||
        /^Orca(?:\s|\.|$)|^Neurorca(?:\s|\.|$)/i.test(basename(appPath))
      )
    })
  const duplicates = relatedApps.filter((appPath) => resolve(appPath) !== resolve(canonical))
  addCheck(
    checks,
    'macos-single-install',
    duplicates.length === 0 ? 'pass' : 'fail',
    duplicates.length === 0 ? 'only canonical Neurorca is installed' : duplicates.join(', ')
  )

  const cliPath = expandHomePath(config.macos.cliPath)
  let cliDetail = `${cliPath} missing`
  let cliOk = false
  if (existsSync(cliPath)) {
    const target = lstatSync(cliPath).isSymbolicLink() ? readlinkSync(cliPath) : cliPath
    cliOk = resolve(target).startsWith(resolve(canonical))
    cliDetail = `${cliPath} -> ${target}`
  }
  addCheck(checks, 'macos-cli', cliOk ? 'pass' : 'fail', cliDetail)

  const buildRelative = config.macos.buildApps[arch()]
  const buildApp = buildRelative ? join(projectDir, buildRelative) : null
  const installedBinary = join(canonical, 'Contents', 'MacOS', 'Neurorca')
  const buildBinary = buildApp ? join(buildApp, 'Contents', 'MacOS', 'Neurorca') : null
  if (buildBinary && existsSync(installedBinary) && existsSync(buildBinary)) {
    const installedHash = sha256(installedBinary)
    const buildHash = sha256(buildBinary)
    addCheck(
      checks,
      'macos-build-match',
      installedHash === buildHash ? 'pass' : 'warn',
      installedHash === buildHash
        ? installedHash
        : 'installed app differs from current build output'
    )
  } else {
    addCheck(checks, 'macos-build-match', 'warn', 'current-architecture build output is absent')
  }

  const userDataPath = expandHomePath(config.macos.userDataPath)
  addCheck(
    checks,
    'macos-user-data',
    existsSync(userDataPath) ? 'pass' : 'warn',
    `${userDataPath}${existsSync(userDataPath) ? ' exists' : ' is not initialized'}`
  )
}

function ssh(host, command, timeout = 30_000) {
  return run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, command], { timeout })
}

function inspectRemote(checks, config, host) {
  const nodeVersion = ssh(host, 'node --version')
  const packageJson = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
  const requiredNode = packageJson.engines?.node
  const remoteMajor = nodeVersion.stdout.trim().replace(/^v/, '').split('.')[0]
  addCheck(
    checks,
    'linux-node',
    nodeVersion.status === 0 && (!requiredNode || remoteMajor === String(requiredNode))
      ? 'pass'
      : 'warn',
    `${commandText(nodeVersion) || 'unavailable'}${requiredNode ? `; package requires ${requiredNode}` : ''}`
  )

  const service = config.linux.serviceName
  const active = ssh(host, `systemctl is-active ${service}`)
  addCheck(
    checks,
    'linux-service-active',
    active.status === 0 && active.stdout.trim() === 'active' ? 'pass' : 'fail',
    commandText(active) || 'no response'
  )
  const enabled = ssh(host, `systemctl is-enabled ${service}`)
  addCheck(
    checks,
    'linux-service-enabled',
    enabled.status === 0 && enabled.stdout.trim() === 'enabled' ? 'pass' : 'fail',
    commandText(enabled) || 'no response'
  )

  const execStart = ssh(host, `systemctl show ${service} -p ExecStart --value`)
  addCheck(
    checks,
    'linux-service-binary',
    execStart.status === 0 && execStart.stdout.includes(config.linux.installedAppImage)
      ? 'pass'
      : 'fail',
    commandText(execStart) || 'no ExecStart'
  )

  const status = ssh(host, `${config.linux.cliPath} status --json`)
  try {
    const parsed = parseCommandJson(status.stdout, 'remote Neurorca status')
    const ready = parsed.ok === true && parsed.result?.runtime?.state === 'ready'
    addCheck(checks, 'linux-runtime', ready ? 'pass' : 'fail', ready ? 'ready' : 'not ready')
  } catch (error) {
    addCheck(checks, 'linux-runtime', 'fail', `${error.message} ${commandText(status)}`.trim())
  }

  const terminals = ssh(host, `${config.linux.cliPath} terminal list --limit 1 --json`)
  try {
    const parsed = parseCommandJson(terminals.stdout, 'remote terminal list')
    const count = parsed.result?.totalCount
    addCheck(
      checks,
      'linux-live-terminals',
      count === 0 ? 'pass' : 'warn',
      `${count ?? 'unknown'} live terminal(s); never restart or kill the daemon while nonzero`
    )
  } catch (error) {
    addCheck(checks, 'linux-live-terminals', 'fail', error.message)
  }

  const oldFiles = ssh(
    host,
    `find /etc/systemd/system /usr/local/libexec /home/${config.linux.serviceUser}/.local/libexec -maxdepth 1 ` +
      `\\( -iname 'orca-ide*' -o -iname 'neurorca*.previous*' -o -iname 'neurorca*.backup*' ` +
      `-o -iname 'neurorca*.rollback*' -o -iname 'neurorca*.new' \\) -print 2>/dev/null`
  )
  const leftovers = oldFiles.stdout.trim()
  addCheck(
    checks,
    'linux-old-installations',
    oldFiles.status === 0 && !leftovers ? 'pass' : 'fail',
    leftovers || 'none'
  )

  const protectedData = ssh(host, `test -d '${config.linux.userDataPath}'`)
  addCheck(
    checks,
    'linux-user-data',
    protectedData.status === 0 ? 'pass' : 'fail',
    `${config.linux.userDataPath}${protectedData.status === 0 ? ' exists' : ' missing'}`
  )
}

export function inspectNeurorca(options = {}) {
  const config = loadNeurorcaOperationsConfig()
  const host = options.host ?? config.linux.defaultHost
  const checks = []
  inspectRepository(checks, config)
  inspectMac(checks, config)
  if (!options.skipRemote) {
    inspectRemote(checks, config, host)
  }
  return { host, checks }
}

function printReport(report, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return
  }
  for (const check of report.checks) {
    console.log(`${check.status.toUpperCase().padEnd(4)} ${check.name}: ${check.detail}`)
  }
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = inspectNeurorca(options)
  printReport(report, options.json)
  if (report.checks.some((check) => check.status === 'fail')) {
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main()
}
