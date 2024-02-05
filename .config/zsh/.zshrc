
##
### Plugins
##

# zsh-autosuggestions
source $HOMEBREW_PREFIX/share/zsh-autosuggestions/zsh-autosuggestions.zsh

# zsh-syntax-highlighting
source $HOMEBREW_PREFIX/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

# zsh-vi-mode
source $HOMEBREW_PREFIX/opt/zsh-vi-mode/share/zsh-vi-mode/zsh-vi-mode.plugin.zsh
# Disable the cursor style feature
ZVM_CURSOR_STYLE_ENABLED=false
ZVM_VI_ESCAPE_BINDKEY=ESC
# TODO: Make PageUp and PageDown not enter vi mode
# TODO: Make shift tab also not enter vi mode

##
### Other
##

if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR="vim"
else
  export EDITOR="nvim"
fi


##
### Aliases
##

alias ..="cd .."

alias tldrf="tldr -l | fzf --preview 'tldr {1} --color=always' --preview-window=right,70% | xargs tldr"

# Open current gh repo in browser
alias git-browser='ssh_url=$(git config --get remote.origin.url | sed "s/https:\/\/github.com\///g" | sed "s/git@github.com:\(.*\)\.git/\1/"); open "https://github.com/$ssh_url"'

alias v="nvim"
alias vim="nvim"
alias pn="pnpm"

# ls 
alias ls="eza -l --icons --git"
alias l="eza -l --icons --git"
alias ll="eza -l --icons --git"
alias la="eza -l --icons --git -a"
alias lsd="eza -l --icons --git -s date"

# git
alias g="git"
alias gs="git status"
alias ga="git add"
alias gaa="git add -A"
alias gc="git commit -m "

alias lg="lazygit"
alias yadmgui="lazygit --work-tree ~ --git-dir ~/.local/share/yadm/repo.git"
alias lvim="NVIM_APPNAME=LazyVim nvim"

# yt-dlp
alias yta="yt-dlp -x --audio-format opus --audio-quality 0 --embed-metadata --embed-thumbnail --sponsorblock-mark all"
alias ytv="yt-dlp --merge-output-format mkv --audio-quality 0 --embed-metadata --embed-thumbnail --embed-subs --convert-thumbnails jpg --sponsorblock-mark all"

# trash-cli
alias tr="trash"

# Useful docker containers

# Starts a LAMP stack instance in the current folder
alias lamp-docker="docker run -p "80:80" -v ${PWD}:/app mattrayner/lamp:latest-2004-php8"

# Purge DNS cache
alias flush-dns-cache="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"

##
### Keybinds
##

bindkey -s '^t' 'tmux-sessionizer\n'

##
### Setup version managers
##

eval "$(fnm env --use-on-cd)"
export PATH="$(pyenv root)/shims:$PATH"


##
### Setup shell prompt
##

eval "$(starship init zsh)"
