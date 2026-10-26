$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$documentPath = Join-Path $repositoryRoot 'docs/WORKSPACE_PRODUCT_DISCUSSION.md'
$document = Get-Content -LiteralPath $documentPath -Raw -Encoding UTF8

# Validate decision provenance and scope/acceptance traceability, not UI implementation.
function Read-DiscussionRows([string]$text, [string]$prefix, [int]$width) {
    $rows = @{}
    foreach ($match in [regex]::Matches($text, ('(?m)^\| (' + $prefix + '\d{2}) \|[^\r\n]+'))) {
        $cells = @($match.Value.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        if ($cells.Count -ne $width -or @($cells | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
            throw "Incomplete $prefix row: $($cells[0])"
        }
        if ($rows.ContainsKey($cells[0])) { throw "Duplicate discussion ID: $($cells[0])" }
        $rows[$cells[0]] = $cells
    }
    if ($rows.Count -eq 0) { throw "Missing $prefix records" }
    return $rows
}

function Assert-Discussion([string]$text) {
    if (-not $text.Contains('用户已要求进入实现阶段；本次交付仅更新文档与相关测试，未修改业务代码。')) { throw 'Missing implementation handoff boundary' }
    if (-not $text.Contains('不将实施授权或文档检查当作功能完成。')) {
        throw 'Missing product/implementation status boundary'
    }
    if ($text.Contains([string][char]0xFFFD)) { throw 'Invalid text encoding' }
    if ($text -match '(?i)[A-Z]:[\\/]Users[\\/]') { throw 'Personal absolute path in shared discussion' }
    $decisions = Read-DiscussionRows $text 'D' 4
    $scenarios = Read-DiscussionRows $text 'R' 5
    $boundaries = Read-DiscussionRows $text 'B' 4
    $layers = Read-DiscussionRows $text 'L' 4
    $questions = Read-DiscussionRows $text 'Q' 3
    $checks = Read-DiscussionRows $text 'U' 5
    $sources = @{}
    foreach ($source in [regex]::Matches($text, '(?m)^- (S\d+)：')) { $sources[$source.Groups[1].Value] = $true }
    foreach ($id in $decisions.Keys) {
        $row = $decisions[$id]
        if ($row[1] -ne '已确认') { throw "Invalid decision status: $id" }
        $references = @([regex]::Matches($row[3], 'S\d+') | ForEach-Object { $_.Value })
        if ($references.Count -eq 0) { throw "Decision has no provenance: $id" }
        foreach ($reference in $references) {
            if (-not $sources.ContainsKey($reference)) { throw "Unknown decision source: $reference" }
        }
    }
    foreach ($id in $questions.Keys) {
        if ($questions[$id][1] -ne '待定') { throw "Unconfirmed detail was approved: $id" }
    }
    if ($boundaries['B01'][2] -ne '前端' -or $boundaries['B04'][2] -ne '前后端') {
        throw 'Layout and structured-context changes lost their distinct ownership'
    }
    foreach ($id in $layers.Keys) {
        if ($layers[$id][1] -ne '建议顺序，待实施') { throw "Implementation layer was promoted: $id" }
        $references = @([regex]::Matches($layers[$id][2], 'B\d{2}') | ForEach-Object { $_.Value })
        if ($references.Count -eq 0) { throw "Layer has no scope references: $id" }
        foreach ($reference in $references) {
            if (-not $boundaries.ContainsKey($reference)) { throw "Unknown scope reference: $reference" }
        }
    }
    $coveredScenarios = @{}
    $coveredDecisions = @{}
    foreach ($id in $checks.Keys) {
        $row = $checks[$id]
        if ($row[1] -ne '待实施验收') { throw "Unexecuted UI acceptance was promoted: $id" }
        $decisionReferences = @([regex]::Matches($row[2], 'D\d{2}') | ForEach-Object { $_.Value })
        $scenarioReferences = @([regex]::Matches($row[3], 'R\d{2}') | ForEach-Object { $_.Value })
        if ($decisionReferences.Count -eq 0 -or $scenarioReferences.Count -eq 0) { throw "Missing acceptance traceability: $id" }
        foreach ($reference in $decisionReferences) {
            if (-not $decisions.ContainsKey($reference)) { throw "Unknown acceptance decision: $reference" }
            $coveredDecisions[$reference] = $true
        }
        foreach ($reference in $scenarioReferences) {
            if (-not $scenarios.ContainsKey($reference)) { throw "Unknown acceptance scenario: $reference" }
            $coveredScenarios[$reference] = $true
        }
    }
    foreach ($id in $scenarios.Keys) {
        if (-not $coveredScenarios.ContainsKey($id)) { throw "Scenario has no acceptance coverage: $id" }
    }
    foreach ($id in $decisions.Keys) {
        if (-not $coveredDecisions.ContainsKey($id)) { throw "Decision has no acceptance coverage: $id" }
    }
}

function Assert-DiscussionLinks([string]$text) {
    foreach ($match in [regex]::Matches($text, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value
        if ($target -match '^(https?://|#)') { continue }
        $file = ($target -split '#', 2)[0]
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $repositoryRoot 'docs') $file))) {
            throw "Broken discussion link: $target"
        }
    }
}

