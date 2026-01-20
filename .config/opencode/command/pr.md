---
description: "Push current branch and open a GitHub PR with a changelog from git log + diff"
agent: build
model: opencode/big-pickle
---

Creating PR with changelog…

*!bash -lc 'set -eo pipefail

branch="$(git branch --show-current)"
echo "Current branch: $branch"

# Base branch: allow `/pr develop`, otherwise detect repo default branch via GH CLI
base="${1:-$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)}"
echo "Base branch: $base"

# Ensure we have the base branch locally to diff against
git fetch origin "$base" --quiet

# Range of changes compared to base
range="origin/$base...HEAD"

# Collect context
title="$(git log -1 --pretty=%s)"
commits="$(git log --no-merges --pretty=format:"- %s (%h)" "$range" || true)"
files="$(git diff --name-status "$range" || true)"
diffstat="$(git diff --stat "$range" || true)"

# Make body (Markdown)
body="$(cat <<EOF
## Summary
This PR merges \`$branch\` into \`$base\`.

## Commits (from git log)
${commits:-"- (No commits found in range $range)"}

## Files changed
\`\`\`
${files:-"(No file changes found)"}
\`\`\`

## Diffstat
\`\`\`
${diffstat:-"(No diffstat found)"}
\`\`\`
EOF
)"

# Push current branch so the PR can be created
git push -u origin HEAD

# Create PR (explicit title/body so it includes the changelog above)
gh pr create --base "$base" --head "$branch" --title "$title" --body "$body"
'*

