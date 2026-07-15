import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadNeurorcaOperationsConfig, projectDir } from './neurorca-operations-config.mjs'

const COMMIT_PATTERN = /^[a-f0-9]{40}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function runGit(args, repository = projectDir) {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return result.stdout.trim()
}

export function assertNeurorcaBuildIdentity(identity, requiredBranch) {
  if (identity.branch !== requiredBranch) {
    throw new Error(
      `Build Neurorca from ${requiredBranch}; current branch is ${identity.branch || '(detached)'}.`
    )
  }
  if (identity.dirty) {
    throw new Error('Refusing to build a distributable Neurorca artifact from uncommitted changes.')
  }
  if (!COMMIT_PATTERN.test(identity.sourceCommit)) {
    throw new Error('Neurorca source commit must be a full 40-character Git SHA.')
  }
  if (identity.sourceCommit !== identity.pushedCommit) {
    throw new Error(`Push ${requiredBranch} before building Neurorca artifacts.`)
  }
  return identity
}

export function readNeurorcaBuildIdentity(repository = projectDir) {
  const config = loadNeurorcaOperationsConfig()
  return assertNeurorcaBuildIdentity(
    {
      branch: runGit(['branch', '--show-current'], repository),
      dirty: runGit(['status', '--porcelain'], repository).length > 0,
      sourceCommit: runGit(['rev-parse', 'HEAD'], repository),
      pushedCommit: runGit(['rev-parse', `origin/${config.requiredBranch}`], repository)
    },
    config.requiredBranch
  )
}

export function parseNeurorcaProvenance(value, options = {}) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (
    parsed?.schemaVersion !== 1 ||
    parsed.product !== 'Neurorca' ||
    !COMMIT_PATTERN.test(parsed.sourceCommit ?? '')
  ) {
    throw new Error('Invalid Neurorca build provenance.')
  }
  if (options.requireArtifactSha && !SHA256_PATTERN.test(parsed.artifactSha256 ?? '')) {
    throw new Error('Neurorca artifact provenance is missing a valid SHA-256.')
  }
  return parsed
}

export function readNeurorcaProvenance(filePath, options = {}) {
  return parseNeurorcaProvenance(readFileSync(filePath, 'utf8'), options)
}

export function createNeurorcaBuildEnvironment(baseEnv = process.env) {
  const identity = readNeurorcaBuildIdentity()
  const config = loadNeurorcaOperationsConfig()
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'neurorca-provenance-'))
  const provenancePath = join(temporaryDirectory, config.provenance.resourceName)
  const provenance = {
    schemaVersion: 1,
    product: 'Neurorca',
    sourceCommit: identity.sourceCommit
  }
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o600 })
  return {
    identity,
    temporaryDirectory,
    env: {
      ...baseEnv,
      NEURORCA_BUILD: '1',
      NEURORCA_SOURCE_COMMIT: identity.sourceCommit,
      NEURORCA_PROVENANCE_FILE: provenancePath
    }
  }
}

export function cleanupNeurorcaBuildEnvironment(temporaryDirectory) {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

export function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function writeNeurorcaArtifactProvenance(artifactPath, sourceCommit) {
  const config = loadNeurorcaOperationsConfig()
  const provenance = parseNeurorcaProvenance(
    {
      schemaVersion: 1,
      product: 'Neurorca',
      sourceCommit,
      artifactSha256: sha256(artifactPath)
    },
    { requireArtifactSha: true }
  )
  const sidecarPath = `${artifactPath}${config.provenance.sidecarSuffix}`
  writeFileSync(sidecarPath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 })
  return { provenance, sidecarPath }
}
