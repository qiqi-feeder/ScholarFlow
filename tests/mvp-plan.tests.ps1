$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$plan = Get-Content (Join-Path $repositoryRoot 'PLAN.md') -Raw -Encoding UTF8

# Validate scheduling and acceptance traceability, not keyword counts or business behavior.
function Read-PlanRows([string]$text, [string]$prefix, [int]$width) {
    $rows = @{}
    foreach ($match in [regex]::Matches($text, ('(?m)^\| (' + $prefix + '\d+) \|[^\r\n]+'))) {
        $cells = @($match.Value.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        if ($cells.Count -ne $width -or @($cells | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
            throw "Incomplete $prefix row: $($cells[0])"
        }
        if ($rows.ContainsKey($cells[0])) { throw "Duplicate $prefix ID: $($cells[0])" }
        $rows[$cells[0]] = $cells
    }
    if ($rows.Count -eq 0) { throw "Missing $prefix rows" }
    return $rows
}

function Assert-PlanGraph([string]$text) {
    $milestones = Read-PlanRows $text 'M' 5
    $checks = Read-PlanRows $text 'V' 5
    $dependencies = @{}
    $usedChecks = @{}
    foreach ($id in $milestones.Keys) {
        $row = $milestones[$id]
        if ($row[4] -notin @('待实施', '进行中', '已完成')) { throw "Unknown milestone status: $id" }
        $deps = @([regex]::Matches($row[1], 'M\d+') | ForEach-Object { $_.Value })
        if ($row[1] -ne '无' -and $deps.Count -eq 0) { throw "Invalid milestone dependency: $id" }
        foreach ($dep in $deps) {
            if (-not $milestones.ContainsKey($dep)) { throw "Unknown milestone dependency: $dep" }
        }
        $dependencies[$id] = $deps
        $refs = @([regex]::Matches($row[3], 'V\d+') | ForEach-Object { $_.Value })
        if ($refs.Count -eq 0) { throw "Milestone has no acceptance checks: $id" }
        foreach ($ref in $refs) {
            if (-not $checks.ContainsKey($ref)) { throw "Unknown acceptance check: $ref" }
            $usedChecks[$ref] = $true
        }
    }
    foreach ($id in $checks.Keys) {
        if (-not $usedChecks.ContainsKey($id)) { throw "Unassigned acceptance check: $id" }
    }
    $done = @{}
    while ($done.Count -lt $milestones.Count) {
        $progress = $false
        foreach ($id in $milestones.Keys) {
            if ($done.ContainsKey($id)) { continue }
            $unmet = @($dependencies[$id] | Where-Object { -not $done.ContainsKey($_) })
            if ($unmet.Count -eq 0) { $done[$id] = $true; $progress = $true }
        }
        if (-not $progress) { throw 'Cyclic milestone dependencies' }
    }
}

function Assert-PlanLinks([string]$text) {
    foreach ($match in [regex]::Matches($text, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value
        if ($target -match '^(https?://|#)') { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot ($target -split '#', 2)[0]))) {
            throw "Broken plan link: $target"
        }
    }
}

Assert-PlanGraph $plan
Assert-PlanLinks $plan
if ($plan.Contains([string][char]0xFFFD)) { throw 'Invalid plan encoding' }

function Assert-Rejected([scriptblock]$action, [string]$expected) {
    $caught = $null
    try { & $action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $expected) { throw "Negative case failed: $expected" }
}
Assert-Rejected { Assert-PlanGraph ($plan + "`n| M0 | 无 | duplicate | V01 | 待实施 |") } 'Duplicate M ID'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 集成 |', '| V02 | 集成 |')) } 'Duplicate V ID'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| M1 | M0 |', '| M1 | M99 |')) } 'Unknown milestone dependency'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| M1 | M0 |', '| M1 | M2 |')) } 'Cyclic milestone dependencies'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 待实施 |', '| V99 | 待实施 |')) } 'Unknown acceptance check'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('V13、V15、V16', 'V13、V15')) } 'Unassigned acceptance check'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 待实施 |', '| 无 | 待实施 |')) } 'Milestone has no acceptance checks'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| M0 | 无 |', '| M0 | |')) } 'Incomplete M row'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 集成 |', '| V01 | |')) } 'Incomplete V row'
Assert-Rejected { Assert-PlanLinks '[missing](no-such-mvp-plan-file.md)' } 'Broken plan link'
Write-Output 'MVP plan: milestone dependency graph, acceptance coverage, links and 10 negative cases passed. Documentation only; V01-V16 were not executed.'
