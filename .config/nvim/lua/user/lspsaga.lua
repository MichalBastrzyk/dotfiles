local saga = require 'lspsaga'

saga.init_lsp_saga {
  error_sign = '',
  warn_sign = '',
  hint_sign = '',
  infor_sign = '',
  border_style = "round",
}

local map = vim.api.nvim_set_keymap
map("n", "<C-j>", ":Lspsaga diagnostic_jump_next<CR>", { silent = true, })
map("n", "gh", ":Lspsaga lsp_finder<CR>", { silent = true, })
map("n", "gp", ":Lspsaga preview_definition<CR>", { silent = true, })
