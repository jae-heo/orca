#!/usr/bin/env bash
set -euo pipefail

artifact=${1:?artifact path is required}
provenance=${2:?artifact provenance path is required}
expected_sha=${3:?expected SHA-256 is required}
expected_commit=${4:?expected source commit is required}
service=${5:?systemd service name is required}
installed=${6:?installed AppImage path is required}
cli=${7:?Neurorca CLI path is required}
service_user=${8:?service user is required}
allow_live_terminal_loss=${9:-false}
installed_provenance="${installed}.provenance.json"

if [[ ${EUID} -ne 0 ]]; then
  echo 'This installer must run through sudo.' >&2
  exit 1
fi
if [[ ! -f "$artifact" || ! -x "$artifact" ]]; then
  echo "Executable artifact not found: $artifact" >&2
  exit 1
fi
if [[ ! -f "$provenance" ]]; then
  echo "Artifact provenance not found: $provenance" >&2
  exit 1
fi
artifact_magic=$(od -An -t x1 -N4 "$artifact" | tr -d ' \n')
if [[ "$artifact_magic" != 7f454c46 ]]; then
  echo "Artifact is not an ELF AppImage: $artifact" >&2
  exit 1
fi
if ! "$artifact" --appimage-version >/dev/null 2>&1; then
  echo "Artifact failed its AppImage runtime probe: $artifact" >&2
  exit 1
fi
if ! systemctl cat "$service" >/dev/null 2>&1; then
  echo "Service not found: $service" >&2
  exit 1
fi

actual_sha=$(sha256sum "$artifact" | awk '{print $1}')
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "Artifact checksum changed before installation." >&2
  exit 1
fi
provenance_values=$(/usr/bin/node - "$provenance" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (
  value?.schemaVersion !== 1 ||
  value?.product !== 'Neurorca' ||
  !/^[a-f0-9]{40}$/.test(value?.sourceCommit ?? '') ||
  !/^[a-f0-9]{64}$/.test(value?.artifactSha256 ?? '')
) process.exit(2);
process.stdout.write(`${value.sourceCommit} ${value.artifactSha256}`);
NODE
)
read -r provenance_commit provenance_sha <<<"$provenance_values"
if [[ "$provenance_commit" != "$expected_commit" || "$provenance_sha" != "$expected_sha" ]]; then
  echo 'Artifact provenance does not match the requested commit and checksum.' >&2
  exit 1
fi

if [[ -f "$installed" ]] && [[ "$(sha256sum "$installed" | awk '{print $1}')" == "$expected_sha" ]]; then
  provenance_candidate="${installed_provenance}.new"
  install -m 0644 "$provenance" "$provenance_candidate"
  mv "$provenance_candidate" "$installed_provenance"
  restorecon -F "$installed_provenance" >/dev/null 2>&1 || true
  echo "Installed Neurorca provenance for unchanged AppImage: $expected_commit"
  exit 0
fi

terminal_json=$(runuser -u "$service_user" -- "$cli" terminal list --limit 1 --json)
terminal_count=$(printf '%s' "$terminal_json" | /usr/bin/node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const count = JSON.parse(input)?.result?.totalCount;
  if (!Number.isInteger(count) || count < 0) process.exit(2);
  process.stdout.write(String(count));
});
')
if [[ "$terminal_count" != 0 && "$allow_live_terminal_loss" != true ]]; then
  echo "Refusing to restart $service: $terminal_count live terminal(s) would be lost." >&2
  exit 1
fi

installed_dir=$(dirname "$installed")
candidate="$installed.new"
rollback="$installed.rollback"
provenance_candidate="${installed_provenance}.new"
provenance_rollback="${installed_provenance}.rollback"
install -d -m 0755 "$installed_dir"
rm -f "$candidate" "$rollback" "$provenance_candidate" "$provenance_rollback"
install -m 0755 "$artifact" "$candidate"
install -m 0644 "$provenance" "$provenance_candidate"
candidate_sha=$(sha256sum "$candidate" | awk '{print $1}')
if [[ "$candidate_sha" != "$expected_sha" ]]; then
  echo 'Installed candidate checksum verification failed.' >&2
  rm -f "$candidate"
  exit 1
fi
restorecon -F "$candidate" >/dev/null 2>&1 || true

had_previous=false
had_previous_provenance=false
activated_candidate=false
activated_provenance=false
rollback_install() {
  if [[ "$activated_candidate" == true ]]; then
    rm -f "$installed"
  fi
  if [[ "$activated_provenance" == true ]]; then
    rm -f "$installed_provenance"
  fi
  if [[ "$had_previous" == true && -f "$rollback" ]]; then
    mv "$rollback" "$installed"
    restorecon -F "$installed" >/dev/null 2>&1 || true
  fi
  if [[ "$had_previous_provenance" == true && -f "$provenance_rollback" ]]; then
    mv "$provenance_rollback" "$installed_provenance"
    restorecon -F "$installed_provenance" >/dev/null 2>&1 || true
  fi
  if [[ "$had_previous" == true ]]; then
    systemctl restart "$service" >/dev/null 2>&1 || true
  fi
}
trap rollback_install ERR

if [[ -f "$installed" ]]; then
  mv "$installed" "$rollback"
  had_previous=true
fi
if [[ -f "$installed_provenance" ]]; then
  mv "$installed_provenance" "$provenance_rollback"
  had_previous_provenance=true
fi
mv "$candidate" "$installed"
activated_candidate=true
mv "$provenance_candidate" "$installed_provenance"
activated_provenance=true
restorecon -F "$installed" >/dev/null 2>&1 || true
restorecon -F "$installed_provenance" >/dev/null 2>&1 || true

systemctl restart "$service"
ready=false
for _ in {1..60}; do
  if systemctl is-active --quiet "$service"; then
    status_json=$(runuser -u "$service_user" -- "$cli" status --json 2>/dev/null || true)
    if printf '%s' "$status_json" | grep -q '"state": "ready"'; then
      ready=true
      break
    fi
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "The updated $service did not become ready; restoring the previous AppImage." >&2
  false
fi

trap - ERR
rm -f "$rollback" "$provenance_rollback"
systemctl is-active "$service"
runuser -u "$service_user" -- "$cli" status --json
echo "Installed Neurorca AppImage SHA-256: $expected_sha"
echo "Installed Neurorca source commit: $expected_commit"
