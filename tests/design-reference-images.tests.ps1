$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $repositoryRoot 'docs/design-references/chat-style-2026-10-22'
$manifestText = Get-Content (Join-Path $assetRoot 'manifest.json') -Raw -Encoding UTF8

# Check exported reference files, not application UI or the proposed design.
function Get-PngSize([string]$path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -lt 24 -or [BitConverter]::ToString($bytes[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A') {
        throw 'Invalid PNG signature'
    }
    $widthBytes = [byte[]]$bytes[16..19]
    $heightBytes = [byte[]]$bytes[20..23]
    if ([BitConverter]::IsLittleEndian) {
        [Array]::Reverse($widthBytes)
        [Array]::Reverse($heightBytes)
    }
    return @([BitConverter]::ToUInt32($widthBytes, 0), [BitConverter]::ToUInt32($heightBytes, 0))
}

function Assert-ReferenceAssets($manifest) {
    if ($manifest.source.sha256 -notmatch '^[a-f0-9]{64}$' -or
        $manifest.source.width -le 0 -or $manifest.source.height -le 0 -or $manifest.source.duration_seconds -le 0) {
        throw 'Missing source provenance'
    }
    if ($manifest.frames.Count -ne 5) { throw 'Expected five selected reference images' }
    $seen = @{}
    foreach ($frame in $manifest.frames) {
        if ($seen.ContainsKey($frame.file)) { throw 'Duplicate reference filename' }
        $seen[$frame.file] = $true
        if ($frame.file -notmatch '^\d{2}-[a-z-]+\.png$') { throw 'Unsafe reference filename' }
        $box = $frame.crop_xyxy
        if ($box.Count -ne 4 -or $box[0] -lt 0 -or $box[1] -lt 0 -or
            $box[2] -gt $manifest.source.width -or $box[3] -gt $manifest.source.height -or
            $box[2] -le $box[0] -or $box[3] -le $box[1]) { throw 'Invalid crop bounds' }
        if ($frame.timestamp_seconds -lt 0 -or $frame.timestamp_seconds -ge $manifest.source.duration_seconds) {
            throw 'Invalid frame timestamp'
        }
        $path = Join-Path $assetRoot $frame.file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Missing reference image' }
        $size = Get-PngSize $path
        if ($size[0] -ne $frame.width -or $size[1] -ne $frame.height -or
            $frame.width -ne ($box[2] - $box[0]) -or $frame.height -ne ($box[3] - $box[1])) {
            throw 'Reference image dimensions do not match crop'
        }
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $frame.sha256) {
            throw 'Reference image hash mismatch'
        }
    }
    if ($manifest.overview.file -ne '00-overview.png') { throw 'Missing reference overview' }
    $overviewPath = Join-Path $assetRoot $manifest.overview.file
    $null = Get-PngSize $overviewPath
    if ((Get-FileHash -LiteralPath $overviewPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.overview.sha256) {
        throw 'Overview hash mismatch'
    }
    foreach ($filename in @('README.md', 'STITCH_PROMPT.md')) {
        $text = Get-Content (Join-Path $assetRoot $filename) -Raw -Encoding UTF8
        foreach ($link in [regex]::Matches($text, '\[[^\]]+\]\(([^)]+)\)')) {
            if (-not (Test-Path -LiteralPath (Join-Path $assetRoot $link.Groups[1].Value))) { throw 'Broken reference document link' }
        }
    }
}

Assert-ReferenceAssets ($manifestText | ConvertFrom-Json)
$negativeCases = @(
    @{ Change = { param($m) $m.frames[0].crop_xyxy[2] = $m.source.width + 1 }; Error = 'Invalid crop bounds' },
    @{ Change = { param($m) $m.frames[0].timestamp_seconds = $m.source.duration_seconds }; Error = 'Invalid frame timestamp' },
    @{ Change = { param($m) $m.frames[1].file = $m.frames[0].file }; Error = 'Duplicate reference filename' },
    @{ Change = { param($m) $m.frames[0].width = 1 }; Error = 'dimensions do not match crop' },
    @{ Change = { param($m) $m.frames[0].sha256 = '0' * 64 }; Error = 'Reference image hash mismatch' },
    @{ Change = { param($m) $m.frames[0].file = '01-missing.png' }; Error = 'Missing reference image' }
)
foreach ($case in $negativeCases) {
    $mutated = $manifestText | ConvertFrom-Json
    & $case.Change $mutated
    $caught = $null
    try { Assert-ReferenceAssets $mutated } catch { $caught = $_.Exception.Message }
    if (-not $caught -or $caught -notmatch $case.Error) { throw "Negative case failed: $($case.Error)" }
}
Write-Output "Design references: five PNG crops, overview, provenance, dimensions, hashes, links and $($negativeCases.Count) negative cases passed. No frontend implementation verified."
