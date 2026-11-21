#!/bin/sh
# Start a throwaway SSH host in Docker for the remote check (never touches ~/.ssh):
#   scripts/ssh-test-host/up.sh [dir]     → container `aquila-ssh-test` on 127.0.0.1:2222, user `dev`
# Writes a key, known_hosts and an ssh_config with `Host aquila-test` into [dir] (default $TMPDIR/aquila-ssh-test).
# The host has tmux + git, a repo at /work/app with one commit, and the history fixtures in ~/.claude and ~/.codex.
# Then: AQUILA_SMOKE_SSH_CONFIG=[dir]/ssh_config AQUILA_SMOKE_SSH_HOST=aquila-test npm run smoke
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
dir=${1:-${TMPDIR:-/tmp}/aquila-ssh-test}
port=${AQUILA_SSH_TEST_PORT:-2222}
name=aquila-ssh-test
mkdir -p "$dir"
[ -f "$dir/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C aquila-ssh-test -f "$dir/id_ed25519"
docker build -q -t "$name" "$here" >/dev/null
docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" -p "127.0.0.1:$port:22" "$name" >/dev/null
docker exec "$name" sh -c 'mkdir -p /home/dev/.ssh /work/app && chmod 700 /home/dev/.ssh'
docker cp "$dir/id_ed25519.pub" "$name:/home/dev/.ssh/authorized_keys"
docker cp "$root/electron/fixtures/history/claude" "$name:/home/dev/.claude"
docker cp "$root/electron/fixtures/history/codex" "$name:/home/dev/.codex"
docker exec "$name" sh -c '
  chmod 600 /home/dev/.ssh/authorized_keys
  cd /work/app && printf "# app\n" > README.md && printf "export const a = 1;\n" > a.ts
  chown -R dev:dev /home/dev /work
  su dev -c "cd /work/app && git init -q -b main && git add -A && git -c user.name=dev -c user.email=dev@example.invalid commit -qm init"
'
cat > "$dir/ssh_config" <<CFG
Host aquila-test
  HostName 127.0.0.1
  Port $port
  User dev
  IdentityFile $dir/id_ed25519
  IdentitiesOnly yes
  UserKnownHostsFile $dir/known_hosts
  StrictHostKeyChecking accept-new
CFG
# Wait for sshd and record the host key.
i=0
until ssh -F "$dir/ssh_config" -o BatchMode=yes aquila-test true 2>/dev/null; do
  i=$((i + 1)); [ "$i" -lt 30 ] || { echo "ssh-test-host: sshd did not answer" >&2; exit 1; }
  sleep 0.5
done
echo "ssh-test-host: up — ssh -F $dir/ssh_config aquila-test"
echo "AQUILA_SMOKE_SSH_CONFIG=$dir/ssh_config AQUILA_SMOKE_SSH_HOST=aquila-test npm run smoke"
