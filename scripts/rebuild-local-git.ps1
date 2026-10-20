param(
    [string]$RepositoryPath = (Split-Path -Parent $PSScriptRoot),
    [string]$RemoteUrl = 'https://github.com/qiqi-feeder/ScholarFlow.git',
    [switch]$UseCachedRemote
)
$ErrorActionPreference = 'Stop'

# Run from an ordinary local PowerShell session with write access to .git.
# This rebuilds local metadata on top of GitHub main; it never pushes or deletes files.
$repository = (Resolve-Path -LiteralPath $RepositoryPath).Path.TrimEnd('\', '/')
if ((Split-Path -Leaf $repository) -ne 'ScholarFlow') {
    throw 'Expected an explicitly named ScholarFlow directory.'
}
$directory = Get-Item -LiteralPath $repository -Force
if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Repository root must not be a junction or symbolic link.'
}
$gitDirectory = Join-Path $repository '.git'
$metadata = Get-Item -LiteralPath $gitDirectory -Force
if (-not $metadata.PSIsContainer -or ($metadata.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Expected a regular .git directory, not a linked worktree.'
}
if (Test-Path -LiteralPath (Join-Path $gitDirectory 'index.lock')) {
    throw 'An index.lock exists. Stop active Git operations before rebuilding.'
}
if (-not (Test-Path -LiteralPath (Join-Path $repository 'docs/DISCOVERY.md'))) {
    throw 'Current discovery document is missing; refusing to rebuild the wrong directory.'
}

$git = (Get-Command git -ErrorAction Stop).Source
function Invoke-RepositoryGit {
    param([string[]]$GitArguments)
    & $git -C $repository @GitArguments
    if ($LASTEXITCODE -ne 0) { throw "Git failed: $($GitArguments[0]) (exit $LASTEXITCODE)" }
}

$authorName = & $git -C $repository config user.name
if ($LASTEXITCODE -ne 0 -or -not $authorName) { throw 'Configure Git user.name first.' }
$authorEmail = & $git -C $repository config user.email
if ($LASTEXITCODE -ne 0 -or -not $authorEmail) { throw 'Configure Git user.email first.' }
if ([string]::IsNullOrWhiteSpace($RemoteUrl) -or $RemoteUrl.StartsWith('-')) {
    throw 'Invalid remote URL.'
}
$backup = Join-Path (Split-Path -Parent $repository) ('ScholarFlow-git-backup-' + [guid]::NewGuid().ToString('N'))
# Verify the absolute backup destination is a new sibling outside the worktree.
$backup = [IO.Path]::GetFullPath($backup)
if ((Split-Path -Parent $backup) -ne (Split-Path -Parent $repository) -or (Test-Path -LiteralPath $backup)) {
    throw 'Invalid backup destination.'
}

# Use the filesystem API so hidden directory contents move with the directory.
[IO.Directory]::Move($gitDirectory, $backup)
if (-not [IO.File]::Exists((Join-Path $backup 'HEAD'))) {
    throw "Git metadata relocation failed verification: $backup"
}
Write-Output "Original Git metadata preserved at: $backup"
try {
    Invoke-RepositoryGit -GitArguments @('init', '-b', 'main')
    Invoke-RepositoryGit -GitArguments @('config', 'user.name', $authorName)
    Invoke-RepositoryGit -GitArguments @('config', 'user.email', $authorEmail)
    Invoke-RepositoryGit -GitArguments @('remote', 'add', 'origin', $RemoteUrl)
    if ($UseCachedRemote) {
        # Import only the cached remote history; damaged local branches stay in the backup.
        Invoke-RepositoryGit -GitArguments @('fetch', '--no-tags', $backup, 'refs/remotes/origin/main:refs/remotes/origin/main')
    } else {
        Invoke-RepositoryGit -GitArguments @('fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main')
    }
    # Mixed reset changes only Git's branch/index; current project files stay intact.
    Invoke-RepositoryGit -GitArguments @('reset', '--mixed', 'refs/remotes/origin/main')
    Invoke-RepositoryGit -GitArguments @('branch', '--set-upstream-to=origin/main', 'main')
    Invoke-RepositoryGit -GitArguments @('add', '--all')
    Invoke-RepositoryGit -GitArguments @('commit', '--allow-empty', '-m', 'chore: rebuild local repository and preserve current workspace')
    Invoke-RepositoryGit -GitArguments @('fsck', '--full')
    Invoke-RepositoryGit -GitArguments @('status', '--short')
    Write-Output 'Local Git rebuilt on origin/main and verified. GitHub has not been modified. No push was performed.'
    if ($UseCachedRemote) { Write-Output 'Used cached origin/main; fetch from GitHub when connectivity returns.' }
} catch {
    throw "Rebuild stopped. Project files remain in place; original Git metadata is at $backup. $($_.Exception.Message)"
}
