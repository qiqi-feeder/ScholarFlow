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

Write-Output 'Product design document checks passed.'
