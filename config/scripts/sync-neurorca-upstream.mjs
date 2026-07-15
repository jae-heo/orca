import { spawnSync } from 'node:child_process'

const REQUIRED_BRANCH = 'local/neurorca'
const FEATURE_REFS = [
  ['origin/fix/headless-serve-ssh-handlers', 'fix/headless-serve-ssh-handlers'],
  ['origin/feat/database-query-tabs', 'feat/database-query-tabs']
]

function git(args, options = {}) {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit'
  })
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr.trim() : ''
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
  }
  return options.capture ? result.stdout.trim() : ''
}

function refExists(ref) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/remotes/${ref}`])
  return result.status === 0
}

const branch = git(['branch', '--show-current'], { capture: true })
if (branch !== REQUIRED_BRANCH) {
  throw new Error(
    `Run this command from ${REQUIRED_BRANCH}; current branch is ${branch || '(detached)'}.`
  )
}
if (git(['status', '--porcelain'], { capture: true })) {
  throw new Error('Refusing to sync with uncommitted changes.')
}

git(['fetch', 'upstream', 'main', '--prune'])
git(['fetch', 'origin', '--prune'])
git(['merge', '--no-edit', 'upstream/main'])

for (const [remoteRef, localRef] of FEATURE_REFS) {
  git(['merge', '--no-edit', refExists(remoteRef) ? remoteRef : localRef])
}

console.log('Neurorca now contains the latest upstream/main and feature branches.')
