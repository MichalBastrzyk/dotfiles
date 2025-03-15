Collecting workspace information# Dotfiles

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