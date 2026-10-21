$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$demoPath = Join-Path $repositoryRoot 'demo\index.html'

if (-not (Test-Path -LiteralPath $demoPath -PathType Leaf)) {
    throw "Web demo does not exist: $demoPath"
}

$content = Get-Content -LiteralPath $demoPath -Raw -Encoding UTF8
$requiredMarkers = @(
    '<title>ScholarFlow · Research Workspace</title>',
    'class="project-switcher"',
    'data-view="overview"',
    'data-view="sources"',
    'data-view="reading"',
    'data-view="notes"',
    'data-view="evidence"',
    'data-view="experiments"',
    'class="agent-panel"',
    'id="runExperiment"',
    'const projectData = {'
)

foreach ($marker in $requiredMarkers) {
    if (-not $content.Contains($marker)) {
        throw "Web demo is missing required marker: $marker"
    }
}

$externalAssets = @(
    '<script src=',
    '<link rel="stylesheet"'
)

foreach ($asset in $externalAssets) {
    if ($content.Contains($asset)) {
        throw "Web demo must remain self-contained, but found: $asset"
    }
}

$scriptMatch = [regex]::Match($content, '<script>([\s\S]*)</script>')
if (-not $scriptMatch.Success) {
    throw 'Web demo does not contain an inline interaction script.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($null -ne $nodeCommand) {
    $scriptMatch.Groups[1].Value | & $nodeCommand.Source --check -
    if ($LASTEXITCODE -ne 0) {
        throw 'Inline JavaScript syntax check failed.'
    }
}

Write-Output 'ScholarFlow web demo checks passed.'
