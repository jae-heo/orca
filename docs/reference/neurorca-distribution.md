# Neurorca Distribution

Neurorca is Neurocore's integration build of Orca. It follows upstream Orca
while carrying the headless runtime SSH/project-management and database-tab
changes before those changes are available in an official release.

For installation paths, the Mac → Linux → SSH-host topology, live-session
safety rules, verification, deployment, and rollback, follow
[`neurorca-operations.md`](./neurorca-operations.md). Those operational rules
are part of the distribution contract, not optional local notes.

## Identity boundary

Build only through the package scripts below. They reject dirty, unpushed, or
wrong-branch distribution builds and set the internal build variables. The
resulting package uses:

- product name `Neurorca`;
- application ID `com.neurocore.neurorca`;
- its own Electron user-data directory;
- the `neurorca` shell command and Linux package name; and
- no official Orca binary update feed.

The Mac bundle also contains `neurorca-build-provenance.json`. Linux produces
an AppImage plus a `.provenance.json` sidecar whose `artifactSha256` must match
the AppImage. The `sourceCommit` in both platforms must be identical for one
distribution.

The last point is intentional. Installing an official Orca update directly
over Neurorca would remove the local feature commits. Official updates enter
Neurorca at the source level and are rebuilt with the feature branches.

## Update from official Orca

From a clean `local/neurorca` checkout:

```bash
pnpm neurorca:sync
```

The command fetches and merges `upstream/main`, then refreshes the two feature
branches. It stops on conflicts so they can be reviewed instead of publishing
a silently broken build. Commit and push the reviewed result before building;
the wrappers intentionally reject local-only commits.

## Build

On macOS:

```bash
pnpm install --frozen-lockfile
pnpm build:neurorca:mac
```

The Neurorca wrapper uses the normal Orca macOS build. If clang, make, and the
macOS SDK are installed but `node-gyp` cannot see the Command Line Tools version
because its package receipt is missing, it supplies a temporary version shim
for that build and removes it afterward. Missing compiler or SDK binaries still
fail with repair guidance instead of being bypassed.

On the target Linux architecture:

```bash
pnpm install --frozen-lockfile
pnpm build:neurorca:linux
```

For the configured headless build host, use the reproducible remote build
command after committing and pushing a clean `local/neurorca` branch:

```bash
pnpm neurorca:build:linux:remote
```

Install the Mac build and activate the Linux build only through the guarded
commands:

```bash
pnpm neurorca:install:mac
pnpm neurorca:deploy:linux
```

The Linux deploy command refuses to restart while any live terminal exists.
Close those terminals and rerun it; do not bypass the guard merely to make an
update finish sooner.

The guarded Linux installer verifies the provenance sidecar before activation.
If the AppImage bytes are already installed and only the sidecar is missing,
it installs the metadata without restarting the service.

The macOS build is locally signed/ad-hoc unless Apple release credentials are
provided. A future automatic Neurorca binary-update feed must publish signed
Neurorca artifacts; it must never point at the official Orca artifact feed.
