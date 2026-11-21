#!/bin/sh
# Remove the throwaway SSH host (scripts/ssh-test-host/up.sh). The key dir is left for the next run.
docker rm -f aquila-ssh-test >/dev/null 2>&1 && echo "ssh-test-host: removed" || echo "ssh-test-host: not running"
