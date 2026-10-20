$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$discovery = Get-Content (Join-Path $root 'docs/DISCOVERY.md') -Raw -Encoding UTF8

# Check navigation and decision provenance without fixing any candidate architecture.
function Assert-Discovery([string]$text) {
    foreach ($heading in @('已确认需求', '候选方案', '待确认问题', '已否决方案')) {
        if ($text -notmatch ('(?m)^## .*' + [regex]::Escape($heading))) {
            throw "Missing decision category: $heading"
        }
    }
    $ids = @{}
    foreach ($match in [regex]::Matches($text, '(?m)^\| ((?:C|P|Q)\d{2})(?: / [^|]+)? \|')) {
        $id = $match.Groups[1].Value
        if ($ids.ContainsKey($id)) { throw "Duplicate decision ID: $id" }
        $ids[$id] = $true
    }
    if ($ids.Count -eq 0) { throw 'No traceable decision records.' }
    if ($text.Contains([string][char]0xFFFD)) { throw 'Invalid text encoding.' }
    if ($text -match '(?i)[A-Z]:[\\/]Users[\\/]') { throw 'Personal absolute path in shared discovery.' }
}

function Assert-LocalLinks([string]$text, [string]$directory) {
    foreach ($match in [regex]::Matches($text, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value
        if ($target -match '^(https?://|#)') { continue }
        $target = ($target -split '#', 2)[0]
        if (-not (Test-Path -LiteralPath (Join-Path $directory $target))) {
            throw "Broken local link: $target"
        }
    }
}

Assert-Discovery $discovery
Assert-LocalLinks $discovery (Join-Path $root 'docs')

foreach ($name in @('PRODUCT_DESIGN.md', 'TECHNICAL_DESIGN.md', 'IMPLEMENTATION_ROADMAP.md')) {
    $text = Get-Content (Join-Path $root ('docs/' + $name)) -Raw -Encoding UTF8
    if (-not $text.Contains('历史方案，待重新确认') -or -not $text.Contains('[DISCOVERY](DISCOVERY.md)')) {
        throw "Historical design is missing its current-status pointer: $name"
    }
}
$readme = Get-Content (Join-Path $root 'README.md') -Raw -Encoding UTF8
if (-not $readme.Contains('[DISCOVERY](docs/DISCOVERY.md)')) { throw 'README must link to discovery.' }
# Scope this guard to the explicitly recorded phase, so an authorized transition can update it.
if ($discovery.Contains('阶段：需求探索。')) {
    foreach ($name in @('PLAN.md', 'docs/PLAN.md')) {
        if (Test-Path (Join-Path $root $name)) { throw "Implementation plan exists during discovery: $name" }
    }
}

# Negative cases ensure the checks detect lost categories, duplicate IDs and broken references.
function Assert-Rejected([scriptblock]$action, [string]$expected) {
    $caught = $null
    try { & $action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $expected) { throw "Negative case did not reject as expected: $expected" }
}
Assert-Rejected { Assert-Discovery ($discovery.Replace('## 3. 候选方案', '## 3. 未分类')) } 'Missing decision category'
Assert-Rejected { Assert-Discovery ($discovery + "`n| C01 | duplicate | invalid |") } 'Duplicate decision ID'
Assert-Rejected { Assert-LocalLinks '[missing](no-such-discovery-file.md)' (Join-Path $root 'docs') } 'Broken local link'
Assert-Rejected { Assert-Discovery ($discovery + [char]0xFFFD) } 'Invalid text encoding'
Write-Output 'Discovery categories, provenance IDs, links, historical pointers and 4 negative cases passed (documentation only).'
