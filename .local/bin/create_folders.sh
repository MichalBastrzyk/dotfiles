#!/usr/bin/env bash
# -------------------------------------------------
# create_folders.sh – make numbered folders from stdin
# -------------------------------------------------
# Usage:
#   cat teams.txt | ./create_folders.sh
#   ./create_folders.sh   # then type/paste the list and press Ctrl‑D
# -------------------------------------------------

counter=1

while IFS= read -r team; do
    # Skip empty lines (optional)
    [[ -z $team ]] && continue

    # Build the directory name with a two‑digit prefix
    dir=$(printf "%02d %s" "$counter" "$team")

    # Create the directory; -p avoids an error if it already exists
    mkdir -p -- "$dir"

    ((counter++))
done
