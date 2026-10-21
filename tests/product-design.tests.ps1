$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$documentPath = Join-Path $repositoryRoot 'docs\PRODUCT_DESIGN.md'

if (-not (Test-Path -LiteralPath $documentPath -PathType Leaf)) {
    throw "Product design document does not exist: $documentPath"
}

$content = Get-Content -LiteralPath $documentPath -Raw -Encoding UTF8
$requiredSections = @(
    '# ScholarFlow 产品设计文档（MVP）',
    '## 1. 产品概述',
    '## 3. 产品形态',
    '## 6. MVP 主要功能',
    '## 7. Pi Agent Runtime 的职责',
    '### 7.1 Agent 动态组合',
    '### 7.2 上下文隔离与交接',
    '## 9. MVP 暂不包含',
    '## 10. MVP 成功标准'
)

foreach ($section in $requiredSections) {
    if (-not $content.Contains($section)) {
        throw "Product design document is missing required section: $section"
    }
}

if (-not $content.Contains('https://pi.dev/docs/latest/sdk')) {
    throw 'Product design document is missing the Pi SDK reference.'
}

$requiredAgentConcepts = @(
    'Agent Profile',
    'Context Handoff',
    '**Clean**',
    '**Handoff**',
    '**Fork**',
    '可自托管 Server＋Web 工作台',
    'Server 所在机器',
    'dataRoot',
    '浏览器缓存不是业务数据库',
    'interrupted',
    'nature-reader',
    'source_map.json',
    '用户 Skill 库',
    '项目启用 Skill',
    '工作区推荐/默认',
    '对话显式选择',
    '完整 `SKILL.md`',
    '写作与排版',
    'LaTeX＋PDF',
    '尚未实现',
    'IMPLEMENTATION_ROADMAP.md'
)

foreach ($concept in $requiredAgentConcepts) {
    if (-not $content.Contains($concept)) {
        throw "Product design document is missing agent architecture concept: $concept"
    }
}

foreach ($outdatedClaim in @('MVP 采用 **桌面端优先、本地优先**', '后续可以提供 Web Companion')) {
    if ($content.Contains($outdatedClaim)) {
        throw "Product design still contains an outdated desktop-first claim: $outdatedClaim"
    }
}

Write-Output 'Product design document checks passed.'
