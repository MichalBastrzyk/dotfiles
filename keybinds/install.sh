ln -sf $HOME/dotfiles/keybinds/com.local.KeyRemapping.plist $HOME/Library/LaunchAgents/com.local.KeyRemapping.plist

launchctl load ~/Library/LaunchAgents/com.local.KeyRemapping.plist
