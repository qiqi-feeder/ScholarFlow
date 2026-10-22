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
    if (-not $section.Contains('授权边界：W00 只做基线、文档与测试夹具，不实施业务功能。') -and
        -not $section.Contains('授权边界：本次只更新计划及文档校验，不实施功能代码。')) {
        throw 'Workspace plan lost documentation-only authorization'
    }
    $w01Complete = $section.Contains('W01 外壳与任务级模型已完成（WT02、WT03、WT16 通过）')
    $w01Rejected = $section.Contains('W01 验收未通过，待修复复验（WT03、WT16 不通过；WT02 待完整复验）')
    if ($w01Rejected -and $w01Complete) { throw 'Conflicting W01 acceptance status' }
    $baselineComplete = $w01Rejected -or $w01Complete -or $section.Contains('状态：W00 基线已完成（WT01 通过）；W01–W05 功能与 WT02–WT19 验收待实施。')
    if (-not $baselineComplete -and -not $section.Contains('状态：待实施；本轮功能与 WT 验收均未执行。')) {
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
    $implementedChecks = @{}
    foreach ($id in $milestones.Keys) {
        $row = $milestones[$id]
        if ($id -eq 'W00' -and $baselineComplete) {
            if ($row[5] -notmatch '^已完成：' -or -not $row[5].Contains('WT01')) {
                throw 'Workspace baseline lacks completion evidence'
            }
        } elseif ($id -eq 'W01' -and $w01Rejected) {
            if ($row[5] -notmatch '^验收未通过：' -or -not $row[5].Contains('W01-review-issues.md')) {
                throw 'Rejected W01 milestone lost issue evidence'
            }
        } elseif ($id -eq 'W01' -and $w01Complete) {
            if ($row[5] -notmatch '^已完成：' -or -not $row[5].Contains('WT02') -or
                -not $row[5].Contains('WT03') -or -not $row[5].Contains('WT16')) {
                throw 'Workspace shell milestone lacks completion evidence'
            }
        } elseif ($id -match '^W0[2-5]$' -and $row[5] -match '^已完成：') {
            if ($row[5] -notmatch '\[.+?\]\((docs/verification/workspace-redesign/[^)]+\.md)\)') { throw 'Completed workspace milestone lacks evidence' }
            if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $Matches[1]))) { throw 'Completed workspace milestone has missing evidence' }
            foreach ($check in [regex]::Matches($row[4], 'WT\d+')) { $implementedChecks[$check.Value] = $id }
        } elseif ($row[5] -ne '待实施') { throw "Workspace milestone is not pending: $id" }
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
        if ($id -eq 'WT01' -and $baselineComplete) {
            if ($row[6] -notmatch '^通过：W00 基线') { throw 'Workspace baseline acceptance lacks evidence' }
        } elseif ($w01Rejected -and @('WT02', 'WT03', 'WT16') -contains $id) {
            $expectedStatus = if ($id -eq 'WT02') { '^待复验：' } else { '^不通过：' }
            if ($row[6] -notmatch $expectedStatus -or -not $row[6].Contains('W01-review-issues.md')) {
                throw 'Rejected W01 acceptance was promoted or lost issue evidence'
            }
        } elseif ($w01Complete -and @('WT02', 'WT03', 'WT16') -contains $id) {
            if ($row[6] -notmatch '^通过：W01 ') { throw 'Workspace shell acceptance lacks evidence' }
        } elseif ($implementedChecks.ContainsKey($id)) {
            if ($row[6] -notmatch ('^通过：' + $implementedChecks[$id] + ' ')) { throw 'Completed workspace acceptance lacks evidence' }
        } elseif ($row[6] -ne '未执行') { throw "Workspace acceptance was promoted: $id" }
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

