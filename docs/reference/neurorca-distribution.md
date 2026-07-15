# Neurorca Distribution

Neurorca is Neurocore's integration build of Orca. It follows upstream Orca
while carrying the headless runtime SSH/project-management and database-tab
changes before those changes are available in an official release.

## Identity boundary

Build with `NEURORCA_BUILD=1` (normally through the package scripts below).
The resulting package uses:

- product name `Neurorca`;
- application ID `com.neurocore.neurorca`;
- its own Electron user-data directory;
- the `neurorca` shell command and Linux package name; and
- no official Orca binary update feed.

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
a silently broken build.

## Build

On macOS:

```bash
pnpm install --frozen-lockfile
pnpm build:neurorca:mac
```

On the target Linux architecture:

```bash
pnpm install --frozen-lockfile
pnpm build:neurorca:linux
```

The macOS build is locally signed/ad-hoc unless Apple release credentials are
provided. A future automatic Neurorca binary-update feed must publish signed
Neurorca artifacts; it must never point at the official Orca artifact feed.
