#Requires -Version 5.1
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

# Keep this wrapper ASCII-only for Windows PowerShell 5.1. Python performs
# JSON merging and atomic UTF-8 writes without a BOM on both platforms.
$PythonBin = (Get-Command python -ErrorAction Stop).Source
$Installer = Join-Path $PSScriptRoot 'setup_hooks.py'
if ($Uninstall) {
    & $PythonBin $Installer --uninstall
} else {
    & $PythonBin $Installer
}
exit $LASTEXITCODE
