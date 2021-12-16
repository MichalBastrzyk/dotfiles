#! /usr/bin/zsh

# Terminate already running picom instances
killall -q picom

echo "---"
picom --backend=glx

echo "picom launched..."
