#!/bin/sh

GIT_COLOR="#f14e32"

git_color_text() {
	text=$1

	gum style --foreground "$GIT_COLOR" "$text"
}

get_branches() {
	if [ ${1+x} ]; then
		gum choose --limit "$1" $(git branch --format="%(refname:short)")
	else
		gum choose --no-limit $(git branch --format="%(refname:short)")
	fi
}

gum style \
	--border normal \
	--margin "1" \
	--padding "1" \
	--border-foreground "$GIT_COLOR" \
	"$(git_color_text " Git") Branch Manager"

echo "Choose $(git_color_text "branches") to operate on:"
branches=$(get_branches)
echo ""
echo "Choose a $(git_color_text "command"):"
command=$(gum choose rebase delete update)
echo ""

echo $branches | tr " " "\n" | while read branch; do
	case $command in
	rebase)
		echo "rebasing $branch"
		base_branch=$(get_branches 1)

		git fetch origin
		git checkout "$branch"
		git rebase "origin/$base_branch"
		;;

	delete)
		echo "deleting $branch"
		git branch -D "$branch"
		;;

	update)
		echo "updating $branch"
		git checkout "$branch"
		git pull --ff-only
		;;

	esac
	echo "the branch is $branch"
done
