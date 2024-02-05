# My Dotfiles

## Requirements

- [brew](https://brew.sh)
- [GNU/stow](https://www.gnu.org/software/stow) (`brew install stow`)

## Installation instructions

### Install brew

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install required stuff from .Brewfile

```sh
brew bundle --file .config/Brewfile
```

### Link dotfiles using `GNU/STOW`

Stow describes itself as a “symlink farm manager”, but in practical terms it’s just a program that can mirror the structure of one directory into another by creating symbolic links back to the original files.

```sh
stow .
```

