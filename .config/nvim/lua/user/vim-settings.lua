local set = vim.opt

set.number = true 
set.syntax = "enable"
set.encoding = "utf-8"
set.title = true
set.autoindent = true
set.background = "dark"
set.backup = false
set.hlsearch = true
set.showcmd = true
set.cmdheight = 1
set.laststatus = 2
set.scrolloff = 10
set.expandtab = true
set.shell = "fish"
set.backupskip = "/tmp/*", "/private/tmp/*"

-- incremental subtitution (neovim)
set.inccommand = "split"

-- ignore case when searching
set.ignorecase = true

set.smarttab = true

set.filetype = "plugin", "indent", "on"
set.shiftwidth = 2
set.tabstop = 2
set.ai = true
set.si = true
set.wrap = false
set.backspace = [[start,eol,indent]]

set.cursorline = true

-- Cursor line color in visual mode

set.exrc = true
