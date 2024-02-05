#!/bin/bash

cd $HOME/dev

sessions=$(tmux list-sessions -F '#S')
selected_session=$(echo "$sessions" | fzf)

fd -d 2 -t d | fzf | xargs -I % tmux new-session -d -s %
