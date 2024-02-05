#!/bin/bash

sessions=$(tmux list-sessions -F '#S')
selected_session=$(echo "$sessions" | fzf)

if [ -n "$selected_session" ]; then
    if [ -n "$TMUX" ]; then
      tmux switch-client -t "$selected_session"
    else
      tmux attach-session -t "$selected_session"
    fi
fi
# 

