$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

# Parse the source with a real XML parser; Node verifies semantic/roadmap contracts.
$diagramPath = Join-Path $repositoryRoot 'docs\diagrams\architecture.drawio'
[xml]$diagram = Get-Content -LiteralPath $diagramPath -Raw -Encoding UTF8
if ($diagram.DocumentElement.Name -ne 'mxfile') {
    throw 'Architecture diagram must be a valid drawio mxfile.'
}
if ($diagram.SelectNodes('//diagram').Count -ne 1) {
    throw 'Architecture diagram must contain exactly one architecture page.'
}

& node (Join-Path $PSScriptRoot 'architecture-docs.mjs')
if ($LASTEXITCODE -ne 0) {
    throw "Architecture documentation contract tests failed (exit $LASTEXITCODE)."
}
Write-Output 'XML parsing and architecture documentation checks passed (not runtime acceptance).'
