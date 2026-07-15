import { describe, expect, it } from 'vitest'
import { loadNeurorcaOperationsConfig } from './neurorca-operations-config.mjs'
import { parseRemoteBuildArgs, renderRemoteBuildCommand } from './build-neurorca-linux-remote.mjs'

describe('Neurorca remote Linux build contract', () => {
  it('parses host and dry-run options', () => {
    expect(parseRemoteBuildArgs(['--', '--host', 'linux-jae', '--dry-run'])).toEqual({
      host: 'linux-jae',
      dryRun: true
    })
  })

  it('requires a clean fast-forward build of the exact pushed commit', () => {
    const command = renderRemoteBuildCommand(
      loadNeurorcaOperationsConfig(),
      '0123456789abcdef0123456789abcdef01234567'
    )
    expect(command).toContain('test -z "$(git status --porcelain)"')
    expect(command).toContain('git merge --ff-only FETCH_HEAD')
    expect(command).toContain('pnpm install --frozen-lockfile')
    expect(command).toContain('pnpm build:neurorca:linux')
    expect(command).not.toContain('reset --hard')
  })
})
