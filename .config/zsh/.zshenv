#!/usr/bin/env bash

# History settings
export HISTSIZE=10000
export SAVEHIST=10000

# Linux-style XDG configuration 
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state"

export GOPATH=$XDG_CACHE_HOME/go 

export PATH=$PATH:"/opt/homebrew/opt/libpq/bin":"$HOME/.cache/.bun/bin":"$HOME/Library/Python/3.9/bin":"/opt/homebrew/opt/rustup/bin":$GOPATH/bin


[ -z "$XDG_RUNTIME_DIR" ] && export XDG_RUNTIME_DIR="$XDG_CACHE_HOME"

if [[ $(uname) == "Darwin" ]]; then
	eval "$(/opt/homebrew/bin/brew shellenv)"
fi

export BUN_INSTALL="$HOME/.bun"
export PATH="$GOPATH/bin:$HOME/.local/bin/:$BUN_INSTALL/bin:$PATH"
