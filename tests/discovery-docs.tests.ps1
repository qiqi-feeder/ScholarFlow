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

# A proposed workflow must retain its decision status and distinguish provenance.
function Assert-ReproductionProposal([string]$text) {
    $section = [regex]::Match($text, '(?s)### 3\.3 论文复现的职责划分\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if (-not $section.Contains('候选方案，尚未确认')) { throw 'Reproduction proposal lost its unconfirmed status.' }
    foreach ($mode in @('作者代码复现', '独立实现')) {
        if ($section -notmatch ('(?m)^\| ' + $mode + ' \|')) { throw "Missing reproduction provenance mode: $mode" }
    }
}
Assert-ReproductionProposal $discovery

# Keep confirmed task scope separate from the still-proposed implementation.
function Assert-ReproductionScope([string]$text) {
    $section = [regex]::Match($text, '(?s)### 3\.4 初期复现范围与材料准入\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if ($section -notmatch '状态：已确认需求（C08–C10') { throw 'Confirmed reproduction scope lost its decision status.' }
    foreach ($id in @('C08', 'C09', 'C10')) {
        if ($text -notmatch ('(?m)^\| ' + $id + ' \|')) { throw "Missing confirmed scope record: $id" }
    }
    foreach ($entry in @('论文', '模型名称')) {
        if ($section -notmatch ('(?m)^\| ' + $entry + ' \|')) { throw "Missing reproduction input: $entry" }
    }
    foreach ($criterion in @('R01', 'R02', 'R03')) {
        $rows = [regex]::Matches($section, ('(?m)^\| ' + $criterion + ' \| [^|\r\n]+ \| [^|\r\n]+ \|\r?$'))
        if ($rows.Count -ne 1) { throw "Missing or duplicate admission criterion: $criterion" }
    }
    if ($section -notmatch '不静默猜参数、拼凑实验流程或转为独立实现') {
        throw 'Incomplete-material implementation deferral is missing.'
    }
}
Assert-ReproductionScope $discovery

# Product decisions must not silently approve the proposed harness mechanisms.
function Assert-WorkbenchDecisions([string]$text) {
    $section = [regex]::Match($text, '(?s)### 3\.5 产品形态与 Harness 贡献边界\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    foreach ($id in @('C11', 'C12', 'C13')) {
        if ($text -notmatch ('(?m)^\| ' + $id + ' \|')) { throw "Missing workbench decision: $id" }
    }
    if ($section -notmatch '(?m)^已确认（C11–C13）') { throw 'Workbench decisions lost their confirmed status.' }
    if ($section -notmatch '(?m)^以下均为助手提出的候选设计和验证方向，尚未确认，更不是已实现能力或可直接声称的简历业绩：') {
        throw 'Harness proposals are missing their implementation and approval boundary.'
    }
}
Assert-WorkbenchDecisions $discovery

# Full-lifecycle scope remains confirmed while UI and orchestration stay proposed.
function Assert-ProjectOrganization([string]$text) {
    if ($text -notmatch '(?m)^\| C03 \|') { throw 'Missing confirmed full-lifecycle record.' }
    $section = [regex]::Match($text, '(?s)### 3\.6 全流程工作台、协作与工作区组织\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if ($section -notmatch '(?m)^状态：候选产品组织，尚未确认') { throw 'Project organization lost its unconfirmed status.' }
    foreach ($boundary in @('项目工作区', '任务会话', '执行环境')) {
        if ($section -notmatch ('(?m)^\| ' + $boundary + ' \|')) { throw "Missing organization boundary: $boundary" }
    }
}
Assert-ProjectOrganization $discovery

# Preserve the difference between an integration proposal and implemented value.
function Assert-PiPositioning([string]$text) {
    $section = [regex]::Match($text, '(?s)### 3\.7 Pi 底座、第三方 Skill 与工作台价值\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if ($section -notmatch '(?m)^状态：候选定位解释，尚未确认') { throw 'Pi positioning lost its candidate status.' }
    if (-not $section.Contains('尚未实现本节能力')) { throw 'Pi positioning lost its implementation boundary.' }
    if (-not $section.Contains('格式可读不等于依赖已安装、权限已授予或执行已验证')) { throw 'Skill format and runtime compatibility boundary is missing.' }
}
Assert-PiPositioning $discovery

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
Assert-Rejected { Assert-ReproductionProposal ($discovery.Replace('候选方案，尚未确认', '已实施')) } 'lost its unconfirmed status'
Assert-Rejected { Assert-ReproductionProposal ($discovery.Replace('| 独立实现 |', '| 未分类 |')) } 'Missing reproduction provenance mode'
Assert-Rejected { Assert-ReproductionScope ($discovery.Replace('状态：已确认需求（C08–C10', '状态：候选范围（C08–C10')) } 'lost its decision status'
foreach ($id in @('C08', 'C09', 'C10')) {
    Assert-Rejected { Assert-ReproductionScope ($discovery.Replace("| $id |", '| 未登记 |')) } 'Missing confirmed scope record'
}
foreach ($entry in @('论文', '模型名称')) {
    Assert-Rejected { Assert-ReproductionScope ($discovery.Replace("| $entry |", '| 未分类 |')) } 'Missing reproduction input'
}
foreach ($criterion in @('R01', 'R02', 'R03')) {
    Assert-Rejected { Assert-ReproductionScope ($discovery.Replace("| $criterion |", '| 未分类 |')) } 'Missing or duplicate admission criterion'
}
Assert-Rejected { Assert-ReproductionScope ($discovery.Replace('不静默猜参数、拼凑实验流程或转为独立实现', '自动补全实验实现')) } 'implementation deferral is missing'
foreach ($id in @('C11', 'C12', 'C13')) {
    Assert-Rejected { Assert-WorkbenchDecisions ($discovery.Replace("| $id |", '| 未登记 |')) } 'Missing workbench decision'
}
Assert-Rejected { Assert-WorkbenchDecisions ($discovery.Replace('已确认（C11–C13）', '候选（C11–C13）')) } 'lost their confirmed status'
Assert-Rejected { Assert-WorkbenchDecisions ($discovery.Replace('以下均为助手提出的候选设计和验证方向，尚未确认，更不是已实现能力或可直接声称的简历业绩：', '以下功能均已实现：')) } 'implementation and approval boundary'
Assert-Rejected { Assert-ProjectOrganization ($discovery.Replace('| C03 |', '| 未登记 |')) } 'Missing confirmed full-lifecycle record'
Assert-Rejected { Assert-ProjectOrganization ($discovery.Replace('状态：候选产品组织，尚未确认', '状态：已批准产品组织')) } 'lost its unconfirmed status'
Assert-Rejected { Assert-ProjectOrganization ($discovery.Replace('| 任务会话 |', '| 未分类 |')) } 'Missing organization boundary'
Assert-Rejected { Assert-PiPositioning ($discovery.Replace('状态：候选定位解释，尚未确认', '状态：已批准定位')) } 'lost its candidate status'
Assert-Rejected { Assert-PiPositioning ($discovery.Replace('尚未实现本节能力', '本节能力均已实现')) } 'lost its implementation boundary'
Assert-Rejected { Assert-PiPositioning ($discovery.Replace('格式可读不等于依赖已安装、权限已授予或执行已验证', '所有 Skill 均可直接运行')) } 'runtime compatibility boundary'
Write-Output 'Discovery provenance, links, proposal/implementation/compatibility boundaries and 27 negative cases passed (documentation only).'
