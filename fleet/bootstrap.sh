#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-ms-a2}"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run as your normal user (without sudo); Fleet prompts for sudo." >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then
  echo "Ubuntu is required." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "$ID" != "ubuntu" ]]; then
  echo "Fleet bootstrap supports Ubuntu Server only." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ansible-core python3-apt git
exec "$ROOT/bin/fleet" apply "$HOST"
