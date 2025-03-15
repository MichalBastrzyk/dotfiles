# Aliases
alias ..="cd .."
# Adding icloud to the directrory hash table to make the accesibility easier
hash -d ic=~/Library/Mobile\ Documents/com~apple~CloudDocs

alias switch="$HOME/.local/bin/switch.sh"

# Purge DNS cache
alias flush-dns-cache="sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"