function Assert-StitchHandoff([string]$text) {
    $section = [regex]::Match($text, '(?ms)^### 8\.7 Stitch 原稿与实现修正清单.*\z').Value
    if (-not $section -or -not $section.Contains('视觉以 Stitch 原稿为准，不采用最后一轮改乱后的变体。') -or
        -not $text.Contains('不再以等待用户提供新原型或继续修改 Stitch 为前置条件')) {
        throw 'Missing accepted Stitch baseline or implementation readiness'
    }
    $sources = Read-PlanRows $section 'SB' 5
    $excluded = Read-PlanRows $section 'EX' 3
    $issues = Read-PlanRows $section 'UI' 7
    $milestones = Read-PlanRows $text 'W' 6
    $checks = Read-PlanRows $text 'WT' 7
    $baselineIds = @('8fc29cdfbd134d8a8b65083f5989b934', 'a9cc6868af11461c8e2919a8c75bddcd',
        'fefc530a924645208f8feba7d63543d4', 'b0e0ed0532684c0bba4da8c0d5138551',
        '3ee648ba087b4d4cb383285c38f7be92', '0946e12b728e4bf1a9c2ee816fc3d5ba', '8f1f08dcd38d4a0da68b218aec38b00c')
    $excludedIds = @('ab6b71c263744d298bcc758c94c70751', 'c779435d514a49a5bff06f8e97ef6497',
        '58b36ec27552416996cc8065959ea116', 'f29c34379d87493dbac7a329e97efd5f')
    if ($sources.Count -ne 7 -or $excluded.Count -ne 4 -or $issues.Count -ne 9) { throw 'Incomplete Stitch handoff inventory' }
    foreach ($index in 0..6) {
        $id = 'SB{0:D2}' -f ($index + 1)
        $expected = 'projects/251310333590789772/screens/' + $baselineIds[$index]
        if (-not $sources.ContainsKey($id) -or $sources[$id][2].Trim('`') -ne $expected) {
            throw 'Wrong Stitch baseline resource'
        }
        $role = if ($index -lt 5) { '视觉原稿' } else { '辅助状态参考' }
        if ($sources[$id][4] -ne $role) { throw 'Wrong Stitch baseline role' }
        if ($sources[$id][3].Trim('`') -notmatch '^projects/251310333590789772/(files/\d+|screens/[a-f0-9]{32}/fileEntries/screenshot)$') {
            throw 'Invalid Stitch screenshot resource'
        }
    }
    foreach ($index in 0..3) {
        $id = 'EX{0:D2}' -f ($index + 1)
        if (-not $excluded.ContainsKey($id) -or
            $excluded[$id][2].Trim('`') -ne ('projects/251310333590789772/screens/' + $excludedIds[$index])) {
            throw 'Wrong rejected Stitch variant'
        }
    }
    foreach ($number in 1..9) {
        $id = 'UI{0:D2}' -f $number
        if (-not $issues.ContainsKey($id)) { throw 'Missing UI correction' }
        $row = $issues[$id]
        if ($id -eq 'UI09' -and $milestones['W00'][5] -match '^已完成：') {
            if ($row[6] -notmatch '^已完成：W00 保存 SB01–SB07/EX01–EX04' -or
                $milestones['W00'][5] -notmatch '^已完成：') { throw 'UI baseline completion lacks evidence' }
        } elseif ($row[6] -ne '待实施') { throw 'UI correction falsely closed' }
        $nodes = @([regex]::Matches($row[4], 'W\d{2}') | ForEach-Object { $_.Value })
        $tests = @([regex]::Matches($row[5], 'WT\d{2}') | ForEach-Object { $_.Value })
        if ($nodes.Count -eq 0 -or $tests.Count -eq 0) { throw 'UI correction missing execution traceability' }
        $assigned = @{}
        foreach ($node in $nodes) {
            if (-not $milestones.ContainsKey($node)) { throw 'UI correction references unknown milestone' }
            foreach ($test in [regex]::Matches($milestones[$node][4], 'WT\d{2}')) { $assigned[$test.Value] = $true }
        }
        foreach ($test in $tests) {
            if (-not $checks.ContainsKey($test)) { throw 'UI correction references unknown test' }
            if (-not $assigned.ContainsKey($test)) { throw 'UI correction test not assigned to its milestones' }
        }
    }
    foreach ($number in 17..19) {
        if (-not $checks.ContainsKey(('WT{0:D2}' -f $number))) { throw 'Missing prototype correction test' }
    }
}

