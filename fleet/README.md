# Fleet: Ubuntu Server

A small, idempotent Ansible setup for a dedicated Linux development machine.
Start with one host (ms-a2), then add fleet/hosts/<name>.yml for other Ubuntu servers.

## First boot (physical MS-A2)

1. Install Ubuntu Server 26.04 LTS or 24.04 LTS manually from USB.
2. During Ubuntu installation, install OpenSSH and import your verified SSH public key.
3. Connect one Ethernet port, verify internet, and verify SSH from your Mac.
4. Run on Ubuntu:

       sudo apt-get update && sudo apt-get install -y git
       git clone https://github.com/MichalBastrzyk/dotfiles.git ~/fleet
       cd ~/fleet
       git switch feat/fleet-ubuntu-server
       ./fleet/bin/fleet bootstrap ms-a2

5. After install, sign in to Tailscale manually:

       sudo tailscale up
       ./fleet/bin/fleet doctor

## Changes without guessing

    ./fleet/bin/fleet check ms-a2
    ./fleet/bin/fleet apply ms-a2
    ./fleet/bin/fleet doctor

Check runs Ansible syntax validation and dry-run. On a clean OS, tasks involving new
Docker/Tailscale apt repositories are intentionally skipped during dry-run because
Ansible cannot install packages from repositories that do not exist yet. It is a
best-effort preview, not a full simulation. Only apply changes on the target server.

## Default MS-A2 profile

- Apt: SSH, Git, build tools, editor, terminal tools, diagnostics, just.
- Official Docker Engine repository + Docker Compose, no Docker TCP socket.
- Official Tailscale repository + service; authentication requires sudo tailscale up.
- KVM packages and user group for optional Docker Sandboxes.
- No user added to docker group by default: it would grant root-equivalent access.
- Optional docker-sbx package disabled by default; enable fleet_enable_sbx in host profile.
- No changes to DHCP, routing, interface names, Wi-Fi, firewall or SSH auth settings.
- No destructive disk configuration, no remote reboot, no auto poweroff.

Tools such as T3 Code, Bun, Convex, and agent credentials are installed/configured later
after SSH and isolation have been validated. Do not store tokens in this public repo.

## Host settings

Modify fleet/hosts/ms-a2.yml. Re-running apply is designed to be idempotent.
Create additional host profiles by copying the file, not copying macOS dotfiles.
The supported initial target is Ubuntu 24.04+ x86_64.

For Docker without sudo, set fleet_allow_docker_group: true only if you accept
giving the chosen login user effectively root access. Prefer isolated sandbox
agents over handing host Docker access to untrusted code.

Docker Sandboxes uses KVM. Once installed with fleet_enable_sbx: true, log out and
back in for group changes, then run sbx login and verify a local sandbox.
Official installation: https://docs.docker.com/ai/sandboxes/install/

## Reproducibility boundary

Ubuntu disk installation is deliberately manual in v1. Git + Ansible reproduces
the operating-system configuration after first boot; it does not back up files,
SSH private keys, Docker volumes, Tailscale identity, Better Auth data, or Convex.
See docs/recovery.md. Pinning exact apt/Docker versions and disk autoinstall are
separate follow-ups once the machine has been tested.

## macOS compatibility

Existing dotfiles are still at repository root and still use GNU Stow.
The old switch.sh is kept and supports both ~/dotfiles and ~/fleet.
GNU Stow ignores Fleet and documentation files.
