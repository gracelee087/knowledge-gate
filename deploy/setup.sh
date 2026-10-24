#!/usr/bin/env bash
# One-time setup of the lecture-gate server (Ubuntu 24.04 Droplet), run as root.
# Expects the project in /opt/lecture-gate (copied by deploy/push.sh) and /opt/lecture-gate/.env (mode 600).
set -euo pipefail
cd /opt/lecture-gate

# 1 GB swap: Temporal + worker + a card step need more than the 1 GiB of RAM at times.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Node 22 and the Temporal CLI.
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v temporal >/dev/null; then
  # The same version as on the laptop, checked against the digest GitHub lists for the release asset.
  curl -fsSL https://github.com/temporalio/cli/releases/download/v1.9.1/temporal_cli_1.9.1_linux_amd64.tar.gz -o /tmp/temporal.tgz
  echo "09a0326a51db84d02735e53542b9ebd8c4758daf47482a9ab0abce15844e60d5  /tmp/temporal.tgz" | sha256sum -c -
  tar -xzf /tmp/temporal.tgz -C /usr/local/bin temporal
fi

# Same install as on the laptop: lockfile versions, no install scripts (after the 2026-06 Mastra npm compromise).
npm ci --ignore-scripts
if grep -q easy-day-js package-lock.json || [ -e node_modules/easy-day-js ]; then echo "easy-day-js found, stopping"; exit 1; fi

useradd --system --home /opt/lecture-gate lecturegate 2>/dev/null || true
chown -R lecturegate: /opt/lecture-gate
chmod 600 .env

cp deploy/*.service deploy/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lg-temporal lg-worker lg-webhook lg-watchdog.timer lg-verify.timer

# Only SSH and the webhook are reachable from outside; Temporal (7233) and its UI (8233) stay on localhost.
ufw allow OpenSSH && ufw allow 8080/tcp && ufw --force enable
systemctl --no-pager status lg-temporal lg-worker lg-webhook | grep -E 'Active|●'
