#!/usr/bin/env bash
set -euo pipefail

artifact=${1:?artifact path is required}
expected_sha=${2:?expected SHA-256 is required}
service=${3:?systemd service name is required}
installed=${4:?installed AppImage path is required}
cli=${5:?Neurorca CLI path is required}
service_user=${6:?service user is required}
allow_live_terminal_loss=${7:-false}

if [[ ${EUID} -ne 0 ]]; then
  echo 'This installer must run through sudo.' >&2
  exit 1
fi
if [[ ! -f "$artifact" || ! -x "$artifact" ]]; then
  echo "Executable artifact not found: $artifact" >&2
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
install -d -m 0755 "$installed_dir"
rm -f "$candidate" "$rollback"
install -m 0755 "$artifact" "$candidate"
candidate_sha=$(sha256sum "$candidate" | awk '{print $1}')
if [[ "$candidate_sha" != "$expected_sha" ]]; then
  echo 'Installed candidate checksum verification failed.' >&2
  rm -f "$candidate"
  exit 1
fi
restorecon -F "$candidate" >/dev/null 2>&1 || true

had_previous=false
if [[ -f "$installed" ]]; then
  mv "$installed" "$rollback"
  had_previous=true
fi
mv "$candidate" "$installed"
restorecon -F "$installed" >/dev/null 2>&1 || true

rollback_install() {
  rm -f "$installed"
  if [[ "$had_previous" == true && -f "$rollback" ]]; then
    mv "$rollback" "$installed"
    restorecon -F "$installed" >/dev/null 2>&1 || true
    systemctl restart "$service" >/dev/null 2>&1 || true
  fi
}
trap rollback_install ERR

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
rm -f "$rollback"
systemctl is-active "$service"
runuser -u "$service_user" -- "$cli" status --json
echo "Installed Neurorca AppImage SHA-256: $expected_sha"
