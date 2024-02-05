-- First, get the path of the image you want to use as your wallpaper
set wallpaperPath to "/Users/michal/Pictures/wallpapers/irish-summer.jpg"

-- Set the wallpaper for the current desktop
tell application "Finder"
    set desktop picture to POSIX file wallpaperPath
end tell

-- Get the IDs of all desktops
set desktopIDs to {}
tell application "System Events"
    set desktopCount to count desktops
    repeat with desktopIndex from 1 to desktopCount
        set currentDesktopID to (desktop id desktopIndex)'s id
        try
            set currentDesktopWindows to windows of desktop id currentDesktopID
            if (count of currentDesktopWindows) > 0 then
                repeat with currentWindow in currentDesktopWindows
                    set end of desktopIDs to (currentWindow's id)
                end repeat
            end if
        on error errMsg number errNum
            -- If there is an error getting the windows for a desktop, skip it
            log "Error getting windows for desktop " & currentDesktopID & ": " & errMsg & " (" & errNum & ")"
        end try
    end repeat
end tell

-- Set the wallpaper for all desktops
repeat with desktopID in desktopIDs
    tell application "System Events"
        try
            tell (a reference to window id desktopID)
                set picture to wallpaperPath
            end tell
        on error errMsg number errNum
            -- If there is an error setting the wallpaper for a window, skip it
            log "Error setting wallpaper for window " & desktopID & ": " & errMsg & " (" & errNum & ")"
        end try
    end tell
end repeat

