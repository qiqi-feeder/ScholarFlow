$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$plan = Get-Content (Join-Path $repositoryRoot 'PLAN.md') -Raw -Encoding UTF8
$workspaceDiscussion = Get-Content (Join-Path $repositoryRoot 'docs/WORKSPACE_PRODUCT_DISCUSSION.md') -Raw -Encoding UTF8
$negativeCaseCount = 0

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
    $checks = Read-PlanRows $text 'V' 6
    $dependencies = @{}
    $usedChecks = @{}
    foreach ($id in $milestones.Keys) {
        $row = $milestones[$id]
        if ($row[4] -notmatch '^(待实施|进行中|已完成|部分完成|未执行)(：.*)?$') { throw "Unknown milestone status: $id" }
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

function Assert-WorkspaceIteration([string]$text, [string]$discussion) {
    $section = [regex]::Match($text, '(?ms)^## 8\. 本轮工作台改版实施计划.*\z').Value
    if (-not $section) { throw 'Missing workspace iteration plan' }
    if (-not $section.Contains('授权边界：本次只更新计划及文档校验，不实施功能代码。')) {
        throw 'Workspace plan lost documentation-only authorization'
    }
    if (-not $section.Contains('状态：待实施；本轮功能与 WT 验收均未执行。')) {
        throw 'Workspace plan lost its unimplemented status'
    }
    if (-not $section.Contains('不通过新界面绕过后端约束') -or -not $section.Contains('不顺带扩大 Agent 写权限')) {
        throw 'Workspace plan lost its permission boundary'
    }
    if (-not $section.Contains('本轮不能标全部完成') -or -not $section.Contains('不把 V09/V13/V15/V16 自动改为通过')) {
        throw 'Workspace plan lost its completion evidence boundary'
    }

    $milestones = Read-PlanRows $section 'W' 6
    $checks = Read-PlanRows $section 'WT' 7
    $productChecks = Read-PlanRows $discussion 'U' 5
    $dependencies = @{}
    $usedChecks = @{}
    $coveredProduct = @{}
    foreach ($id in $milestones.Keys) {
        $row = $milestones[$id]
        if ($row[5] -ne '待实施') { throw "Workspace milestone is not pending: $id" }
        $deps = @([regex]::Matches($row[1], 'W\d+') | ForEach-Object { $_.Value })
        if ($row[1] -ne '无' -and $deps.Count -eq 0) { throw "Invalid workspace dependency: $id" }
        foreach ($dep in $deps) {
            if (-not $milestones.ContainsKey($dep)) { throw "Unknown workspace dependency: $dep" }
        }
        $dependencies[$id] = $deps
        $references = @([regex]::Matches($row[4], 'WT\d+') | ForEach-Object { $_.Value })
        if ($references.Count -eq 0) { throw "Workspace milestone has no tests: $id" }
        foreach ($reference in $references) {
            if (-not $checks.ContainsKey($reference)) { throw "Unknown workspace test: $reference" }
            $usedChecks[$reference] = $true
        }
    }
    foreach ($id in $checks.Keys) {
        $row = $checks[$id]
        if ($row[6] -ne '未执行') { throw "Workspace acceptance was promoted: $id" }
        if (-not $usedChecks.ContainsKey($id)) { throw "Unassigned workspace test: $id" }
        $references = @([regex]::Matches($row[2], 'U\d+') | ForEach-Object { $_.Value })
        if ($references.Count -eq 0) { throw "Workspace test lacks product traceability: $id" }
        foreach ($reference in $references) {
            if (-not $productChecks.ContainsKey($reference)) { throw "Unknown workspace product requirement: $reference" }
            $coveredProduct[$reference] = $true
        }
    }
    foreach ($id in $productChecks.Keys) {
        if (-not $coveredProduct.ContainsKey($id)) { throw "Product requirement has no workspace tests: $id" }
    }
    $done = @{}
    while ($done.Count -lt $milestones.Count) {
        $progress = $false
        foreach ($id in $milestones.Keys) {
            if ($done.ContainsKey($id)) { continue }
            $unmet = @($dependencies[$id] | Where-Object { -not $done.ContainsKey($_) })
            if ($unmet.Count -eq 0) { $done[$id] = $true; $progress = $true }
        }
        if (-not $progress) { throw 'Cyclic workspace dependencies' }
    }
}

Assert-PlanGraph $plan
Assert-PlanLinks $plan
Assert-WorkspaceIteration $plan $workspaceDiscussion
if ($plan.Contains([string][char]0xFFFD)) { throw 'Invalid plan encoding' }

function Assert-Rejected([scriptblock]$action, [string]$expected) {
    $caught = $null
    try { & $action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $expected) { throw "Negative case failed: $expected" }
    $script:negativeCaseCount += 1
}
Assert-Rejected { Assert-PlanGraph ($plan + "`n| M0 | 无 | duplicate | V01 | 待实施 |") } 'Duplicate M ID'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 集成 |', '| V02 | 集成 |')) } 'Duplicate V ID'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| M1 | M0 |', '| M1 | M99 |')) } 'Unknown milestone dependency'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| M1 | M0 |', '| M1 | M2 |')) } 'Cyclic milestone dependencies'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 集成 |', '| V99 | 集成 |')) } 'Unknown acceptance check'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('V13、V15、V16', 'V13、V15')) } 'Unassigned acceptance check'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 部分完成：软件锁定完成；真实任务卡阻塞 |', '| 无 | 部分完成：软件锁定完成；真实任务卡阻塞 |')) } 'Milestone has no acceptance checks'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| 部分完成：软件锁定完成；真实任务卡阻塞 |', '| 未知 |')) } 'Unknown milestone status'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| M0 | 无 |', '| M0 | |')) } 'Incomplete M row'
Assert-Rejected { Assert-PlanGraph ($plan.Replace('| V01 | 集成 |', '| V01 | |')) } 'Incomplete V row'
Assert-Rejected { Assert-PlanLinks '[missing](no-such-mvp-plan-file.md)' } 'Broken plan link'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('## 8. 本轮工作台改版实施计划', '## 8. 无本轮计划')) $workspaceDiscussion } 'Missing workspace iteration plan'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('授权边界：本次只更新计划及文档校验，不实施功能代码。', '授权立即实施。')) $workspaceDiscussion } 'documentation-only authorization'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('状态：待实施；本轮功能与 WT 验收均未执行。', '状态：已完成。')) $workspaceDiscussion } 'unimplemented status'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('不顺带扩大 Agent 写权限', '允许任意写权限')) $workspaceDiscussion } 'permission boundary'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('本轮不能标全部完成', '所有情况均可完成')) $workspaceDiscussion } 'completion evidence boundary'
Assert-Rejected { Assert-WorkspaceIteration ($plan + "`n| W00 | 无 | duplicate | Web | WT01 | 待实施 |") $workspaceDiscussion } 'Duplicate W ID'
Assert-Rejected { Assert-WorkspaceIteration ($plan + "`n| WT01 | 单测 | U01 | positive | negative | evidence | 未执行 |") $workspaceDiscussion } 'Duplicate WT ID'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| W01 | W00 |', '| W01 | W99 |')) $workspaceDiscussion } 'Unknown workspace dependency'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| W01 | W00 |', '| W01 | W02 |')) $workspaceDiscussion } 'Cyclic workspace dependencies'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| WT01 | 基线/兼容 |', '| WT99 | 基线/兼容 |')) $workspaceDiscussion } 'Unknown workspace test'
Assert-Rejected { Assert-WorkspaceIteration ($plan + "`n| WT99 | 单测 | U01 | positive | negative | evidence | 未执行 |") $workspaceDiscussion } 'Unassigned workspace test'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| WT01 | 待实施 |', '| WT01 | 已完成 |')) $workspaceDiscussion } 'Workspace milestone is not pending'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 未执行 |', '| 已通过 |')) $workspaceDiscussion } 'Workspace acceptance was promoted'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| U07 |', '| U99 |')) $workspaceDiscussion } 'Unknown workspace product requirement'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| U07 |', '| U02 |').Replace('、U07', '')) $workspaceDiscussion } 'Product requirement has no workspace tests'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| U07 |', '| 无 |')) $workspaceDiscussion } 'lacks product traceability'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 内容遮挡确认/取消按钮、会话无法展开、对照区水平溢出 |', '| |')) $workspaceDiscussion } 'Incomplete WT row'
Write-Output "MVP/workspace plans: dependency graphs, product/test traceability, authorization, links and $negativeCaseCount negative cases passed. Documentation only; workspace WT tests remain unexecuted."
