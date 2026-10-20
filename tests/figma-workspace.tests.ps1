$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $repositoryRoot '.experiments\frontend-bakeoff'
$statePath = Join-Path $artifactRoot 'figma-state-scholarflow-ide-v1.json'
$state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
$audit = Get-Content -LiteralPath (Join-Path $artifactRoot $state.audit) -Raw -Encoding UTF8 | ConvertFrom-Json

if ($state.phase -ne 'complete' -or @($state.pendingValidations).Count -ne 0) {
    throw 'Figma design archive is incomplete.'
}
if ($state.scope.codeImplemented -or $state.scope.interactivePrototype) {
    throw 'This archive must describe a visual proposal, not an implemented page or interactive prototype.'
}
if ($state.fileKey -ne $audit.fileKey -or $state.entities.screens.workspace -ne $audit.workspaceRootId) {
    throw 'Figma file/root IDs do not agree across the state and audit files.'
}
if (-not $state.designUrl.Contains(('node-id=' + $audit.workspaceRootId.Replace(':', '-')))) {
    throw 'Review link must open the actual workspace frame, not a blank page or cover.'
}
if ($audit.qa.width -ne 1440 -or $audit.qa.height -ne 900) {
    throw 'Workspace must have the agreed 1440x900 review dimensions.'
}
foreach ($field in @('fontOffenders', 'unboundPaints', 'overflow', 'contrastFailures')) {
    if (@($audit.qa.$field).Count -ne 0) { throw "Figma validation failed: $field" }
}
if ($audit.qa.textCount -lt 80 -or $audit.qa.instanceCount -lt 40) {
    throw 'QA must include loaded instance descendants, not only the top-level text and instances.'
}
if (@($audit.qa.textContrast).Count -ne $audit.qa.textCount -or $audit.qa.minimumTextContrast -lt 4.5) {
    throw 'Every text node must have a passing small-text contrast measurement.'
}
foreach ($measurement in $audit.qa.textContrast) {
    if (-not $measurement.pass -or $measurement.ratio -lt 4.5) { throw "Insufficient contrast: $($measurement.id)" }
}

$nodesById = @{}
foreach ($entry in $audit.nodeInventory) {
    if ($nodesById.ContainsKey($entry[0])) { throw "Duplicate node ID: $($entry[0])" }
    $nodesById[$entry[0]] = $entry
}
if (-not $nodesById.ContainsKey($audit.workspaceRootId)) { throw 'Workspace root is missing from the exact node inventory.' }
foreach ($name in @('Titlebar', 'Activity Rail', 'Project Files', 'Open Research Objects', 'Document Canvas', 'Agent Conversation', 'Agent Tool Trace', 'Agent Input', 'Research Output Panel', 'Statusbar')) {
    if (-not ($audit.nodeInventory | Where-Object { $_[2] -eq $name })) { throw "Missing workbench section: $name" }
}
if ($audit.nodeInventory | Where-Object { $_[2] -match '(?i)hero|stat[- ]?card|stats[- ]?grid|dashboard' }) {
    throw 'The new design must not retain dashboard hero/stat-card structures.'
}
foreach ($property in $state.entities.workspaceParts.PSObject.Properties) {
    if (-not $nodesById.ContainsKey($property.Value)) { throw "Missing archived pane: $($property.Name)" }
}

$variablesById = @{}
foreach ($variable in $audit.variables) { $variablesById[$variable.id] = $variable }
if ($variablesById.Count -ne 62) { throw 'Expected the complete 62-token workbench foundation.' }
foreach ($variable in $audit.variables) {
    if ($variable.scopes -contains 'ALL_SCOPES' -or $variable.css -notmatch '^var\(--sf-[a-z0-9-]+\)$') {
        throw "Invalid variable scopes or CSS mapping: $($variable.name)"
    }
    if ($state.entities.variables.PSObject.Properties[$variable.name].Value -ne $variable.id) {
        throw "Variable ledger mismatch: $($variable.name)"
    }
    foreach ($value in $variable.values) {
        if ($value.alias) {
            $seen = @{}
            $target = $value.alias
            while ($target) {
                if (-not $variablesById.ContainsKey($target) -or $seen.ContainsKey($target)) { throw "Broken/cyclic alias: $($variable.name)" }
                $seen[$target] = $true
                $aliased = $variablesById[$target]
                if ($aliased.type -ne $variable.type) { throw "Alias type mismatch: $($variable.name)" }
                $target = $aliased.values[0].alias
            }
        }
    }
}
foreach ($expected in @(@('Tree Row', 3), @('Editor Tab', 2), @('Workspace Button', 4), @('Research Object Row', 1), @('Activity Item', 2))) {
    $component = @($audit.components | Where-Object name -eq $expected[0])
    if ($component.Count -ne 1 -or $component[0].variantCount -ne $expected[1] -or -not $nodesById.ContainsKey($component[0].id)) {
        throw "Missing or invalid reusable component: $($expected[0])"
    }
}

$previewPath = Join-Path $artifactRoot $state.preview
$bytes = [System.IO.File]::ReadAllBytes($previewPath)
if ($bytes.Length -lt 24 -or ([BitConverter]::ToString($bytes[0..7])) -ne '89-50-4E-47-0D-0A-1A-0A') {
    throw 'Review preview must be a valid PNG.'
}
$widthBytes = [byte[]]$bytes[16..19]
$heightBytes = [byte[]]$bytes[20..23]
[Array]::Reverse($widthBytes)
[Array]::Reverse($heightBytes)
if ([BitConverter]::ToUInt32($widthBytes, 0) -ne 1440 -or [BitConverter]::ToUInt32($heightBytes, 0) -ne 900) {
    throw 'Preview must be the full-resolution workspace, not a thumbnail or empty cover.'
}

Write-Output 'Figma workspace archive checks passed (layout, typography, contrast, components, tokens, preview).'
