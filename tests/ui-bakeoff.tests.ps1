$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$demoPath = Join-Path $repositoryRoot 'demo\index.html'

if (-not (Test-Path -LiteralPath $demoPath -PathType Leaf)) {
    throw "Web demo does not exist: $demoPath"
}

$content = Get-Content -LiteralPath $demoPath -Raw -Encoding UTF8

$requiredIds = @(
    'projectSwitcher',
    'projectMenu',
    'globalSearch',
    'contextTab',
    'paperFilter',
    'agentThread',
    'agentForm',
    'agentInput',
    'runExperiment',
    'commandOverlay',
    'commandInput',
    'toast'
)

foreach ($id in $requiredIds) {
    if (-not $content.Contains("id=`"$id`"")) {
        throw "Web demo is missing required interaction id: $id"
    }
}

$requiredBehaviors = @(
    'data-open-view=',
    'data-agent-prompt=',
    'data-toast=',
    "addEventListener('click'",
    "addEventListener('submit'",
    "addEventListener('keydown'",
    "addEventListener('input'"
)

foreach ($marker in $requiredBehaviors) {
    if (-not $content.Contains($marker)) {
        throw "Web demo is missing required interaction behavior: $marker"
    }
}

$views = @('overview', 'sources', 'reading', 'notes', 'evidence', 'experiments')
foreach ($view in $views) {
    $viewPattern = 'data-view=["'']' + [regex]::Escape($view) + '["'']'
    if (-not [regex]::IsMatch($content, $viewPattern)) {
        throw "Web demo is missing required workspace view: $view"
    }
}

$networkPatterns = @(
    '<script\s+[^>]*src\s*=',
    '<link\s+[^>]*rel\s*=\s*["'']stylesheet["'']',
    '@import\s+',
    'url\(\s*["'']?https?://',
    '(?:src|href)\s*=\s*["'']https?://',
    '\bfetch\s*\('
)

foreach ($pattern in $networkPatterns) {
    if ([regex]::IsMatch($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        throw "Web demo must remain network-independent, but matched pattern: $pattern"
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

Write-Output 'ScholarFlow UI bake-off contract checks passed.'
