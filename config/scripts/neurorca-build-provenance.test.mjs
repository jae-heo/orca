import { describe, expect, it } from 'vitest'
import {
  assertNeurorcaBuildIdentity,
  parseNeurorcaProvenance
} from './neurorca-build-provenance.mjs'

const commit = '0123456789abcdef0123456789abcdef01234567'

describe('Neurorca build provenance', () => {
  it('accepts only a clean pushed integration-branch identity', () => {
    expect(
      assertNeurorcaBuildIdentity(
        {
          branch: 'local/neurorca',
          dirty: false,
          sourceCommit: commit,
          pushedCommit: commit
        },
        'local/neurorca'
      )
    ).toMatchObject({ sourceCommit: commit })
  })

  it('rejects dirty, unpushed, and wrong-branch builds', () => {
    const base = {
      branch: 'local/neurorca',
      dirty: false,
      sourceCommit: commit,
      pushedCommit: commit
    }
    expect(() => assertNeurorcaBuildIdentity({ ...base, dirty: true }, 'local/neurorca')).toThrow(
      'uncommitted changes'
    )
    expect(() =>
      assertNeurorcaBuildIdentity({ ...base, pushedCommit: 'a'.repeat(40) }, 'local/neurorca')
    ).toThrow('Push local/neurorca')
    expect(() =>
      assertNeurorcaBuildIdentity({ ...base, branch: 'main' }, 'local/neurorca')
    ).toThrow('Build Neurorca from local/neurorca')
  })

  it('binds AppImage provenance to a commit and artifact checksum', () => {
    const parsed = parseNeurorcaProvenance(
      {
        schemaVersion: 1,
        product: 'Neurorca',
        sourceCommit: commit,
        artifactSha256: 'a'.repeat(64)
      },
      { requireArtifactSha: true }
    )
    expect(parsed.sourceCommit).toBe(commit)
    expect(() =>
      parseNeurorcaProvenance({ ...parsed, artifactSha256: 'bad' }, { requireArtifactSha: true })
    ).toThrow('valid SHA-256')
  })
})
