# Fleet

One repository for development machines: macOS dotfiles and repeatable Ubuntu Server setup.
The current GitHub repository is still named dotfiles; Fleet is the proposed name.

## Layout

- Existing .config/, .local/, .zshenv, Brewfile: existing macOS dotfiles, unchanged.
- fleet/: Ubuntu Server profiles, Ansible, bootstrap and health checks.
- justfile: short commands on macOS and Ubuntu.
- docs/macos.md: the previous macOS setup guide.

## Ubuntu Server (Minisforum MS-A2)

Install Ubuntu Server 26.04 LTS or 24.04 LTS and OpenSSH with a verified public key.
Then, on the Ubuntu machine:

    sudo apt-get update && sudo apt-get install -y git
    git clone https://github.com/MichalBastrzyk/dotfiles.git ~/fleet
    cd ~/fleet
    git switch feat/fleet-ubuntu-server
    ./fleet/bin/fleet bootstrap ms-a2
    ./fleet/bin/fleet doctor

After a future merge and repository rename, clone the renamed fleet repository instead.
The bootstrap script installs Ansible and applies the MS-A2 profile.
It does not alter IP routing, Wi-Fi, SSH authentication policy, disks or BIOS settings.

See fleet/README.md for preview, security limits and recovery steps.

## macOS (existing configuration)

    git clone https://github.com/MichalBastrzyk/dotfiles.git ~/fleet
    cd ~/fleet
    ./.local/bin/switch.sh

The old ~/dotfiles checkout is still supported. The macOS script requires Homebrew
and GNU Stow, and still performs Homebrew updates. Nothing in fleet/ is Stowed.
Read docs/macos.md for the original detailed instructions.

## Common commands

    just fleet-doctor
    just fleet-check ms-a2
    just fleet-apply ms-a2
    just mac-switch

Alternatively, use ./fleet/bin/fleet without installing just.

## Security

This is a public repository. Never commit SSH private keys, GitHub or Tailscale tokens,
Ansible secrets, Convex credentials, cloud access keys or .env files.
The initial Linux setup deliberately requires local confirmation for network and power
settings. Verify access over SSH before making any SSH hardening or Wake-on-LAN changes.

## License

MIT (LICENSE).
