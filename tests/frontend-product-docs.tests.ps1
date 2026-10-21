$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$document = Get-Content (Join-Path $repositoryRoot 'docs/FRONTEND_PRODUCT_REQUIREMENTS.md') -Raw -Encoding UTF8
$plan = Get-Content (Join-Path $repositoryRoot 'PLAN.md') -Raw -Encoding UTF8
$readme = Get-Content (Join-Path $repositoryRoot 'README.md') -Raw -Encoding UTF8
$negativeCaseCount = 0

# Check product/prototype handoff coverage, not runtime UI behavior or appearance.
function Get-RequirementSection([string]$text, [int]$number) {
    $match = [regex]::Match($text, ('(?ms)^## ' + $number + '\.[^\r\n]*\r?\n.*?(?=^## |\z)'))
    if (-not $match.Success) { throw "Missing requirement section: $number" }
    return $match.Value
}

function Read-RequirementRows([string]$text, [string]$prefix, [int]$width) {
    $rows = @{}
    foreach ($match in [regex]::Matches($text, ('(?m)^\| (' + $prefix + '\d{2}) \|[^\r\n]+'))) {
        $cells = @($match.Value.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        if ($cells.Count -ne $width -or @($cells | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
            throw "Incomplete requirement row: $($cells[0])"
        }
        if ($rows.ContainsKey($cells[0])) { throw "Duplicate requirement ID: $($cells[0])" }
        $rows[$cells[0]] = $cells
    }
    if ($rows.Count -eq 0) { throw "Missing $prefix requirement rows" }
    return $rows
}

function Assert-FrontendRequirements([string]$text, [string]$implementationPlan) {
    if (-not $text.Contains('本轮仅编写文档与文档校验，不实施功能代码。') -or
        -not $text.Contains('视觉和交互细节待原型确认，未实施新前端。')) {
        throw 'Missing requirements-only implementation boundary'
    }
    if (-not $text.Contains('这是全局模块 G01，不是只在“任务页面”才能看到的一张独立页面。')) {
        throw 'Conversation lost its persistent workspace scope'
    }
    if (-not $text.Contains('不指定亮色/暗色、品牌色、字体、圆角、阴影、图标体系或卡片风格')) {
        throw 'Prototype visual decisions were prematurely fixed'
    }
    if ($text.Contains([string][char]0xFFFD)) { throw 'Invalid requirements encoding' }
    if ($text -match '(?i)[A-Z]:[\\/]Users[\\/]') { throw 'Personal absolute path in product requirements' }
    foreach ($number in 1..12) { $null = Get-RequirementSection $text $number }
    $scenarios = Read-RequirementRows (Get-RequirementSection $text 3) 'SC' 4
    $pages = Read-RequirementRows (Get-RequirementSection $text 5) 'P' 4
    $rules = Read-RequirementRows (Get-RequirementSection $text 7) 'I' 3
    $checks = Read-RequirementRows (Get-RequirementSection $text 12) 'FT' 6
    $implementationChecks = Read-RequirementRows $implementationPlan 'WT' 7
    $modelRequirements = Read-RequirementRows (Get-RequirementSection $text 4) 'MS' 3
    foreach ($number in 1..7) {
        $id = 'MS{0:D2}' -f $number
        if (-not $modelRequirements.ContainsKey($id)) { throw "Missing model switching requirement: $id" }
    }
    if (-not $rules.ContainsKey('I11') -or -not $checks.ContainsKey('FT11') -or
        $checks['FT11'][2] -notmatch '\bI11\b' -or $checks['FT11'][4] -notmatch '\bWT16\b' -or
        -not $checks['FT11'][3].Contains('MS01–MS07')) {
        throw 'Missing model switching acceptance traceability'
    }
    if (-not $implementationChecks.ContainsKey('WT16') -or
        -not $implementationChecks['WT16'][3].Contains('FT11/MS01–MS07') -or
        -not $implementationPlan.Contains('WT02、WT03、WT16')) {
        throw 'Model switching has no implementation milestone/test assignment'
    }
    foreach ($number in 1..6) {
        $id = 'SC{0:D2}' -f $number
        if (-not $scenarios.ContainsKey($id)) { throw "Missing core scenario: $id" }
    }
    foreach ($number in 1..10) {
        $id = 'P{0:D2}' -f $number
        if (-not $pages.ContainsKey($id)) { throw "Missing core page: $id" }
    }
    foreach ($id in $scenarios.Keys) {
        $references = @([regex]::Matches($scenarios[$id][2], 'P\d{2}') | ForEach-Object { $_.Value })
        if ($references.Count -eq 0) { throw "Scenario has no page references: $id" }
        foreach ($reference in $references) {
            if (-not $pages.ContainsKey($reference)) { throw "Unknown scenario page: $reference" }
        }
    }
    $moduleSections = @{}
    foreach ($match in [regex]::Matches((Get-RequirementSection $text 6), '(?ms)^### (P\d{2}) [^\r\n]+\r?\n(.*?)(?=^### P\d{2} |\z)')) {
        $id = $match.Groups[1].Value
        if (-not $pages.ContainsKey($id)) { throw "Unknown module page: $id" }
        if ($moduleSections.ContainsKey($id)) { throw "Duplicate module page: $id" }
        $moduleSections[$id] = $true
        $moduleRows = @([regex]::Matches($match.Groups[2].Value, '(?m)^\|[^\r\n]+'))
        if ($moduleRows.Count -lt 3) { throw "Page has no module structure: $id" }
        foreach ($row in $moduleRows) {
            $cells = @($row.Value.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
            if ($cells.Count -ne 3 -or @($cells | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
                throw "Incomplete module structure: $id"
            }
        }
    }
    $statePages = @{}
    foreach ($match in [regex]::Matches((Get-RequirementSection $text 8), '(?m)^\| [^|\r\n]*（(P\d{2})） \|[^\r\n]+')) {
        $id = $match.Groups[1].Value
        if (-not $pages.ContainsKey($id)) { throw "Unknown state page: $id" }
        if ($statePages.ContainsKey($id)) { throw "Duplicate state page: $id" }
        $cells = @($match.Value.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        if ($cells.Count -ne 4 -or @($cells | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count -gt 0) {
            throw "Incomplete empty/loading/error states: $id"
        }
        $statePages[$id] = $true
    }
    $coveredPages = @{}
    $coveredRules = @{}
    foreach ($id in $checks.Keys) {
        $row = $checks[$id]
        if ($row[5] -ne '待验证') { throw "Unimplemented frontend check was promoted: $id" }
        $pageReferences = @([regex]::Matches($row[1], '[PG]\d{2}') | ForEach-Object { $_.Value })
        $ruleReferences = @([regex]::Matches($row[2], 'I\d{2}') | ForEach-Object { $_.Value })
        $testReferences = @([regex]::Matches($row[4], 'WT\d{2}') | ForEach-Object { $_.Value })
        if ($pageReferences.Count -eq 0 -or $ruleReferences.Count -eq 0 -or $testReferences.Count -eq 0) {
            throw "Incomplete frontend acceptance traceability: $id"
        }
        foreach ($reference in $pageReferences) {
            if ($reference -ne 'G01' -and -not $pages.ContainsKey($reference)) { throw "Unknown acceptance page: $reference" }
            $coveredPages[$reference] = $true
        }
        foreach ($reference in $ruleReferences) {
            if (-not $rules.ContainsKey($reference)) { throw "Unknown interaction rule: $reference" }
            $coveredRules[$reference] = $true
        }
        foreach ($reference in $testReferences) {
            if (-not $implementationChecks.ContainsKey($reference)) { throw "Unknown implementation test: $reference" }
        }
    }
    foreach ($id in $pages.Keys) {
        if (-not $moduleSections.ContainsKey($id)) { throw "Missing page module structure: $id" }
        if (-not $statePages.ContainsKey($id)) { throw "Missing page state coverage: $id" }
        if (-not $coveredPages.ContainsKey($id)) { throw "Page has no acceptance coverage: $id" }
    }
    foreach ($id in $rules.Keys) {
        if (-not $coveredRules.ContainsKey($id)) { throw "Interaction has no acceptance coverage: $id" }
    }
}

function Assert-RequirementLinks([string]$text) {
    foreach ($match in [regex]::Matches($text, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value
        if ($target -match '^(https?://|#)') { continue }
        if (-not (Test-Path -LiteralPath (Join-Path (Join-Path $repositoryRoot 'docs') ($target -split '#', 2)[0]))) {
            throw "Broken frontend requirement link: $target"
        }
    }
}

Assert-FrontendRequirements $document $plan
Assert-RequirementLinks $document
foreach ($entry in @($readme, $plan)) {
    if (-not $entry.Contains('(docs/FRONTEND_PRODUCT_REQUIREMENTS.md)')) { throw 'Missing frontend requirements entry point' }
}
if (-not $readme.Contains('./tests/frontend-product-docs.tests.ps1')) { throw 'Missing frontend document verification command' }
if (-not $plan.Contains('先核对并确认原型，再进入页面/组件设计与功能接入')) { throw 'Missing prototype-first handoff' }

function Assert-Rejected([scriptblock]$action, [string]$expected) {
    $caught = $null
    try { & $action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $expected) { throw "Negative case did not reject as expected: $expected" }
    $script:negativeCaseCount += 1
}

Assert-Rejected { Assert-FrontendRequirements ($document.Replace('本轮仅编写文档与文档校验，不实施功能代码。', '立即实施功能。')) $plan } 'requirements-only implementation boundary'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('这是全局模块 G01，不是只在“任务页面”才能看到的一张独立页面。', '仅在任务页面显示会话。')) $plan } 'persistent workspace scope'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('不指定亮色/暗色、品牌色、字体、圆角、阴影、图标体系或卡片风格', '固定旧版视觉风格')) $plan } 'visual decisions were prematurely fixed'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('## 2. 目标用户', '## 用户未登记')) $plan } 'Missing requirement section: 2'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| SC06 |', '| SC99 |')) $plan } 'Missing core scenario'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| P04 | 材料阅读与笔记 |', '| P99 | 材料阅读与笔记 |')) $plan } 'Missing core page'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| P01、P02、P03、P04 |', '| P99 |')) $plan } 'Unknown scenario page'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('### P04 材料阅读与笔记', '### 阅读模块缺失')) $plan } 'Missing page module structure'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| 页码/位置、缩放、可用的文内查找；无可靠全文时如实提示 |', '| |')) $plan } 'Incomplete module structure'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('阅读与笔记（P04）', '阅读与笔记（P99）')) $plan } 'Unknown state page'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('阅读与笔记（P04）', '阅读与笔记')) $plan } 'Missing page state coverage'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| 文档与页内容加载，显示材料名/位置，不清空笔记草稿 |', '| |')) $plan } 'Incomplete empty/loading/error states'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| G01、P03、P06、P08、P10 |', '| G99 |')) $plan } 'Unknown acceptance page'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| I03、I10 |', '| I99 |')) $plan } 'Unknown interaction rule'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('、I10', '')) $plan } 'Interaction has no acceptance coverage'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| WT08 | 待验证 |', '| WT99 | 待验证 |')) $plan } 'Unknown implementation test'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| WT08 | 待验证 |', '| 无 | 待验证 |')) $plan } 'Incomplete frontend acceptance traceability'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| 待验证 |', '| 已通过 |')) $plan } 'Unimplemented frontend check was promoted'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| MS04 |', '| MS99 |')) $plan } 'Missing model switching requirement: MS04'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| 回答期间禁用切换 |', '| |')) $plan } 'Incomplete requirement row: MS04'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| FT11 |', '| FT99 |')) $plan } 'Missing model switching acceptance traceability'
Assert-Rejected { Assert-FrontendRequirements ($document.Replace('| WT16 | 待验证 |', '| WT13 | 待验证 |')) $plan } 'Missing model switching acceptance traceability'
Assert-Rejected { Assert-FrontendRequirements $document ($plan.Replace('WT02、WT03、WT16', 'WT02、WT03')) } 'Model switching has no implementation milestone/test assignment'
Assert-Rejected { Assert-FrontendRequirements $document ($plan.Replace('FT11/MS01–MS07', '未关联模型需求')) } 'Model switching has no implementation milestone/test assignment'
Assert-Rejected { Assert-RequirementLinks '[missing](missing-frontend-prd.md)' } 'Broken frontend requirement link'
Assert-Rejected { Assert-FrontendRequirements ($document + [char]0xFFFD) $plan } 'Invalid requirements encoding'
Write-Output "Frontend product requirements: users/scenarios, page modules, states, interactions, prototype handoff and $negativeCaseCount negative cases passed. Documentation only; frontend implementation remains pending."
