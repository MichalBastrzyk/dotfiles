#!/usr/bin/env bash

# Linux-style XDG configuration 
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"

export GOPATH=$XDG_CACHE_HOME/go 
export PATH=$PATH:"/opt/homebrew/opt/libpq/bin":$GOPATH/bin


[ -z "$XDG_RUNTIME_DIR" ] && export XDG_RUNTIME_DIR="$XDG_CACHE_HOME"

if [[ $(uname) == "Darwin" ]]; then
	eval "$(/opt/homebrew/bin/brew shellenv)"
fi

export PATH="$GOPATH/bin:$HOME/.local/bin/:$PATH"
