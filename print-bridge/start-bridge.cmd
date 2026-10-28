@echo off
rem Starts the Buzzify print bridge. Put a shortcut to this file in the Windows Startup folder (Win+R, shell:startup).
rem Change the address below to the address you open the till at.
cd /d "%~dp0"
node bridge.mjs --origin https://studio.buzzify-menu.online
pause
