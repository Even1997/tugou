@echo off
set TUGOU_DATA_DIR=
start "" /D "%~dp0" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
