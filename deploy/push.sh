#!/usr/bin/env bash
# Copy the project's code to the server. Never copies notes/ (personal notes stay on the laptop), node_modules,
# .venv, measure/, map/ (rebuilt) or the local Temporal database.
# data/ is copied only with --with-data (the first deploy): after that the server's data is the newer one.
# .env is copied with mode 600, keeping the server-only lines (WEBSUB_SECRET, CALLBACK_URL).
# Usage: SSH_OPTS="-i ~/.ssh/lecture_gate_do" deploy/push.sh <server-ip> [--with-data]
set -euo pipefail
ip=$1
ssh_opts=${SSH_OPTS:-}
data_opt=--exclude=./data
[ "${2:-}" = "--with-data" ] && data_opt=--exclude='./data/temporal.db*'
tar --exclude=./notes --exclude=./notes.sample --exclude=./node_modules --exclude=./.venv --exclude=./measure \
    --exclude=./map --exclude=./.env --exclude='./data/temporal.db*' $data_opt -czf /tmp/lecture-gate.tgz -C "$(dirname "$0")/.." .
scp $ssh_opts /tmp/lecture-gate.tgz "root@$ip:/tmp/"
ssh $ssh_opts "root@$ip" 'mkdir -p /opt/lecture-gate && tar -xzf /tmp/lecture-gate.tgz -C /opt/lecture-gate && rm /tmp/lecture-gate.tgz
  grep -E "^(WEBSUB_SECRET|CALLBACK_URL)=" /opt/lecture-gate/.env > /root/env.server 2>/dev/null || true'
scp $ssh_opts "$(dirname "$0")/../.env" "root@$ip:/opt/lecture-gate/.env"
ssh $ssh_opts "root@$ip" 'cd /opt/lecture-gate && printf "\n" >> .env && cat /root/env.server >> .env && rm /root/env.server
  chmod 600 .env && chown -R lecturegate: /opt/lecture-gate'
rm /tmp/lecture-gate.tgz
