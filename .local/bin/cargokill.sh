#!/bin/bash

# Command to run in each directory
COMMAND="cargo clean"

# Loop through directories
for dir in */; do
	if [ -d "$dir" ]; then
		cd "$dir" || continue
		echo "Running command '$COMMAND' in $dir"
		eval "$COMMAND"
		cd ..
	fi
done