Assert-PlanGraph $plan
Assert-PlanLinks $plan
Assert-WorkspaceIteration $plan $workspaceDiscussion
Assert-StitchHandoff $plan
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
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('授权边界：W00 只做基线、文档与测试夹具，不实施业务功能。', '授权立即实施。').Replace('授权边界：本次只更新计划及文档校验，不实施功能代码。', '授权立即实施。')) $workspaceDiscussion } 'documentation-only authorization'
Assert-Rejected { Assert-WorkspaceIteration ([regex]::Replace($plan, '(?m)^状态：W00 基线已完成[^\r\n]+', '状态：已完成。')) $workspaceDiscussion } 'unimplemented status'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('不顺带扩大 Agent 写权限', '允许任意写权限')) $workspaceDiscussion } 'permission boundary'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('本轮不能标全部完成', '所有情况均可完成')) $workspaceDiscussion } 'completion evidence boundary'
Assert-Rejected { Assert-WorkspaceIteration ($plan + "`n| W00 | 无 | duplicate | Web | WT01 | 待实施 |") $workspaceDiscussion } 'Duplicate W ID'
Assert-Rejected { Assert-WorkspaceIteration ($plan + "`n| WT01 | 单测 | U01 | positive | negative | evidence | 未执行 |") $workspaceDiscussion } 'Duplicate WT ID'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| W01 | W00 |', '| W01 | W99 |')) $workspaceDiscussion } 'Unknown workspace dependency'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| W01 | W00 |', '| W01 | W02 |')) $workspaceDiscussion } 'Cyclic workspace dependencies'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| WT01 | 基线/兼容 |', '| WT99 | 基线/兼容 |')) $workspaceDiscussion } 'Unknown workspace test'
Assert-Rejected { Assert-WorkspaceIteration ($plan + "`n| WT99 | 单测 | U01 | positive | negative | evidence | 未执行 |") $workspaceDiscussion } 'Unassigned workspace test'
Assert-Rejected { Assert-WorkspaceIteration ([regex]::Replace($plan, '(?m)^(\| W02 \|[^\r\n]*\|) [^|]+\|(?=\r?$)', '$1 已完成 |')) $workspaceDiscussion } 'Workspace milestone is not pending'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 未执行 |', '| 已通过 |')) $workspaceDiscussion } 'Workspace acceptance was promoted'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| U07 |', '| U99 |')) $workspaceDiscussion } 'Unknown workspace product requirement'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| U07 |', '| U02 |').Replace('、U07', '')) $workspaceDiscussion } 'Product requirement has no workspace tests'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| U07 |', '| 无 |')) $workspaceDiscussion } 'lacks product traceability'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 内容遮挡确认/取消按钮、会话无法展开、对照区水平溢出 |', '| |')) $workspaceDiscussion } 'Incomplete WT row'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('不再以等待用户提供新原型或继续修改 Stitch 为前置条件', '等待新一轮原型')) } 'implementation readiness'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| SB07 |', '| SB99 |')) } 'Wrong Stitch baseline resource'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('8fc29cdfbd134d8a8b65083f5989b934', 'ab6b71c263744d298bcc758c94c70751')) } 'Wrong Stitch baseline resource'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| 辅助状态参考 |', '| 视觉原稿 |')) } 'Wrong Stitch baseline role'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('f29c34379d87493dbac7a329e97efd5f', '00000000000000000000000000000000')) } 'Wrong rejected Stitch variant'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| UI09 |', '| UI99 |')) } 'Missing UI correction'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| WT13、WT16、WT19 | 待实施 |', '| WT13、WT16、WT19 | 已完成 |')) } 'UI correction falsely closed'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| W01 | WT03 | 待实施 |', '| W99 | WT03 | 待实施 |')) } 'unknown milestone'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| W01 | WT03 | 待实施 |', '| W01 | WT99 | 待实施 |')) } 'unknown test'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| W01 | WT03 | 待实施 |', '| W01 | WT01 | 待实施 |')) } 'not assigned to its milestones'
Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| W01 | WT03 | 待实施 |', '| W01 | 无 | 待实施 |')) } 'missing execution traceability'
if ($plan.Contains('状态：W00 基线已完成（WT01 通过）')) {
    Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| WT01 | 已完成：', '| WT01 | 待实施：')) $workspaceDiscussion } 'baseline lacks completion evidence'
    Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 通过：W00 基线', '| 待核对：W00 基线')) $workspaceDiscussion } 'baseline acceptance lacks evidence'
    Assert-Rejected { Assert-StitchHandoff ($plan.Replace('| 已完成：W00 保存 SB01–SB07/EX01–EX04', '| 待实施：W00 保存 SB01–SB07/EX01–EX04')) } 'UI baseline completion lacks evidence'
}

Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 已完成：WT02、WT03、WT16', '| 待实施：WT02、WT03、WT16')) $workspaceDiscussion } 'shell milestone lacks completion evidence'
Assert-Rejected { Assert-WorkspaceIteration ($plan.Replace('| 通过：W01 两项目', '| 未执行：W01 两项目')) $workspaceDiscussion } 'shell acceptance lacks evidence'

