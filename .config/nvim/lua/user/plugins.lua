local fn = vim.fn

-- Automatically install packer
local install_path = fn.stdpath "data" .. "/site/pack/packer/start/packer.nvim"
if fn.empty(fn.glob(install_path)) > 0 then
  PACKER_BOOTSTRAP = fn.system {
    "git",
    "clone",
    "--depth",
    "1",
    "https://github.com/wbthomason/packer.nvim",
    install_path,
  }
  print "Installing packer close and reopen Neovim..."
  vim.cmd [[packadd packer.nvim]]
end

-- Autocommand that reloads neovim whenever you save the plugins.lua file
vim.cmd [[
  augroup packer_user_config
    autocmd!
    autocmd BufWritePost plugins.lua source <afile> | PackerSync
  augroup end
]]

-- Use a protected call so we don't error out on first use
local status_ok, packer = pcall(require, "packer")
if not status_ok then
  return
end

-- Have packer use a popup window
packer.init {
  display = {
    open_fn = function()
      return require("packer.util").float { border = "rounded" }
    end,
  },
}

-- Install your plugins here
return packer.startup(function(use)
  use "wbthomason/packer.nvim" -- Have packer manage itself

  -- Git stuff
  use "tpope/vim-fugitive" -- Better git intergration

  -- Visual stuff
  use "nvim-lua/popup.nvim" -- An implementation of the Popup API from vim in Neovim
  use "nvim-lualine/lualine.nvim" -- Vim airline equvilent written in Lua
  use "ayu-theme/ayu-vim" -- Favorite color scheme
  use { "nvim-treesitter/nvim-treesitter", run = ":TSUpdate", } -- Better syntax highlighting
  use "kyazdani42/nvim-web-devicons" -- Icons for nvim

  -- Additional bulshit
  use "kyazdani42/nvim-tree.lua"
  use "romgrk/barbar.nvim"
  use "lukas-reineke/indent-blankline.nvim"
  use "numToStr/Comment.nvim"


  -- LSP Stuff
  use "neovim/nvim-lspconfig" -- Enable lsp
  use "williamboman/nvim-lsp-installer" -- LSP server installer LspInstallInfo
  use "glepnir/lspsaga.nvim"
  use "onsails/lspkind-nvim"
  use "hrsh7th/nvim-cmp"
  use "hrsh7th/cmp-nvim-lsp"
  use "saadparwaiz1/cmp_luasnip"
  use "L3MON4D3/LuaSnip"

  if PACKER_BOOTSTRAP then
    require("packer").sync()
  end
end)