function Assert-DiscussionNavigation([string]$readme, [string]$index, [string]$plan, [string]$discovery) {
    if (-not $readme.Contains('(docs/README.md)') -or -not $index.Contains('(WORKSPACE_PRODUCT_DISCUSSION.md)') -or -not $plan.Contains('(docs/WORKSPACE_PRODUCT_DISCUSSION.md)')) { throw 'Missing discussion entry point' }
    if (-not $index.Contains('./tests/workspace-product-docs.tests.ps1')) { throw 'Missing documented verification command' }
    if (-not $discovery.Contains('(WORKSPACE_PRODUCT_DISCUSSION.md)')) { throw 'Missing discovery handoff link' }
    foreach ($id in @('C19', 'C20')) {
        if ($discovery -notmatch ('(?m)^\| ' + $id + ' \|')) { throw "Missing confirmed discovery decision: $id" }
    }
}

Assert-Discussion $document
Assert-DiscussionLinks $document
$readme = Get-Content (Join-Path $repositoryRoot 'README.md') -Raw -Encoding UTF8
$index = Get-Content (Join-Path $repositoryRoot 'docs/README.md') -Raw -Encoding UTF8
$plan = Get-Content (Join-Path $repositoryRoot 'PLAN.md') -Raw -Encoding UTF8
$discovery = Get-Content (Join-Path $repositoryRoot 'docs/DISCOVERY.md') -Raw -Encoding UTF8
Assert-DiscussionNavigation $readme $index $plan $discovery

function Assert-Rejected([scriptblock]$action, [string]$expected) {
    $caught = $null
    try { & $action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $expected) { throw "Negative case did not reject as expected: $expected" }
}

Assert-Rejected { Assert-Discussion ($document.Replace('用户已要求进入实现阶段；本次交付仅更新文档与相关测试，未修改业务代码。', '本轮授权业务开发。')) } 'implementation handoff boundary'
Assert-Rejected { Assert-Discussion ($document.Replace('不将实施授权或文档检查当作功能完成。', '界面已实现。')) } 'implementation status boundary'
Assert-Rejected { Assert-Discussion ($document + "`n| D01 | 已确认 | duplicate | S1 |") } 'Duplicate discussion ID'
Assert-Rejected { Assert-Discussion ($document.Replace('| S1、S2 |', '| S99 |')) } 'Unknown decision source'
Assert-Rejected { Assert-Discussion ($document.Replace('| S1、S2 |', '| 未说明 |')) } 'no provenance'
Assert-Rejected { Assert-Discussion ($document.Replace('| Q01 | 待定 |', '| Q01 | 已确认 |')) } 'Unconfirmed detail was approved'
Assert-Rejected { Assert-Discussion ($document.Replace('| 前后端 |', '| 前端 |')) } 'distinct ownership'
Assert-Rejected { Assert-Discussion ($document.Replace('| L01 | 建议顺序，待实施 |', '| L01 | 已完成 |')) } 'Implementation layer was promoted'
Assert-Rejected { Assert-Discussion ($document.Replace('先完成 B01', '先完成 B99')) } 'Unknown scope reference'
Assert-Rejected { Assert-Discussion ($document.Replace('| U01 | 待实施验收 |', '| U01 | 已通过 |')) } 'Unexecuted UI acceptance was promoted'
Assert-Rejected { Assert-Discussion ($document.Replace('| D01、D05 |', '| D99 |')) } 'Unknown acceptance decision'
Assert-Rejected { Assert-Discussion ($document.Replace('| R01、R03、R05 |', '| R99 |')) } 'Unknown acceptance scenario'
Assert-Rejected { Assert-Discussion ($document.Replace('| R01、R03、R05 |', '| 未分类 |')) } 'Missing acceptance traceability'
Assert-Rejected { Assert-Discussion ($document.Replace('R02、R03、R04、R05、R06', 'R02、R03、R04、R05').Replace('R02、R05、R06', 'R02、R05')) } 'Scenario has no acceptance coverage'
Assert-Rejected { Assert-DiscussionLinks '[missing](missing-workspace-discussion-file.md)' } 'Broken discussion link'
Assert-Rejected { Assert-DiscussionNavigation ($readme.Replace('(docs/README.md)', '(missing.md)')) $index $plan $discovery } 'Missing discussion entry point'
Assert-Rejected { Assert-DiscussionNavigation $readme ($index.Replace('(WORKSPACE_PRODUCT_DISCUSSION.md)', '(missing.md)')) $plan $discovery } 'Missing discussion entry point'
Assert-Rejected { Assert-DiscussionNavigation $readme $index $plan ($discovery.Replace('| C19 |', '| 历史决定 |')) } 'Missing confirmed discovery decision'
Assert-Rejected { Assert-Discussion ($document + [char]0xFFFD) } 'Invalid text encoding'
Write-Output 'Workspace product discussion: decision provenance, scope ownership, scenario/acceptance coverage, links and 19 negative cases passed. Documentation contracts only; runtime results are recorded separately.'
