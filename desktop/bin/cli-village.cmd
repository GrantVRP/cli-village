@echo off
rem CLI Village's own cli-village command, for the desktop app's terminal (like VS Code's
rem code.cmd). The app sets CLI_VILLAGE_ELECTRON and CLI_VILLAGE_CLI in that terminal;
rem ELECTRON_RUN_AS_NODE makes the app's Electron run the command line as plain Node.js.
if not defined CLI_VILLAGE_ELECTRON (
  echo This cli-village works only in the CLI Village app's terminal. Elsewhere: npm install -g cli-village 1>&2
  exit /b 1
)
setlocal
set ELECTRON_RUN_AS_NODE=1
"%CLI_VILLAGE_ELECTRON%" "%CLI_VILLAGE_CLI%" %*
exit /b %ERRORLEVEL%
