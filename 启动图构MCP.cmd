@echo off
set "ELECTRON_RUN_AS_NODE="
set "TUGOU_DATA_DIR=%~dp0app\preview-data"
set "TUGOU_BUILD_DIR="
start "" "%~dp0app\release\settings-prep\win-unpacked\Tugou.exe" --mcp-enable