# A documentation-only change may be committed separately from a W00 evidence update.
# Validate the original pending baseline as well as an evidenced completed baseline.
$pendingPlan = $plan.Replace('状态：W00 基线已完成（WT01 通过）；W01–W05 功能与 WT02–WT19 验收待实施。', '状态：待实施；本轮功能与 WT 验收均未执行。')
$pendingPlan = $pendingPlan.Replace('状态：W00 基线已完成（WT01 通过）；W01 外壳与任务级模型已完成（WT02、WT03、WT16 通过）；W02–W05 与 WT04–WT15、WT17–WT19 待实施。', '状态：待实施；本轮功能与 WT 验收均未执行。')
$pendingPlan = $pendingPlan.Replace('状态：W00 基线已完成（WT01 通过）；W01 验收未通过，待修复复验（WT03、WT16 不通过；WT02 待完整复验）；W02–W05 与其余 WT 待实施。', '状态：待实施；本轮功能与 WT 验收均未执行。')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| W00 \|[^\r\n]*\|) 已完成：[^\r\n]+(?=\r?$)', '$1 待实施 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| W01 \|[^\r\n]*\|) (?:已完成|验收未通过)：[^\r\n]+(?=\r?$)', '$1 待实施 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| WT01 \|[^\r\n]*\|) 通过：[^\r\n]+(?=\r?$)', '$1 未执行 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| WT02 \|[^\r\n]*\|) (?:通过|不通过|待复验)：[^\r\n]+(?=\r?$)', '$1 未执行 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| WT03 \|[^\r\n]*\|) (?:通过|不通过|待复验)：[^\r\n]+(?=\r?$)', '$1 未执行 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| WT16 \|[^\r\n]*\|) (?:通过|不通过|待复验)：[^\r\n]+(?=\r?$)', '$1 未执行 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| UI09 \|[^\r\n]*\|) 已完成：[^\r\n]+(?=\r?$)', '$1 待实施 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^状态：W00 基线已完成[^\r\n]+', '状态：待实施；本轮功能与 WT 验收均未执行。')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| W0[2-5] \|[^\r\n]*\|) 已完成：[^\r\n]+(?=\r?$)', '$1 待实施 |')
$pendingPlan = [regex]::Replace($pendingPlan, '(?m)^(\| WT\d+ \|[^\r\n]*\|) 通过：[^\r\n]+(?=\r?$)', '$1 未执行 |')
Assert-WorkspaceIteration $pendingPlan $workspaceDiscussion
Assert-StitchHandoff $pendingPlan
Write-Output "MVP/workspace plan structure: dependency graphs, product/test traceability, baseline status, authorization, links and $negativeCaseCount negative cases passed. Functional results are recorded separately; W02-W05 remain unexecuted."
