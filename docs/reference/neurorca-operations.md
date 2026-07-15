# Neurorca Operations

This is the durable handoff for Neurocore's Neurorca integration build. Read it
before changing an installation or updating from upstream. Conversation history
and Codex memory are useful context, but they are not the source of truth for
these operations.

The machine-readable defaults live in
[`config/neurorca-operations.json`](../../config/neurorca-operations.json).
Runtime IDs, PIDs, build hashes, and pairing codes are deliberately absent
because they change. Discover them with `pnpm neurorca:doctor`.

## Topology and ownership

| Role                | Stable identity                                                 | Purpose                                                                |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Source checkout     | `/Users/jae/orca-dogfood`, branch `local/neurorca`              | Merge upstream and the integration feature branches; build the Mac app |
| Mac desktop         | `/Applications/Neurorca.app`                                    | The only installed Orca-family desktop app on this Mac                 |
| Headless runtime    | SSH alias `linux-jae`, Tailscale endpoint `100.110.163.64:6768` | Runs `neurorca-server.service` and exposes the paired runtime          |
| Linux build mirror  | `/home/jae/neurorca-src` on `linux-jae`                         | Clean, reproducible x86_64 Linux build checkout                        |
| Nested project host | SSH config alias `p8`; Orca host id `ssh-p8`                    | Hosts projects such as `/home/jae/aps` behind the `linux-jae` runtime  |

In Add Project, **From** selects the Orca runtime that performs discovery. For
this topology that is normally `linux-jae`. **Host** selects that runtime's
local machine or an SSH host it can reach, such as `p8`. Do not collapse these
two concepts or expect the Mac desktop's SSH config to substitute for the
headless runtime's SSH config.

The compatibility command name `orca` can be a symlink to `neurorca`; that does
not mean an old official Orca binary is installed. Resolve the link and compare
the target before deleting anything.

## Protected state

Never delete, reset, replace, or copy over these paths as part of an update:

- macOS user data: `~/Library/Application Support/Neurorca`;
- Linux user data: `/home/jae/.config/Neurorca`;
- the Linux user's SSH config and the private key dedicated to `p8`;
- project checkouts, worktrees, and database profiles;
- unrelated dirty changes in either source checkout; and
- detached daemon sockets, tokens, PID metadata, or processes while they own
  live terminals.

Database passwords belong in the platform credential vault. Pairing URLs,
device tokens, vault contents, private keys, and passwords must never be pasted
into documentation, commits, GitHub issues, PR descriptions, or diagnostic
reports.

## Source composition

`local/neurorca` is the integration branch. It contains:

1. the current `upstream/main` history;
2. `fix/headless-serve-ssh-handlers` for headless SSH/project management; and
3. `feat/database-query-tabs` for database tabs, profiles, and credential-vault
   behavior.

The official Orca binary updater is intentionally not Neurorca's update path.
It would replace the integration build without preserving these changes.
Official updates enter at source level through:

```bash
pnpm neurorca:sync
```

That command requires a clean `local/neurorca` worktree and stops on conflicts.
Do not stash, discard, auto-resolve, or overwrite changes merely to make the
sync proceed. Review and commit the current work first.

## Mandatory preflight

Run from the source checkout:

```bash
pnpm neurorca:doctor
```

The doctor is read-only. It verifies the integration branch and feature merges,
Mac bundle identity and duplicates, CLI target, current build match, Linux
service and runtime readiness, old installation remnants, protected user data,
the live terminal count, and whether local/remote Node versions match the
repository's declared engine.

- `FAIL` is a blocker.
- A dirty-worktree warning blocks upstream sync and reproducible remote builds.
- A Node-engine warning should be fixed before relying on a new upstream build;
  the current repository declares Node 24.
- A live-terminal warning blocks Linux activation but not normal development.
- Never repair a failed check by deleting user data or killing a process group.

If another Codex session, user, or automation changes the worktree, AppImage
hash, runtime ID, or systemd start time while work is in progress, stop and
re-run the doctor. Do not overwrite concurrent work based on an earlier
snapshot.

## Update workflow

Use this order. Each gate must pass before continuing.

1. Run `pnpm neurorca:doctor` and inspect all failures and warnings.
2. Finish, test, commit, and intentionally push the current integration work.
   Never let an update script push on the user's behalf.
3. From a clean branch, run `pnpm neurorca:sync` and resolve any merge conflict
   deliberately.
4. Run `pnpm install --frozen-lockfile`, relevant focused tests, and the
   appropriate type checks.
