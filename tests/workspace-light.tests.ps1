param([int]$Port = 8813, [switch]$CheckCleanup)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$content = Get-Content (Join-Path $root 'demo/workspace-light.html') -Raw -Encoding UTF8
foreach ($marker in @('data-version="ide-light-v2"', 'data-view="overview"', 'data-view="sources"', 'data-view="reading"', 'data-view="notes"', 'data-view="evidence"', 'data-view="experiments"', 'id="runExperiment"', 'id="agentForm"', 'role="log"', 'prefers-reduced-motion', 'aria-selected', 'isComposing')) {
    if (-not $content.Contains($marker)) { throw "New demo contract missing: $marker" }
}
foreach ($pattern in @('<script[^>]*src=', '<link[^>]*rel="stylesheet"', 'url\(["'']?https?://', '\bfetch\s*\(', '<svg')) {
    if ($content -match $pattern) { throw "Demo must use local assets and repository-native JS only: $pattern" }
}
foreach ($marker in @('data-agent-layer="skill-profile-approval"','id="profilePickerTrigger"','id="skillPickerTrigger"','id="profilePicker"','id="skillPicker"','id="skillSearch"','id="applySkills"','id="initialApproval"','data-approval-action','本次请求快照','未创建文件')) {
    if (-not $content.Contains($marker)) { throw "Agent visual layer contract missing: $marker" }
}
foreach ($name in @('document.svg','folder.svg','reading.svg','matrix.svg','experiment.svg','geist-variable.woff2','OFL.txt')) {
    $asset = Join-Path $root ('demo/assets/ide-light/' + $name)
    if (-not (Test-Path -LiteralPath $asset) -or (Get-Item -LiteralPath $asset).Length -lt 100) { throw "Missing local design asset: $name" }
}
$assetDirectory = Join-Path $root 'demo/assets/ide-light'
$manifest = Get-Content (Join-Path $assetDirectory 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.figma.screenNode -ne '10:2' -or $manifest.font.commit -ne '10dc7658f13c38a474cde201bb09a4617267545b' -or @($manifest.files).Count -ne 7) { throw 'Design asset provenance is incomplete.' }
foreach ($entry in $manifest.files) {
    if ($entry.name -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Asset manifest must name local files, not arbitrary paths.' }
    $hash = (Get-FileHash -LiteralPath (Join-Path $assetDirectory $entry.name) -Algorithm SHA256).Hash
    if ($hash -ne $entry.sha256) { throw "Exported design asset changed: $($entry.name)" }
    $attribute = git -C $root check-attr text -- ('demo/assets/ide-light/' + $entry.name)
    if ($LASTEXITCODE -ne 0 -or $attribute -notmatch ': text: unset$') { throw "Asset byte preservation is not configured: $($entry.name)" }
}
foreach ($name in @('README.md','.experiments/frontend-bakeoff/LIGHT_V2_REVIEW.md','.experiments/frontend-bakeoff/WORKTREE_CLEANUP.md','tests/workspace-light.preview.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $name))) { throw "Missing demo review or preview artifact: $name" }
}
$syntaxCheckEncoding = $OutputEncoding
try {
    # Windows PowerShell otherwise pipes non-ASCII JavaScript as question marks.
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    [regex]::Match($content,'<script>([\s\S]*?)</script>').Groups[1].Value | node --check -
} finally {
    $OutputEncoding = $syntaxCheckEncoding
}
if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax validation failed.' }
git -C $root diff --exit-code 1db5ab8 -- demo/index.html .experiments/frontend-bakeoff/scholarflow-ide-v1.png .experiments/frontend-bakeoff/figma-state-scholarflow-ide-v1.json .experiments/frontend-bakeoff/figma-audit-scholarflow-ide-v1.json
if ($LASTEXITCODE -ne 0) { throw 'Original demo or first-version Figma archive was overwritten.' }
if ($CheckCleanup) {
    $worktrees = @(git -C $root worktree list --porcelain | Where-Object { $_ -like 'worktree *' })
    if ($worktrees.Count -ne 1) { throw 'Experiment worktrees were not cleaned.' }
    foreach ($branch in @('exp/variant-a','exp/variant-b','exp/variant-c','exp/variant-d')) {
        git -C $root show-ref --verify --quiet ('refs/heads/' + $branch)
        if ($LASTEXITCODE -ne 0) { throw "Missing recovery branch: $branch" }
    }
}
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path -LiteralPath $chrome)) { $chrome = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }
if (-not (Test-Path -LiteralPath $chrome)) { throw 'Chromium is required for isolated browser verification.' }
$python = (Get-Command python -ErrorAction Stop).Source
$tempRoot = [IO.Path]::GetTempPath()
$profile = Join-Path $tempRoot ('scholarflow-browser-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $profile | Out-Null
$server = Start-Process -FilePath $python -ArgumentList @('-m','http.server',"$Port",'--bind','127.0.0.1','--directory',('"' + $root + '"')) -PassThru -WindowStyle Hidden
try {
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if ($server.HasExited) { throw 'Test server exited; the port may already be in use.' }
        try { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri "http://127.0.0.1:$Port/demo/workspace-light.html"; $ready = $true; break } catch { Start-Sleep -Milliseconds 100 }
    }
    if (-not $ready) { throw 'Test server did not start.' }
    foreach ($size in @(@(1440,900,'notes'),@(1280,800,'reading'),@(1024,768,'toString'),@(390,844,'overview'))) {
        $url = "http://127.0.0.1:$Port/tests/workspace-light.browser.html?width=$($size[0])&height=$($size[1])&view=$($size[2])"
        $output = & $chrome --headless --disable-gpu --no-first-run --no-default-browser-check --hide-scrollbars "--user-data-dir=$profile" --virtual-time-budget=12000 --dump-dom $url 2>&1 | Out-String
        if ($output -notmatch 'data-result="passed"') {
            $summary = [regex]::Match($output, '<pre id="result">([\s\S]*?)</pre>').Groups[1].Value
            if (-not $summary) { $summary = $output.Substring(0, [Math]::Min(1000, $output.Length)) }
            throw "Browser checks failed at $($size[0])x$($size[1]): $summary"
        }
        Write-Output "Light workspace browser checks passed at $($size[0])x$($size[1])."
    }
} finally {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
    $resolved = [IO.Path]::GetFullPath($profile)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath($tempRoot), [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'scholarflow-browser-tests-*') { throw 'Unsafe browser test cleanup path.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'Light workspace checks passed; original demo, Figma v1 and recovery branches are preserved.'
