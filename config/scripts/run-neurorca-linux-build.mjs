#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  cleanupNeurorcaBuildEnvironment,
  createNeurorcaBuildEnvironment,
  writeNeurorcaArtifactProvenance
} from './neurorca-build-provenance.mjs'
import { projectDir } from './neurorca-operations-config.mjs'

export function linuxAppImageName(cpuArch = process.arch) {
  const builderArch = cpuArch === 'x64' ? 'x86_64' : cpuArch
  return `neurorca-linux-${builderArch}.AppImage`
}

export function main() {
  if (process.platform !== 'linux') {
    throw new Error('The Neurorca Linux build command must run on Linux.')
  }
  const build = createNeurorcaBuildEnvironment()
  try {
    const result = spawnSync('pnpm', ['run', 'build:linux'], {
      cwd: projectDir,
      env: build.env,
      stdio: 'inherit'
    })
    if (result.error) {
      throw result.error
    }
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1
      return
    }
    const artifactPath = join(projectDir, 'dist', linuxAppImageName())
    if (!existsSync(artifactPath)) {
      throw new Error(`Neurorca AppImage was not produced at ${artifactPath}.`)
    }
    const { provenance, sidecarPath } = writeNeurorcaArtifactProvenance(
      artifactPath,
      build.identity.sourceCommit
    )
    console.log(
      `[neurorca] Built ${artifactPath} from ${provenance.sourceCommit}; provenance: ${sidecarPath}`
    )
  } finally {
    cleanupNeurorcaBuildEnvironment(build.temporaryDirectory)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main()
}
