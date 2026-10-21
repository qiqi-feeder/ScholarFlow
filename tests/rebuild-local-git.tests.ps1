$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'scripts/rebuild-local-git.ps1'
$parseErrors = $null
$tokens = $null
$null = [Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }

# Exercise real Git only in a synthetic temporary repository, never the user's .git.
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('scholarflow-git-test-' + [guid]::NewGuid().ToString('N'))
$repository = Join-Path $testRoot 'ScholarFlow'
New-Item -ItemType Directory -Path (Join-Path $repository 'docs') -Force | Out-Null
try {
    $utf8 = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText((Join-Path $repository 'docs/DISCOVERY.md'), 'Synthetic discovery fixture', $utf8)
    & git -C $repository init -b main | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture Git initialization failed.' }
    & git -C $repository config user.name 'ScholarFlow Test'
    & git -C $repository config user.email 'test@example.invalid'
    & git -C $repository add --all
    & git -C $repository commit -m fixture | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture commit failed.' }
    $oldHead = & git -C $repository rev-parse HEAD
    $remote = Join-Path $testRoot 'remote.git'
    & git clone --bare -- $repository $remote | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Fixture remote creation failed.' }
    $file = Join-Path $repository 'docs/DISCOVERY.md'
    [IO.File]::WriteAllText($file, 'Updated discovery fixture', $utf8)
    $hash = (Get-FileHash -LiteralPath $file).Hash

    # A live lock must prevent any relocation of the existing repository.
    $lock = Join-Path $repository '.git/index.lock'
    [IO.File]::WriteAllText($lock, 'test lock', $utf8)
    $rejected = $false
    try { & $script -RepositoryPath $repository } catch { $rejected = $_.Exception.Message.Contains('index.lock exists') }
    if (-not $rejected) { throw 'Active lock was not rejected.' }
    if ((& git -C $repository rev-parse HEAD) -ne $oldHead) { throw 'Rejected rebuild changed history.' }
    Remove-Item -LiteralPath $lock

    if ($IsWindows) {
        $metadataPath = Join-Path $repository '.git'
        [IO.File]::SetAttributes($metadataPath, ([IO.File]::GetAttributes($metadataPath) -bor [IO.FileAttributes]::Hidden))
    }

    & $script -RepositoryPath $repository -RemoteUrl $remote
    if ((Get-FileHash -LiteralPath $file).Hash -ne $hash) { throw 'Project file changed.' }
    if ((& git -C $repository rev-list --count HEAD) -ne '2') { throw 'Expected remote history plus one snapshot commit.' }
    if ((& git -C $repository rev-parse HEAD^) -ne $oldHead) { throw 'Snapshot must extend remote main.' }
    if ((& git -C $repository remote get-url origin) -ne $remote) { throw 'Remote not restored.' }
    if ((& git "--git-dir=$remote" rev-parse main) -ne $oldHead) { throw 'Remote was modified.' }
    if (@(& git -C $repository status --porcelain).Count -ne 0) { throw 'Fresh snapshot is not clean.' }
    $backups = @([IO.Directory]::GetDirectories($testRoot, 'ScholarFlow-git-backup-*'))
    if ($backups.Count -ne 1) { throw 'Original Git backup missing.' }
    if (-not [IO.File]::Exists((Join-Path $backups[0] 'HEAD'))) { throw 'Backup metadata contents missing.' }
    $backupHead = & git "--git-dir=$($backups[0])" rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $backupHead -ne $oldHead) { throw 'Original history not preserved.' }
    if ((& git -C $repository rev-parse --abbrev-ref '@{upstream}') -ne 'origin/main') { throw 'Upstream tracking missing.' }

    # Cached recovery must work without a reachable server, including an unchanged worktree.
    $offlineUrl = Join-Path $testRoot 'unavailable.git'
    & $script -RepositoryPath $repository -RemoteUrl $offlineUrl -UseCachedRemote
    if ((Get-FileHash -LiteralPath $file).Hash -ne $hash) { throw 'Offline recovery changed project file.' }
    if ((& git -C $repository remote get-url origin) -ne $offlineUrl) { throw 'Offline recovery lost remote URL.' }
    if ((& git -C $repository rev-parse HEAD^) -ne $oldHead) { throw 'Offline recovery lost cached ancestry.' }
    if (@(& git -C $repository status --porcelain).Count -ne 0) { throw 'Offline recovery is not clean.' }
    & git -C $repository fsck --full
    if ($LASTEXITCODE -ne 0) { throw 'Offline recovery integrity check failed.' }
    Write-Output 'Rebuild tests passed: lock refusal, remote ancestry, file preservation, unchanged remote, clean status and original backup.'
} finally {
    $resolved = [IO.Path]::GetFullPath($testRoot)
    $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'scholarflow-git-test-*') {
        throw 'Unsafe fixture cleanup path.'
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
