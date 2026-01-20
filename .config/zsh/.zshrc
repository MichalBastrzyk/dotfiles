# Aliases
alias ..="cd .."
# Adding icloud to the directrory hash table to make the accesibility easier
hash -d ic=~/Library/Mobile\ Documents/com~apple~CloudDocs

alias switch="$HOME/.local/bin/switch.sh"
alias remove-password-from-pdf="$HOME/.local/bin/remove-password-from-pdf.sh"

# Purge DNS cache
alias flush-dns-cache="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"

# ls 
alias ls="eza -l --icons --git --group-directories-first"
alias l="eza -l --icons --git --group-directories-first"
alias ll="eza -l --icons --git --group-directories-first"
alias la="eza -l --icons --git --group-directories-first -a"
alias lsd="eza -l --icons --git --group-directories-first -s date"

alias lg="lazygit"

# Opencod
alias oc="opencode"

# Shell integrations
eval "$(fzf --zsh)"
eval "$(zoxide init --cmd cd zsh)"

# Other tools
eval "$(fnm env --use-on-cd --shell zsh)"

# Shell prompt
eval "$(starship init zsh)"

alias rename="python3 ~/dev/rename/main.py"
alias team_folders="python3 ~/dev/team_folders/main.py"

# bun completions
[ -s "/Users/michal/.bun/_bun" ] && source "/Users/michal/.bun/_bun"
