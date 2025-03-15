# Dotfiles

A personal collection of configuration files for my development environment. This repository contains configurations for various tools and applications that I use regularly.

## Overview

This dotfiles repository uses GNU Stow to manage symlinks, making it easy to set up a consistent environment across different machines. The repository includes configurations for:

- Zsh (shell)
- Neovim (editor)
- Git
- Ghostty (terminal)
- Homebrew packages

## Requirements

- macOS (some configurations are macOS-specific)
- [Homebrew](https://brew.sh/)
- [GNU Stow](https://www.gnu.org/software/stow/)

## Installation

1. Clone this repository to your home directory:

```sh
git clone https://github.com/MichalBastrzyk/dotfiles.git ~/dotfiles
```

2. Run the switch script to set up everything:

```sh
cd ~/dotfiles
chmod +x .local/bin/switch.sh
./.local/bin/switch.sh
```

Optional: Run this to fix dock slowly appearing.

```sh
defaults write com.apple.dock autohide-time-modifier -float 0.50; killall Dock
```

## What's Included

### Shell Configuration

- .zshrc: Contains aliases and shell customizations
- .zshenv: Environment variables and path configurations
- .zshenv: Top-level zsh environment loader

### Neovim Configuration

- init.lua: Basic Neovim configuration
- .editorconfig: EditorConfig settings

### Git Configuration

- config: Git user information and default settings

### Ghostty Terminal

- config: Terminal appearance settings

### Utility Scripts

- switch.sh: Script for setting up the environment, updating packages, and creating symlinks

### Package Management

- Brewfile: List of packages to be installed via Homebrew

Okay, here's a super compact section for your `README` based on our conversation, focusing on the `hidutil` with `--match` approach:

### Key Remapping [using this guide](https://gist.github.com/paultheman/808be117d447c490a29d6405975d41bd)

Remap keys using a LaunchAgent and `hidutil` for specific devices.

1. List your devices and find `VendorID` and `ProductID` using `hidutil list`.
2. Use [hidutil-generator](https://hidutil-generator.netlify.app/) to see the codes that you want to use to rebind.
3. Create `~/Library/LaunchAgents/com.local.KeyRemapping.plist` with the following contents:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.local.KeyRemapping</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/hidutil</string>
        <string>property</string>
        <string>--match</string>
        <string>{"VendorID":0x5ac,"ProductID":0x24f}</string>
        <string>--set</string>
        <string>{"UserKeyMapping":[
            {
              "HIDKeyboardModifierMappingSrc": 0x700000029,
              "HIDKeyboardModifierMappingDst": 0x700000035
            },
            {
              "HIDKeyboardModifierMappingSrc": 0x700000039,
              "HIDKeyboardModifierMappingDst": 0x700000029
            }
        ]}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
```

4. Load the LaunchAgent with:

```sh
launchctl load ~/Library/LaunchAgents/com.local.KeyRemapping.plist
```

To unload the LaunchAgent, use:

```sh
launchctl unload ~/Library/LaunchAgents/com.local.KeyRemapping.plist
```

Source [keybinds/com.local.KeyRemapping.plist](./keybinds/com.local.KeyRemapping.plist)

**Note:** Adjust `VendorID` and `ProductID` as needed.

## Usage

After installation, your dotfiles will be symlinked to the appropriate locations. The switch.sh script can be used any time to update your environment:

```sh
switch
```

This will:

- Update Homebrew packages
- Install new Homebrew packages listed in the Brewfile
- Create symlinks for your dotfiles

## Customization

Feel free to fork this repository and modify it according to your preferences. The modular structure makes it easy to add or remove configurations.

## License

This project is open-source and available under the MIT License.
