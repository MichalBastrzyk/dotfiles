vim.g.mapleader = ' '

vim.opt.clipboard = ""
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.title = true
vim.opt.hlsearch = true
vim.opt.backup = false
vim.opt.showcmd = false
vim.opt.cmdheight = 1
vim.opt.backupskip = "/tmp/*,/private/tmp/*"
vim.opt.smarttab = true
vim.opt.breakindent = true
vim.opt.backspace = "start,eol,indent"
vim.opt.path:append({ "**" })
vim.opt.wildignore:append({ "*/node_modules/*" })
vim.opt.cursorline = true;

-- Code folding
vim.opt.foldexpr = "nvim_treesitter#foldexpr()"
vim.opt.foldmethod = "expr"
vim.o.foldlevel = 99
vim.o.foldlevelstart = 99
vim.o.foldenable = true

vim.o.termguicolors = true
vim.opt.winblend = 0
vim.opt.wildoptions = "pum"
vim.opt.pumblend = 5
vim.opt.background = "dark"

-- Disable some of the default plugins
vim.g.loaded_gzip = 1
vim.g.loaded_zip = 1
vim.g.loaded_zipPlugin = 1
vim.g.loaded_tar = 1
vim.g.loaded_tarPlugin = 1

vim.g.loaded_getscript = 1
vim.g.loaded_getscriptPlugin = 1
vim.g.loaded_vimball = 1
vim.g.loaded_vimballPlugin = 1
vim.g.loaded_2html_plugin = 1

vim.g.loaded_matchit = 1
vim.g.loaded_matchparen = 1
vim.g.loaded_logiPat = 1
vim.g.loaded_rrhelper = 1

vim.g.editorconfig = true
vim.opt.signcolumn = "yes:1"

vim.opt.spelllang = "en_us"
vim.opt.spell = true

-- Copy to clipboard
vim.keymap.set({ "n", "v" }, "<leader>y", [["+y]], { desc = "Yank to system clipboard" })
vim.keymap.set("n", "<leader>Y", [["+Y]], { desc = "Yank whole line to system clipboard" })

vim.keymap.set({ "n", "v" }, "<leader>P", [["+P"]], { desc = "Paste from system clipboard" })
vim.keymap.set({ "n", "v" }, "<leader>p", [["+p"]], { desc = "Paste from system clipboard" })