5. Build and install the Mac app:

   ```bash
   pnpm build:neurorca:mac
   pnpm neurorca:install:mac
   ```

6. Push the reviewed `local/neurorca` commit. The remote Linux build refuses an
   uncommitted or unpushed source state.
7. Build on the target Linux architecture:

   ```bash
   pnpm neurorca:build:linux:remote
   ```

8. Close every live Neurorca terminal reported by the doctor, then activate:

   ```bash
   pnpm neurorca:deploy:linux
   ```

9. Run `pnpm neurorca:doctor` again and exercise one Mac-local project, one
   `linux-jae` project, and one `p8` project before declaring the update done.

The explicit `--allow-live-terminal-loss` deploy option is destructive. A Codex
agent must not use it without a fresh, direct user instruction accepting loss
of every listed live terminal.

## Mac installation contract

`pnpm neurorca:install:mac` selects the current CPU architecture's build,
verifies the Neurorca bundle id and code signature, and compares the executable
hash before doing work. When replacement is needed it:

1. stages a verified app bundle;
2. asks the desktop app to quit gracefully;
3. never signals the detached terminal daemon;
4. atomically swaps `/Applications/Neurorca.app`;
5. launches the new app and waits for runtime readiness;
6. rolls back to the old app if readiness fails; and
7. only after success removes temporary integration copies and obsolete
   official Orca app bundles.

The final invariant is one installed app:
`/Applications/Neurorca.app`. Build products under `dist/` are artifacts, not
installed applications. The installer never touches Neurorca user data.

## Linux activation contract

The installed binary is
`/usr/local/libexec/neurorca-server.AppImage`; systemd owns
`neurorca-server.service`. Keeping the AppImage under `/usr/local/libexec`
matters on SELinux hosts: executing a home-directory AppImage from systemd can
fail with `203/EXEC` and `Permission denied` even when its Unix mode is
executable.

`pnpm neurorca:deploy:linux` checks current runtime readiness and SHA-256 values
before requesting sudo. It is a no-op when the installed and built artifacts
match. Otherwise it checks the live terminal count before sudo, and the root
installer checks it again immediately before restart. The root installer uses
an atomic candidate/rollback swap, restores SELinux context, waits for the new
runtime to become ready, and restores the previous AppImage on failure.

This deploy command updates an existing service; it is not a bootstrap command.
Do not rewrite the unit, change its user, port, or pairing address during a
normal binary update.

## Live-session safety

Neurorca intentionally starts its terminal daemon detached. A daemon executable
under an older AppImage mount, an extracted temporary directory, or a different
app path can be healthy and can own current PTYs. Messages such as “Preserving
daemon launched from a different app path because it owns live sessions” are a
safety feature, not evidence of an obsolete installation.

Therefore:

- use `neurorca terminal list --json` as the source of truth;
- never use `pkill`, `kill -- -<process-group>`, or manual descendant cleanup;
- never remove the daemon socket/token/PID files to force a restart;
- never restart `neurorca-server.service` while the terminal count is nonzero;
- do not infer staleness from `/tmp/.mount_*` or `appimage_extracted_*`; and
- let the application replace a zero-session stale daemon on its own.

Remote SSH relay processes can also survive a desktop reconnect. Treat them as
managed runtime state, not installation remnants.

## Troubleshooting boundaries

- Headless EGL, X display, D-Bus, or GPU-process warnings can be benign when the
  service is active, CLI runtime state is `ready`, and the HTTP endpoint
  responds. Judge readiness from those signals, not one warning line.
- `203/EXEC` plus SELinux denial means the service binary path or label is
  wrong. Keep it in `/usr/local/libexec` and use `restorecon`; do not disable
  SELinux.
- If the Mac shows several apps, run the Mac installer or doctor. Do not delete
  bundles until their bundle IDs and the currently running executable path are
  known.
- If a paired client is offline but the server is ready, verify the Tailscale
  path and saved environment before re-pairing. Treat any printed pairing URL
  as a credential.
- Never include `systemctl status` journal excerpts containing a pairing URL in
  public reports. Prefer `systemctl show`, CLI status, and redacted logs.

## New Codex handoff

A new Codex session does not need the original conversation. Start it in this
repository and say:

> Read `AGENTS.md` and `docs/reference/neurorca-operations.md`, run
> `pnpm neurorca:doctor`, preserve unrelated dirty changes and all live
> sessions, then perform the requested Neurorca operation using the checked-in
> commands.

Use `codex resume <session-id>` when the exact conversation history matters, or
`codex fork <session-id>` to branch that history. Required operational behavior
must remain in this repository rather than depending on either mechanism.
