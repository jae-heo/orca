# Neurorca

Neurorca is Neurocore's Orca integration build. It tracks upstream Orca while
carrying the headless SSH/project workflow and database tabs before those
changes are available in an official release.

The supported source branch is `local/neurorca`. Every distributable build
must come from a clean, pushed commit on that branch. The build wrappers embed
the full Git commit in the Mac app and bind the Linux AppImage sidecar to both
that commit and the artifact's SHA-256.

## Clone and build

Install Git, Node 24, pnpm, and the platform build prerequisites from the
upstream project. Then clone the integration branch:

```bash
git clone --branch local/neurorca --single-branch https://github.com/jae-heo/orca.git neurorca
cd neurorca
pnpm install --frozen-lockfile
```

On macOS:

```bash
pnpm build:neurorca:mac
pnpm neurorca:install:mac
```

The installed application is `/Applications/Neurorca.app`, its CLI is
`~/.local/bin/neurorca`, and its data is isolated from official Orca. The local
build is ad-hoc signed, so macOS may require an explicit first-open approval.

On Linux:

```bash
pnpm build:neurorca:linux
```

The AppImage and its provenance sidecar are written under `dist/`. On x86_64
the names are `neurorca-linux-x86_64.AppImage` and
`neurorca-linux-x86_64.AppImage.provenance.json`. Ubuntu 26.04 is a valid build
target as long as the repository's Node 24 and native build prerequisites are
installed. For a headless runtime, use the AppImage's `serve` command and the
upstream [headless Linux guide](docs/reference/headless-linux-server.md); do not
reuse another person's host-specific systemd configuration.

## Verify the source commit

macOS stores the provenance inside the application:

```bash
cat /Applications/Neurorca.app/Contents/Resources/neurorca-build-provenance.json
```

Linux stores it beside the AppImage. Verify that `artifactSha256` matches:

```bash
sha256sum dist/neurorca-linux-x86_64.AppImage
cat dist/neurorca-linux-x86_64.AppImage.provenance.json
```

Both platforms must report the same `sourceCommit` when they are distributed
as one Neurorca version.

## Update from upstream

Neurorca does not consume the official Orca binary updater because that would
discard the integration features. A maintainer updates the integration branch
at source level:

```bash
pnpm neurorca:doctor
pnpm neurorca:sync
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
```

Review, commit, and push the result before running either Neurorca build
wrapper. Machine-specific Mac/Linux deployment, rollback, live-session safety,
and the Neurocore server topology are documented in
[`docs/reference/neurorca-operations.md`](docs/reference/neurorca-operations.md).
