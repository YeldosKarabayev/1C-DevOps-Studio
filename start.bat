@echo off
rem Запуск 1С DevOps Studio.
rem Сбрасываем ELECTRON_RUN_AS_NODE — иначе electron.exe стартует как Node, а не как GUI.
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
