#!/usr/bin/env bash
set -uo pipefail

line() { printf '\n== %s ==\n' "$1"; }
line "Operating system"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  printf '%s %s\n' "$NAME" "$VERSION_ID"
else
  uname -a
fi
line "CPU and memory"
command -v nproc >/dev/null && printf 'Logical CPUs: %s\n' "$(nproc)"
command -v free >/dev/null && free -h
line "Storage"
command -v lsblk >/dev/null && lsblk -o NAME,SIZE,TYPE,MOUNTPOINTS
line "Network (do not publish interfaces on a public issue)"
command -v ip >/dev/null && ip -brief link
line "Remote access"
systemctl is-active ssh 2>/dev/null || true
systemctl is-active tailscaled 2>/dev/null || true
if command -v tailscale >/dev/null; then
  tailscale status --self 2>/dev/null || true
fi
line "Docker and VM support"
if command -v docker >/dev/null; then
  docker --version
else
  echo "Docker not installed"
fi
if [[ -c /dev/kvm ]]; then
  echo "/dev/kvm is present"
else
  echo "/dev/kvm missing: enable SVM in BIOS; check KVM modules"
fi
if command -v sbx >/dev/null; then
  sbx --version || true
else
  echo "sbx not installed (optional)"
fi
echo
echo "Do not enable automatic shutdown or change network configuration until SSH is verified."
