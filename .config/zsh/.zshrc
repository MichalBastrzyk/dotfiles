# Aliases
alias ..="cd .."
# Adding icloud to the directrory hash table to make the accesibility easier
hash -d ic=~/Library/Mobile\ Documents/com~apple~CloudDocs

alias switch="$HOME/.local/bin/switch.sh"

# Purge DNS cache
alias flush-dns-cache="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"

# ls 
alias ls="eza -l --icons --git --group-directories-first"
alias l="eza -l --icons --git --group-directories-first"
alias ll="eza -l --icons --git --group-directories-first"
alias la="eza -l --icons --git --group-directories-first -a"
alias lsd="eza -l --icons --git --group-directories-first -s date"

# Shell integrations
eval "$(fzf --zsh)"
eval "$(zoxide init --cmd cd zsh)"

# Other tools
eval "$(fnm env --use-on-cd --shell zsh)"

# Shell prompt
eval "$(starship init zsh)"
