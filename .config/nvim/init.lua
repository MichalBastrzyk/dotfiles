-- OPTIONS start
vim.g.mapleader = " "

vim.o.wrap = false
vim.o.clipboard = ""
vim.o.number = true
vim.o.relativenumber = true
vim.o.title = true
vim.o.hlsearch = true
vim.o.backup = false
vim.o.showcmd = false
vim.o.cmdheight = 1
vim.o.backupskip = "/tmp/*,/private/tmp/*"
vim.o.smarttab = true
vim.o.breakindent = true
vim.o.backspace = "start,eol,indent"
vim.opt.path:append({ "**" })
vim.opt.wildignore:append({ "*/node_modules/*" })
vim.o.cursorline = true

vim.o.mouse = "a"
vim.o.showmode = false
vim.o.swapfile = false
vim.o.undofile = true
vim.o.ignorecase = true
vim.o.smartcase = true
vim.o.updatetime = 250
vim.o.timeoutlen = 300
vim.o.splitright = true
vim.o.splitbelow = true
vim.o.list = true
vim.opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }
vim.o.inccommand = "split"
vim.o.scrolloff = 10

-- Code folding
vim.o.foldexpr = "nvim_treesitter#foldexpr()"
vim.o.foldmethod = "expr"
vim.o.foldlevel = 99
vim.o.foldlevelstart = 99
vim.o.foldenable = true

vim.o.termguicolors = true
vim.o.winblend = 0
vim.o.wildoptions = "pum"
vim.o.pumblend = 5
vim.o.background = "dark"

vim.g.editorconfig = true
vim.o.signcolumn = "yes:1"

vim.o.spelllang = "en_us"
vim.o.spell = true
vim.o.winborder = "rounded"

-- AUTOCOMMANDS start
vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking (copying) text",
	group = vim.api.nvim_create_augroup("highlight-yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank()
	end,
})

-- KEYBINDS start
local map = vim.keymap.set

-- Copy to clipboard
map({ "n", "v" }, "<leader>y", [["+y]], { desc = "Yank to system clipboard" })
map("n", "<leader>Y", [["+Y]], { desc = "Yank whole line to system clipboard" })

map({ "n", "v" }, "<leader>P", [["+P"]], { desc = "Paste from system clipboard" })
map({ "n", "v" }, "<leader>p", [["+p"]], { desc = "Paste from system clipboard" })

-- Ctrl+s
map({ "n", "v", "i" }, "<C-s>", ":w<CR>", { desc = "Save file" })

-- -- Tabs
-- Change to Next & Previous tab
map("n", "<leader>l", ":tabnext<CR>", { desc = "Go to Next Tab", noremap = true })
map("n", "<leader>h", ":tabprevious<CR>", { desc = "Go to Previous Tab", noremap = true })
map('n', ']t', ':tabnext<CR>', { desc = 'Go to Next Tab', noremap = true })
map('n', '[t', ':tabprevious<CR>', { desc = 'Go to Previous Tab', noremap = true })

-- Go to specific tab numbers easily
map("n", "<leader>1", "1gt", { desc = "Go to Tab 1", noremap = true })
map("n", "<leader>2", "2gt", { desc = "Go to Tab 2", noremap = true })
map("n", "<leader>3", "3gt", { desc = "Go to Tab 3", noremap = true })
map("n", "<leader>4", "4gt", { desc = "Go to Tab 4", noremap = true })
map("n", "<leader>5", "5gt", { desc = "Go to Tab 5", noremap = true })
map("n", "<leader>6", "6gt", { desc = "Go to Tab 6", noremap = true })
map("n", "<leader>7", "7gt", { desc = "Go to Tab 7", noremap = true })
map("n", "<leader>8", "8gt", { desc = "Go to Tab 8", noremap = true })
map("n", "<leader>9", "9gt", { desc = "Go to Last Tab (or Tab 9)", noremap = true }) -- 9gt often goes to last tab if <9 tabs

-- Tab Creation
map("n", "<leader>tn", ":tabnew<CR>", { desc = "New Tab", noremap = true })                           -- t(ab) n(ew)
map("n", "<leader>to", ":tab split<CR>", { desc = "Open Current Buffer in New Tab", noremap = true }) -- t(ab) o(pen current)

-- Tab Closing
map("n", "<leader>tc", ":tabclose<CR>", { desc = "Close Current Tab", noremap = true }) -- t(ab) c(lose)
map("n", "<leader>tO", ":tabonly<CR>", { desc = "Close Other Tabs", noremap = true })   -- t(ab) O(nly) - Capital O for more destructive action

-- Tab Moving
map('n', '<leader><', ':tabmove -1<CR>', { desc = 'Move Tab Left', noremap = true })
map('n', '<leader>>', ':tabmove +1<CR>', { desc = 'Move Tab Right', noremap = true })

-- List Tabs
map("n", "<leader>tl", ":tabs<CR>", { desc = "List Tabs", noremap = true }) -- t(ab) l(ist)

-- PLUGINSSS

vim.pack.add({
	{ src = "https://github.com/neovim/nvim-lspconfig" },
	{ src = "https://github.com/tpope/vim-sleuth" },
	{ src = "https://github.com/Shatur/neovim-ayu" }
})

-- Colorscheme
require("ayu").setup({
	mirage = false,
	terminal = false,
	overrides = {
		-- Make the backgrounds transparent to match OpenCode
		Normal = { bg = "none" },
		NormalNC = { bg = "none" },
		NormalFloat = { bg = "none" },
		SignColumn = { bg = "none" },
		FoldColumn = { bg = "none" },
		EndOfBuffer = { bg = "none" },
		VertSplit = { bg = "none" },
	},
})

vim.cmd("colorscheme ayu-dark")

vim.pack.add({
	{ src = "https://github.com/nvim-treesitter/nvim-treesitter", branch = "master" }
}, { load = true })

-- Treesitter
local treesitter_ok, treesitter = pcall(require, "nvim-treesitter.configs")
if treesitter_ok then
	print("Tree sitter loaded")
	treesitter.setup({
		ensure_installed = {
			"lua",
			"vim",
			"vimdoc",
			"query",
			"javascript",
			"typescript",
			"tsx",
			"json",
			"bash",
			"markdown",
			"markdown_inline",
			"html",
			"css"
		},
		highlight = { enable = true },
		indent = { enable = true }
	})
end

-- LSP Configuration

map("n", "<leader>f", vim.lsp.buf.format)

vim.lsp.enable({
	"lua_ls",
	"ts_ls"
})

