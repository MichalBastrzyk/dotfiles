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

alias nvm="fnm"

# Shell prompt
eval "$(starship init zsh)"

alias rename="python3 ~/dev/rename/main.py"
alias team_folders="python3 ~/dev/team_folders/main.py"

# bun completions
[ -s "/Users/michal/.bun/_bun" ] && source "/Users/michal/.bun/_bun"

# Recreate game folder structure
mk-game-folders() {
  local base="${1:-.}"
  local dirs=(
    "01 MLBB Wildcard"
    "02 Valorant"
    "03 Apex Legends"
    "04 Dota 2"
    "05 FATAL FURY"
    "06 League of Legends"
    "07 MLBB MWI"
    "08 Free Fire"
    "09 PUBG PC"
    "10 Teamfight Tactics"
    "11 EA FC 26"
    "12 MLBB MSC"
    "13 Overwatch 2"
    "14 COD Warzone"
    "15 Street Fighter 6"
    "16 Honor of Kings"
    "17 Rainbow Six Siege"
    "18 PUBG MOBILE"
    "19 TEKKEN 8"
    "20 COD BO7"
    "21 Chess"
    "22 Rocket League"
    "23 Counter Strike 2"
    "24 Fortnite"
    "25 CROSSFIRE"
    "26 Trackmania"
  )
  for d in "${dirs[@]}"; do
    mkdir -p "$base/$d" || return 1
  done
  echo "Done — created event coverage folders in $base"
}

# Pi Coding Agent Setup
export PI_CODING_AGENT_DIR="$HOME/.config/pi" 
export PI_CODING_AGENT_SESSION_DIR="$HOME/.local/share/pi" 

alias cr="coderabbit"
