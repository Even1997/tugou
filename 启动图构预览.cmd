@echo off
set "TUGOU_DATA_DIR=%~dp0app\preview-data"
set "TUGOU_BUILD_DIR="
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0app\release\font-library\win-unpacked\Tugou.exe" --mcp-enable
