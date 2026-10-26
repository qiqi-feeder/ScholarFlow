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

# Preserve the historical proposal and point to the now-authorized current plan.
function Assert-MvpProposal([string]$text) {
    $section = [regex]::Match($text, '(?s)### 3\.8 第一版 MVP 范围建议与剩余决定\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if ($section -notmatch '(?m)^状态：历史 MVP 建议；现行首期范围与验证要求见 \[PLAN\]\(\.\./PLAN\.md\)（C18）') { throw 'MVP proposal lost its approval boundary.' }
    foreach ($stage in @('调研与方案', '实验', '结果与分析', 'LaTeX 稿件', '投稿与修订')) {
        if ($section -notmatch ('(?m)^\| ' + [regex]::Escape($stage) + ' \|')) { throw "Missing MVP lifecycle stage: $stage" }
    }
    if (-not $section.Contains('本地运行不自动等于模型离线')) { throw 'Local runtime and offline model boundary is missing.' }
}
Assert-MvpProposal $discovery

# The explicitly selected host execution route supersedes earlier container advice.
function Assert-WindowsExecutionDecision([string]$text) {
    if ($text -notmatch '(?m)^\| C15 \|[^\r\n]*Windows[^\r\n]*Conda[^\r\n]*Git Bash') { throw 'Missing confirmed Windows/Conda/Git Bash decision.' }
    $section = [regex]::Match($text, '(?s)### 3\.8 第一版 MVP 范围建议与剩余决定\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    foreach ($term in @('Agent 大语言模型（LLM）', '科研实验模型', 'Conda 环境')) {
        if (-not $section.Contains($term)) { throw "Missing model/runtime distinction: $term" }
    }
    if ($section.Contains('实验优先评估本地 Linux 容器')) { throw 'Obsolete container-first MVP requirement.' }
}
Assert-WindowsExecutionDecision $discovery

# Keep the selected API route and explicitly deferred environment setup consistent.
function Assert-ApiDecision([string]$text) {
    if ($text -notmatch '(?m)^\| C16 \|[^\r\n]*API[^\r\n]*DeepSeek') { throw 'Missing confirmed API/DeepSeek decision.' }
    $section = [regex]::Match($text, '(?s)### 3\.8 第一版 MVP 范围建议与剩余决定\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if (-not $section.Contains('用户已确认当前环境没有，要求暂缓处理')) { throw 'Missing explicit environment setup deferral.' }
    if ($section.Contains('是否接受本地应用/实验＋云端模型 API') -or $section.Contains('已请求安装目录或环境 Python 路径')) { throw 'Resolved API/environment question remains pending.' }
}
Assert-ApiDecision $discovery

function Assert-PiProviderReuse([string]$text) {
    if ($text -notmatch '(?m)^\| C17 \|[^\r\n]*复用 Pi[^\r\n]*Web') { throw 'Missing confirmed Pi provider reuse decision.' }
    $section = [regex]::Match($text, '(?s)### 3\.8 第一版 MVP 范围建议与剩余决定\r?\n(.*?)(?=\r?\n#{2,3} |\z)').Groups[1].Value
    if (-not $section.Contains('API 接入边界已确认（C17）') -or -not $section.Contains('首期不另建厂商适配层')) { throw 'Missing provider integration scope boundary.' }
    if ($section.Contains('建议首批以 DeepSeek 为必选，另评估通义千问和智谱')) { throw 'Superseded per-provider scope is still active.' }
}
Assert-PiProviderReuse $discovery

foreach ($name in @('PRODUCT_DESIGN.md', 'TECHNICAL_DESIGN.md', 'IMPLEMENTATION_ROADMAP.md')) {
    $text = Get-Content (Join-Path $root ('docs/' + $name)) -Raw -Encoding UTF8
    if (-not $text.Contains('历史方案，待重新确认') -or -not $text.Contains('[DISCOVERY](DISCOVERY.md)')) {
        throw "Historical design is missing its current-status pointer: $name"
    }
}
$readme = Get-Content (Join-Path $root 'README.md') -Raw -Encoding UTF8
$index = Get-Content (Join-Path $root 'docs/README.md') -Raw -Encoding UTF8
if (-not $readme.Contains('(docs/README.md)') -or -not $index.Contains('(DISCOVERY.md)')) { throw 'Discovery must be reachable through the README documentation index.' }
# Scope this guard to the explicitly recorded phase, so an authorized transition can update it.
if ($discovery.Contains('阶段：需求探索。')) {
    foreach ($name in @('PLAN.md', 'docs/PLAN.md')) {
        if (Test-Path (Join-Path $root $name)) { throw "Implementation plan exists during discovery: $name" }
    }
}
function Assert-PlanningAuthorization([string]$text) {
    if ($text -notmatch '(?m)^\| C18 \|[^\r\n]*PLAN[^\r\n]*验证点') { throw 'Missing explicit planning authorization.' }
    if (-not $text.Contains('阶段：MVP 实施规划。') -or -not $text.Contains('[PLAN](../PLAN.md)')) { throw 'Missing current planning phase and entry point.' }
}
Assert-PlanningAuthorization $discovery
if (-not (Test-Path (Join-Path $root 'PLAN.md')) -or -not $readme.Contains('(PLAN.md)')) { throw 'Authorized plan must exist and be linked from README.' }

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
Assert-Rejected { Assert-MvpProposal ($discovery.Replace('状态：历史 MVP 建议；现行首期范围与验证要求见', '状态：已实现 MVP，参见')) } 'lost its approval boundary'
Assert-Rejected { Assert-MvpProposal ($discovery.Replace('| 投稿与修订 |', '| 未分类 |')) } 'Missing MVP lifecycle stage'
Assert-Rejected { Assert-MvpProposal ($discovery.Replace('本地运行不自动等于模型离线', '本地运行保证完全离线')) } 'offline model boundary'
Assert-Rejected { Assert-WindowsExecutionDecision ($discovery.Replace('| C15 |', '| 未登记 |')) } 'Missing confirmed Windows'
Assert-Rejected { Assert-WindowsExecutionDecision ($discovery.Replace('Agent 大语言模型（LLM）', '模型')) } 'Missing model/runtime distinction'
Assert-Rejected { Assert-ApiDecision ($discovery.Replace('| C16 |', '| 未登记 |')) } 'Missing confirmed API'
Assert-Rejected { Assert-ApiDecision ($discovery.Replace('用户已确认当前环境没有，要求暂缓处理', '继续查找环境')) } 'Missing explicit environment setup deferral'
Assert-Rejected { Assert-ApiDecision ($discovery.Replace('API 路线已确定，预算待定。', '是否接受本地应用/实验＋云端模型 API')) } 'Resolved API/environment question remains pending'
Assert-Rejected { Assert-PiProviderReuse ($discovery.Replace('| C17 |', '| 未登记 |')) } 'Missing confirmed Pi provider reuse'
Assert-Rejected { Assert-PiProviderReuse ($discovery.Replace('首期不另建厂商适配层', '首期自建厂商适配层')) } 'Missing provider integration scope boundary'
Assert-Rejected { Assert-PiProviderReuse ($discovery.Replace('厂商/模型选项随选定 Pi 版本的实际支持展示', '建议首批以 DeepSeek 为必选，另评估通义千问和智谱')) } 'Superseded per-provider scope'
Assert-Rejected { Assert-PlanningAuthorization ($discovery.Replace('| C18 |', '| 未登记 |')) } 'Missing explicit planning authorization'
Assert-Rejected { Assert-PlanningAuthorization ($discovery.Replace('阶段：MVP 实施规划。', '阶段：业务已完成。')) } 'Missing current planning phase'
Write-Output 'Discovery provenance, links, planning authorization and 40 negative cases passed (documentation only).'
