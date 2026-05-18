DOTFILES_DIR="${DOTFILES_DIR:-$HOME/dotfiles}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

cwd=$(pwd)

set -e

print_status() {
  printf "${BLUE}\n--> %s${NC}\n" "$1"
}

print_success() {
  printf "${GREEN}✓ %s${NC}\n" "$1"
}

print_error() {
  printf "${RED}✗ %s${NC}\n" "$1"
  exit 1
}

command -v brew >/dev/null 2>&1 || { print_error "Homebrew is required but not installed. Aborting."; }
command -v stow >/dev/null 2>&1 || { print_error "GNU Stow is required but not installed. Aborting."; }

print_status "Running brew update && brew upgrade..."
if brew update && brew upgrade; then
  print_success "Done"
else
  print_error "Failed to update or upgrade brew packages"
fi

print_status "Checking and installing programs from Brewfile"
if brew bundle --file="$DOTFILES_DIR/Brewfile"; then
  print_success "Done"
else
  print_error "Failed to install programs from Brewfile"
fi

print_status "Linking configurations using stow"
cd "$DOTFILES_DIR" || print_error "Failed to change directory to $DOTFILES_DIR"
if stow .; then
  print_success "Done"
else
  print_error "Failed to link configurations"
fi

print_status "Linking vscode settings"
if ln -sf "$DOTFILES_DIR/.config/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"; then
  print_success "Done"
else
  print_error "Failed to link VSCode settings"
fi

cd "$cwd" || print_error "Failed to return to original directory"

print_success "All operations completed successfully!"
