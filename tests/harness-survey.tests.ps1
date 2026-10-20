$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'harness-survey.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Harness survey provenance checks failed.' }
