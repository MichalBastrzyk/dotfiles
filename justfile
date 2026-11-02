# These commands run on the target Ubuntu machine, unless stated otherwise.
default:
    @just --list

fleet-bootstrap host="ms-a2":
    ./fleet/bin/fleet bootstrap {{host}}

fleet-doctor:
    ./fleet/bin/fleet doctor

fleet-check host="ms-a2":
    ./fleet/bin/fleet check {{host}}

fleet-apply host="ms-a2":
    ./fleet/bin/fleet apply {{host}}

# macOS only; preserves existing Homebrew and GNU Stow workflow.
mac-switch:
    ./.local/bin/switch.sh
