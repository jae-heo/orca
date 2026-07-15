#!/usr/bin/env node

import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadNeurorcaOperationsConfig, projectDir } from './neurorca-operations-config.mjs'
import { shellQuote } from './deploy-neurorca-linux.mjs'

export function parseRemoteBuildArgs(argv) {
  const options = { host: null, dryRun: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    } else if (arg === '--host') {
      options.host = argv[++index]
      if (!options.host) {
        throw new Error('--host requires a value.')
      }
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
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

export function requireSuccess(result, label) {
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`)
  }
  return (result.stdout ?? '').trim()
}

function git(args) {
  return run('git', args)
}

function ssh(host, command, options = {}) {
  return run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, command], options)
}

export function renderRemoteBuildCommand(config, expectedCommit) {
  const sourceDir = shellQuote(config.linux.sourceDir)
  const branch = shellQuote(config.requiredBranch)
  const artifact = shellQuote(config.linux.buildAppImage)
  const provenance = shellQuote(`${config.linux.buildAppImage}${config.provenance.sidecarSuffix}`)
  const commit = shellQuote(expectedCommit)
  return `set -euo pipefail
cd ${sourceDir}
test "$(git branch --show-current)" = ${branch}
test -z "$(git status --porcelain)"
git fetch origin ${branch}
test "$(git rev-parse FETCH_HEAD)" = ${commit}
git merge --ff-only FETCH_HEAD
pnpm install --frozen-lockfile
pnpm build:neurorca:linux
sha256sum ${artifact} ${provenance}`
}

export function buildNeurorcaLinuxRemote(options = {}) {
  const config = loadNeurorcaOperationsConfig()
  const host = options.host ?? config.linux.defaultHost
  const branch = requireSuccess(git(['branch', '--show-current']), 'Current branch check')
  if (branch !== config.requiredBranch) {
    throw new Error(
      `Run from ${config.requiredBranch}; current branch is ${branch || '(detached)'}.`
    )
  }
  const status = requireSuccess(git(['status', '--porcelain']), 'Working-tree check')
  if (status) {
    throw new Error('Refusing a remote build from uncommitted source changes.')
  }
  const head = requireSuccess(git(['rev-parse', 'HEAD']), 'Local HEAD check')
  const pushed = requireSuccess(
    git(['rev-parse', `origin/${config.requiredBranch}`]),
    'Pushed Neurorca branch check'
  )
  if (head !== pushed) {
    throw new Error(
      `Push ${config.requiredBranch} before building Linux; local HEAD is not on origin.`
    )
  }

  const remoteProbe = requireSuccess(
    ssh(
      host,
      `cd ${shellQuote(config.linux.sourceDir)} && ` +
        `printf '%s\\n' "$(git branch --show-current)" "$(git status --porcelain)" "$(git rev-parse HEAD)"`
    ),
    'Remote source preflight'
  ).split('\n')
  const [remoteBranch, ...remoteState] = remoteProbe
  if (remoteBranch !== config.requiredBranch) {
    throw new Error(
      `Remote source is on ${remoteBranch || '(detached)'}, not ${config.requiredBranch}.`
    )
  }
  const remoteHead = remoteState.at(-1)
  const remoteChanges = remoteState.slice(0, -1).filter(Boolean)
  if (remoteChanges.length > 0) {
    throw new Error(
      'Remote Linux build source has uncommitted changes; refusing to overwrite them.'
    )
  }
  if (options.dryRun) {
    return { host, branch, head, remoteHead, changed: remoteHead !== head, dryRun: true }
  }

  const output = requireSuccess(
    ssh(host, renderRemoteBuildCommand(config, head), {
      inherit: true,
      timeout: 30 * 60_000
    }),
    'Remote Neurorca Linux build'
  )
  return { host, branch, head, remoteHead, changed: true, output }
}

export function main(argv = process.argv.slice(2)) {
  const result = buildNeurorcaLinuxRemote(parseRemoteBuildArgs(argv))
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main()
}
