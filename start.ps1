$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$stockwiseNode = Get-Command node -ErrorAction SilentlyContinue
if ($stockwiseNode) { $stockwiseNodePath = $stockwiseNode.Source } else {
    $stockwiseNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $stockwiseNodePath)) { throw 'Node.js 24+ is required. Install it from https://nodejs.org.' }
& $stockwiseNodePath --env-file-if-exists=.env src/server.js
