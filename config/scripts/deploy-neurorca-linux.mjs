#!/usr/bin/env node

import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  loadNeurorcaOperationsConfig,
  parseCommandJson,
  projectDir
} from './neurorca-operations-config.mjs'

const scriptsDir = import.meta.dirname
const rootInstaller = join(scriptsDir, 'install-neurorca-linux-root.sh')

export function parseLinuxDeployArgs(argv) {
  const options = { host: null, artifact: null, allowLiveTerminalLoss: false, dryRun: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--host') {
      options.host = argv[++index]
      if (!options.host) {
        throw new Error('--host requires a value.')
      }
    } else if (arg === '--artifact') {
      options.artifact = argv[++index]
      if (!options.artifact) {
        throw new Error('--artifact requires a remote path.')
      }
    } else if (arg === '--allow-live-terminal-loss') {
      options.allowLiveTerminalLoss = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

export function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectDir,
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
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout.trim()
}

function ssh(host, command, options = {}) {
  return run(
    'ssh',
    [...(options.tty ? ['-t'] : ['-o', 'BatchMode=yes']), '-o', 'ConnectTimeout=8', host, command],
    options
  )
}

function remoteSha(host, filePath) {
  const output = requireSuccess(
    ssh(host, `sha256sum ${shellQuote(filePath)}`),
    `SHA-256 check for ${filePath}`
  )
  const hash = output.split(/\s+/)[0]
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error(`Unexpected SHA-256 output for ${filePath}.`)
  }
  return hash
}

function requireRemoteAppImage(host, filePath) {
  requireSuccess(
    ssh(
      host,
      `test -f ${shellQuote(filePath)} && test -x ${shellQuote(filePath)} && ` +
        `test "$(od -An -t x1 -N4 ${shellQuote(filePath)} | tr -d ' \\n')" = 7f454c46 && ` +
        `${shellQuote(filePath)} --appimage-version >/dev/null`
    ),
    `AppImage validation for ${filePath}`
  )
}

function remoteStatus(host, cliPath) {
  const output = requireSuccess(ssh(host, `${shellQuote(cliPath)} status --json`), 'Remote status')
  const parsed = parseCommandJson(output, 'Remote Neurorca status')
  if (parsed.ok !== true || parsed.result?.runtime?.state !== 'ready') {
    throw new Error('The current remote Neurorca runtime is not ready.')
  }
  return parsed
}

function remoteTerminalCount(host, cliPath) {
  const output = requireSuccess(
    ssh(host, `${shellQuote(cliPath)} terminal list --limit 1 --json`),
    'Remote terminal preflight'
  )
  const count = parseCommandJson(output, 'Remote terminal list').result?.totalCount
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('Remote terminal preflight did not return a valid totalCount.')
  }
  return count
}

export function deployNeurorcaLinux(options = {}) {
  const config = loadNeurorcaOperationsConfig()
  const host = options.host ?? config.linux.defaultHost
  const artifact = options.artifact ?? config.linux.buildAppImage
  remoteStatus(host, config.linux.cliPath)
  requireRemoteAppImage(host, artifact)
  const artifactSha = remoteSha(host, artifact)
  const installedSha = remoteSha(host, config.linux.installedAppImage)
  if (artifactSha === installedSha) {
    return { host, artifact, artifactSha, installedSha, liveTerminals: null, changed: false }
  }

  const liveTerminals = remoteTerminalCount(host, config.linux.cliPath)
  if (liveTerminals > 0 && !options.allowLiveTerminalLoss) {
    throw new Error(
      `Refusing to restart ${config.linux.serviceName}: ${liveTerminals} live terminal(s). ` +
        'Close them first. Never kill the detached daemon or its process group.'
    )
  }
  if (options.dryRun) {
    return { host, artifact, artifactSha, installedSha, liveTerminals, changed: true, dryRun: true }
  }

  const remoteScriptDir = `/home/${config.linux.serviceUser}/.cache/neurorca-deploy`
  const remoteScript = `${remoteScriptDir}/install-neurorca-linux-root.sh`
  requireSuccess(ssh(host, `install -d -m 0700 ${shellQuote(remoteScriptDir)}`), 'Remote staging')
  requireSuccess(run('scp', [rootInstaller, `${host}:${remoteScript}`]), 'Root installer upload')
  requireSuccess(ssh(host, `chmod 0700 ${shellQuote(remoteScript)}`), 'Root installer permissions')

  const command = [
    'sudo',
    remoteScript,
    artifact,
    artifactSha,
    config.linux.serviceName,
    config.linux.installedAppImage,
    config.linux.cliPath,
    config.linux.serviceUser,
    options.allowLiveTerminalLoss ? 'true' : 'false'
  ]
    .map(shellQuote)
    .join(' ')
  try {
    requireSuccess(
      ssh(host, command, { tty: true, inherit: true, timeout: 180_000 }),
      'Neurorca Linux activation'
    )
  } finally {
    ssh(host, `rm -f ${shellQuote(remoteScript)}`)
  }

  remoteStatus(host, config.linux.cliPath)
  const finalSha = remoteSha(host, config.linux.installedAppImage)
  if (finalSha !== artifactSha) {
    throw new Error('Remote AppImage checksum differs after activation.')
  }
  return { host, artifact, artifactSha, installedSha: finalSha, liveTerminals, changed: true }
}

export function main(argv = process.argv.slice(2)) {
  const result = deployNeurorcaLinux(parseLinuxDeployArgs(argv))
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main()
}
