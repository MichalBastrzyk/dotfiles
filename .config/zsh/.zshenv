# Linux-style XDG configuration 
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_DATA_HOME="$HOME/.local/share"
[ -z "$XDG_RUNTIME_DIR" ] && export XDG_RUNTIME_DIR="$XDG_CACHE_HOME"

eval "$(/opt/homebrew/bin/brew shellenv)"

. "$HOME/.cargo/env"

export ANDROID_HOME="/Users/michal/Library/Android/sdk"

export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="/opt/homebrew/opt/bin:/opt/homebrew/opt/openjdk/bin:/Users/michal/Library/Android/sdk/platform-tools:/opt/homebrew/opt/qt/bin:$HOME/.src/flutter/bin:$HOME/.pub-cache/bin:$PNPM_HOME:BUN_INSTALL/bin:Location:$HOME/Library/Python/3.11/lib/python/site-packages:$HOME/.local/bin/:/Users/michal/Library/Application Support/JetBrains/Toolbox/scripts:/Library/Frameworks/Python.framework/Versions/3.11/bin:/opt/homebrew/opt/mysql-client/bin:$HOME/.local/share/go/bin:/usr/local/opt/game-porting-toolkit/bin:$PATH"
export CPPFLAGS="-I/opt/homebrew/opt/openjdk/include"
export LDFLAGS="-L/usr/local/opt/game-porting-toolkit/lib"
