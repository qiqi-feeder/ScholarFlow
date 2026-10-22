$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$evidenceRoot = Join-Path $repositoryRoot 'docs/verification/workspace-redesign'
$baselinePath = Join-Path $evidenceRoot 'W00-baseline.md'
$defaultsPath = Join-Path $evidenceRoot 'W00-implementation-defaults.md'
$manifestPath = Join-Path $evidenceRoot 'design-baseline/manifest.json'
$negativeCaseCount = 0
$baselineIds = @('8fc29cdfbd134d8a8b65083f5989b934', 'a9cc6868af11461c8e2919a8c75bddcd',
    'fefc530a924645208f8feba7d63543d4', 'b0e0ed0532684c0bba4da8c0d5138551',
    '3ee648ba087b4d4cb383285c38f7be92', '0946e12b728e4bf1a9c2ee816fc3d5ba', '8f1f08dcd38d4a0da68b218aec38b00c')
$excludedIds = @('ab6b71c263744d298bcc758c94c70751', 'c779435d514a49a5bff06f8e97ef6497',
    '58b36ec27552416996cc8065959ea116', 'f29c34379d87493dbac7a329e97efd5f')

function Read-Text([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing evidence file: $path" }
    return Get-Content -LiteralPath $path -Raw -Encoding UTF8
}

function Assert-NoSensitive([string]$text, [string]$label) {
    if ($text.Contains([string][char]0xFFFD)) { throw "Invalid encoding in $label" }
    if ($text -match '(?i)[A-Z]:[\\/]Users[\\/]') { throw "Personal absolute path in $label" }
    if ($text -match '\bsk-[A-Za-z0-9_-]{10,}\b') { throw "API-key-like value in $label" }
    if ($text -match '(?i)(DEEPSEEK_API_KEY\s*=\s*[^\s`]+|api[_-]?key\s*[:=]\s*[A-Za-z0-9_-]{10,})') {
        throw "Credential assignment in $label"
    }
}

function Assert-Baseline([string]$text) {
    foreach ($required in @(
        '89dfe8f2f192b41115c0c1900c6bb142330eb712',
        'W00 完成，WT01 通过',
        '`npm run typecheck`',
        '`npm test`',
        '`npm run build`',
        '`npm run test:browser`',
        'PRAGMA integrity_check',
        '没有模型字段',
        'deepseek-flash',
        'deepseek-v4-pro',
        '不改写历史',
        'workspace-light.tests.ps1',
        'document.svg',
        'WT01 结果'
    )) {
        if (-not $text.Contains($required)) { throw "W00 baseline missing: $required" }
    }
    if ($text.Contains('Key 值：') -or $text -match '(?i)deepseekApiKey\s*:\s*[A-Za-z0-9]') {
        throw 'Baseline appears to record a credential value'
    }
}

function Assert-Defaults([string]$text) {
    foreach ($required in @(
        '约 360px',
        '约 250px',
        '1440、1024、390px',
        'scholarflow.workspace.state.v1.<projectId>.<taskId>',
        '每条消息最多 8 个引用',
        '最多 8,000 字符',
        '不可信数据',
        '首次发送或显式切换',
        '不静默 fallback',
        'session.setModel',
        'runId:status',
        'apps/web/test/fixtures/legacy-task.json',
        'apps/web/test/fixtures/workspace-state-v1.json',
        'apps/web/test/workspace-fixtures.test.ts',
        'W01 入口检查'
    )) {
        if (-not $text.Contains($required)) { throw "W00 defaults missing: $required" }
    }
}

function Assert-W01([string]$text) {
    foreach ($required in @(
        'W01 修复复验通过（WT02、WT03、WT16 通过）',
        'W01-review-issues.md',
        'GET /api/models',
        'model_changed',
        'deepseek-flash',
        'deepseek-v4-pro',
        '旧任务',
        'sessionFile',
        'npm run test:browser'
    )) {
        if (-not $text.Contains($required)) { throw "W01 evidence missing: $required" }
    }
}

function Assert-W01Review([string]$text, [string]$plan) {
    foreach ($required in @('W01 修复复验通过（WT02、WT03、WT16 通过）',
        '1e9e6c8487d6e5eed34f5ff39f46d506eaf8d824',
        'displayedTask=Task A', 'postedTo=Task B',
        'serverModel=deepseek-flash', 'displayedModel=deepseek:deepseek-v4-pro',
        'modelSelectVisible=false', 'W01-V01', 'W01-V02',
        '1/2 通过', 'ERR_DLOPEN_FAILED', '关闭条件', '复验与状态更新',
        'd2d974ed71e69b2f6054d1442d75fc80d765fe7a', '## 4. 修复与实际复验',
        '2/2 浏览器用例通过', '64 通过、0 失败', '390×844', '旧 GET/PUT',
        '两个实际可用 DeepSeek 模型各一次有界请求')) {
        if (-not $text.Contains($required)) { throw "W01 review missing: $required" }
    }
    foreach ($id in @('W01-R01', 'W01-R02', 'W01-R03')) {
        $rows = [regex]::Matches($text, ('(?m)^\| ' + $id + ' \|[^\r\n]+(?=\r?$)'))
        if ($rows.Count -ne 1 -or $rows[0].Value -notmatch '\| 已关闭：复验通过 \|$') {
            throw "W01 review issue is missing, duplicated or falsely closed: $id"
        }
    }
    foreach ($match in [regex]::Matches($text, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = Join-Path $evidenceRoot $match.Groups[1].Value
        if (-not (Test-Path -LiteralPath $target)) { throw 'Broken W01 review link' }
    }
    if (-not $plan.Contains('(docs/verification/workspace-redesign/W01-review-issues.md)')) {
        throw 'Plan does not link W01 review'
    }
}

function Assert-Manifest($manifest, [string]$root) {
    if ($manifest.schema -ne 1) { throw 'Manifest schema mismatch' }
    if ($manifest.project -ne 'projects/251310333590789772') { throw 'Wrong Stitch project' }
    if ($manifest.readAt -ne '2026-10-21T17:42:58.619Z') { throw 'Missing or wrong Stitch read time' }
    if (@($manifest.screenshots).Count -ne 7) { throw 'Manifest must contain seven screenshots' }
    if (@($manifest.htmlSummaries).Count -ne 7) { throw 'Manifest must contain seven HTML summaries' }
    if (@($manifest.excluded).Count -ne 4) { throw 'Manifest must exclude four variants' }
    $directory = Join-Path $root 'docs/verification/workspace-redesign/design-baseline/screenshots'
    for ($index = 0; $index -lt 7; $index++) {
        $id = 'SB{0:D2}' -f ($index + 1)
        $screen = @($manifest.screenshots | Where-Object { $_.key -eq $id })
        if ($screen.Count -ne 1) { throw "Missing manifest screen: $id" }
        $entry = $screen[0]
        if ($entry.screen -ne ('projects/251310333590789772/screens/' + $baselineIds[$index])) {
            throw "Wrong screen resource: $id"
        }
        $role = if ($index -lt 5) { '视觉原稿' } else { '辅助状态参考' }
        if ($entry.role -ne $role) { throw "Wrong screen role: $id" }
        $file = Join-Path $directory $entry.file
        if (-not (Test-Path -LiteralPath $file)) { throw "Missing screenshot file: $id" }
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLower()
        if ($hash -ne $entry.sha256) { throw "Screenshot hash mismatch: $id" }
        if ([int]$entry.width -le 0 -or [int]$entry.height -le 0) { throw "Invalid screenshot dimensions: $id" }
        if ([int]$entry.bytes -le 1000) { throw "Suspiciously small screenshot: $id" }
    }
    for ($index = 0; $index -lt 4; $index++) {
        $id = 'EX{0:D2}' -f ($index + 1)
        $entry = @($manifest.excluded | Where-Object { $_.key -eq $id })
        if ($entry.Count -ne 1) { throw "Missing excluded variant: $id" }
        if ($entry[0].screen -ne ('projects/251310333590789772/screens/' + $excludedIds[$index])) {
            throw "Wrong excluded resource: $id"
        }
        if ($entry[0].used -ne $false) { throw "Excluded variant was adopted: $id" }
    }
    foreach ($summary in $manifest.htmlSummaries) {
        if (-not $summary.source -or [int]$summary.htmlBytes -le 1000 -or -not $summary.screenshot) {
            throw 'Incomplete HTML summary entry'
        }
    }
}

function Assert-EvidenceIndex([string]$index, [string]$plan) {
    foreach ($required in @('W00-baseline.md', 'W00-implementation-defaults.md', 'W01-shell-models.md', 'W01-review-issues.md', 'design-baseline/README.md')) {
        if (-not $index.Contains($required)) { throw "Evidence index missing: $required" }
    }
    if (-not $index.Contains('WT01 通过')) { throw 'Evidence index lost WT01 result' }
    if (-not $index.Contains('W01 修复复验通过，WT02、WT03、WT16 通过')) { throw 'Evidence index lost W01 result' }
    if (-not $plan.Contains('(docs/verification/workspace-redesign/W00-baseline.md)')) {
        throw 'Plan does not link W00 baseline'
    }
    if (-not $plan.Contains('(docs/verification/workspace-redesign/W01-shell-models.md)')) {
        throw 'Plan does not link W01 evidence'
    }
}

$baseline = Read-Text $baselinePath
$defaults = Read-Text $defaultsPath
$w01 = Read-Text (Join-Path $evidenceRoot 'W01-shell-models.md')
$w01Review = Read-Text (Join-Path $evidenceRoot 'W01-review-issues.md')
$index = Read-Text (Join-Path $evidenceRoot 'README.md')
$plan = Read-Text (Join-Path $repositoryRoot 'PLAN.md')
# PowerShell 7.5+ otherwise converts ISO evidence timestamps to DateTime.
# Keep the manifest's original string on both older and newer PowerShell.
$jsonOptions = @{}
if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $jsonOptions.DateKind = 'String' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json @jsonOptions

Assert-Baseline $baseline
Assert-Defaults $defaults
Assert-W01 $w01
Assert-W01Review $w01Review $plan
Assert-Manifest $manifest $repositoryRoot
Assert-EvidenceIndex $index $plan
Assert-NoSensitive $baseline 'W00 baseline'
Assert-NoSensitive $defaults 'W00 defaults'
Assert-NoSensitive $w01 'W01 evidence'
Assert-NoSensitive $w01Review 'W01 review'
Assert-NoSensitive $index 'evidence index'

function Assert-Rejected([scriptblock]$action, [string]$expected) {
    $caught = $null
    try { & $action } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $expected) { throw "Negative case did not reject as expected: $expected" }
    $script:negativeCaseCount += 1
}

Assert-Rejected { Assert-Baseline ($baseline.Replace('89dfe8f2f192b41115c0c1900c6bb142330eb712', 'unknown')) } 'missing: 89dfe8f'
Assert-Rejected { Assert-Baseline ($baseline.Replace('W00 完成，WT01 通过', 'W00 进行中')) } 'missing: W00 完成'
Assert-Rejected { Assert-Baseline ($baseline.Replace('PRAGMA integrity_check', 'no check')) } 'missing: PRAGMA'
Assert-Rejected { Assert-Baseline ($baseline.Replace('deepseek-v4-pro', 'unknown-model')) } 'missing: deepseek-v4-pro'
Assert-Rejected { Assert-Baseline ($baseline.Replace('不改写历史', '已重写历史')) } 'missing: 不改写历史'
Assert-Rejected { Assert-Defaults ($defaults.Replace('每条消息最多 8 个引用', '引用数量不限')) } 'missing: 每条消息最多 8 个引用'
Assert-Rejected { Assert-Defaults ($defaults.Replace('不静默 fallback', '静默回退')) } 'missing: 不静默 fallback'
Assert-Rejected { Assert-Defaults ($defaults.Replace('session.setModel', 'custom switch')) } 'missing: session.setModel'
Assert-Rejected { Assert-Defaults ($defaults.Replace('apps/web/test/fixtures/legacy-task.json', 'missing.json')) } 'missing:.*legacy-task'
$brokenScreen = $manifest.PSObject.Copy()
$wrongTime = $manifest.PSObject.Copy()
$wrongTime.readAt = '2026-10-22T17:42:58.619Z'
Assert-Rejected { Assert-Manifest $wrongTime $repositoryRoot } 'Missing or wrong Stitch read time'
$brokenScreen.screenshots = @($manifest.screenshots | Select-Object -First 6)
Assert-Rejected { Assert-Manifest $brokenScreen $repositoryRoot } 'seven screenshots'
$badHash = $manifest.PSObject.Copy()
$badHash.screenshots = @($manifest.screenshots)
$badHash.screenshots[0] = $manifest.screenshots[0].PSObject.Copy()
$badHash.screenshots[0].sha256 = '0' * 64
Assert-Rejected { Assert-Manifest $badHash $repositoryRoot } 'hash mismatch'
$badRole = $manifest.PSObject.Copy()
$badRole.screenshots = @($manifest.screenshots)
$badRole.screenshots[6] = $manifest.screenshots[6].PSObject.Copy()
$badRole.screenshots[6].role = '视觉原稿'
Assert-Rejected { Assert-Manifest $badRole $repositoryRoot } 'Wrong screen role'
$badExcluded = $manifest.PSObject.Copy()
$badExcluded.excluded = @($manifest.excluded)
$badExcluded.excluded[0] = $manifest.excluded[0].PSObject.Copy()
$badExcluded.excluded[0].used = $true
Assert-Rejected { Assert-Manifest $badExcluded $repositoryRoot } 'adopted'
Assert-Rejected { Assert-NoSensitive ($baseline + ' C:\Users\example\secret') } 'Personal absolute path'
Assert-Rejected { Assert-NoSensitive ($baseline + ' sk-abcdefghijklmnop') } 'API-key-like'
Assert-Rejected { Assert-NoSensitive ($defaults + ' api_key = abcdefghijklmnop') } 'Credential assignment'
Assert-Rejected { Assert-EvidenceIndex $index ($plan.Replace('(docs/verification/workspace-redesign/W00-baseline.md)', '(missing.md)')) } 'does not link W00 baseline'
Assert-Rejected { Assert-W01 ($w01.Replace('GET /api/models', 'missing route')) } 'W01 evidence missing'
Assert-Rejected { Assert-EvidenceIndex ($index.Replace('W01-shell-models.md', 'missing.md')) $plan } 'Evidence index missing'
Assert-Rejected { Assert-EvidenceIndex $index ($plan.Replace('W01-shell-models.md', 'missing.md')) } 'does not link W01 evidence'
Assert-Rejected { Assert-NoSensitive ($w01 + ' sk-abcdefghijklmnop') } 'API-key-like'
Assert-Rejected { Assert-W01Review ($w01Review.Replace('| W01-R01 |', '| W01-R99 |')) $plan } 'issue is missing'
Assert-Rejected { Assert-W01Review ($w01Review.Replace('| 已关闭：复验通过 |', '| 已关闭 |')) $plan } 'falsely closed'
Assert-Rejected { Assert-W01Review ($w01Review.Replace('d2d974ed71e69b2f6054d1442d75fc80d765fe7a', 'missing-commit')) $plan } 'review missing'
Assert-Rejected { Assert-W01Review ($w01Review.Replace('64 通过、0 失败', '未验证')) $plan } 'review missing'
Assert-Rejected { Assert-W01Review ($w01Review.Replace('postedTo=Task B', 'postedTo=Task A')) $plan } 'review missing'
Assert-Rejected { Assert-W01Review ($w01Review.Replace('../../../apps/web/src/App.tsx', 'missing.tsx')) $plan } 'Broken W01 review link'
Assert-Rejected { Assert-W01Review $w01Review ($plan.Replace('W01-review-issues.md', 'missing.md')) } 'does not link W01 review'

Write-Output "Workspace W00/W01 evidence structure: baseline, fix commit, regression records, credential/path guards and $negativeCaseCount negative cases passed. Functional results are recorded separately; W02-W05 remain unexecuted."
