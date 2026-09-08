$ErrorActionPreference = "Continue"

$projectRoot = $PSScriptRoot
$frontendPath = Join-Path $projectRoot "frontend"
$sharedPath = Join-Path $projectRoot "shared"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       CrimeNetX Frontend Watcher" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

function Update-Frontend {
    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Change detected..." -ForegroundColor Yellow
    Write-Host "Rebuilding frontend..." -ForegroundColor Cyan
    Write-Host ""

    docker compose up -d --build frontend

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Frontend updated successfully!" -ForegroundColor Green
        Write-Host "http://localhost:3000" -ForegroundColor White
    }
    else {
        Write-Host ""
        Write-Host "Frontend build failed." -ForegroundColor Red
        Write-Host "Check the Docker output above." -ForegroundColor Red
    }
}

# Initial build
Update-Frontend

Write-Host ""
Write-Host "Watching:" -ForegroundColor Cyan
Write-Host "  frontend/" -ForegroundColor White
Write-Host "  shared/" -ForegroundColor White
Write-Host ""
Write-Host "Save a file to automatically rebuild." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

$watchers = @()

function Add-Watcher {
    param (
        [string]$Path
    )

    if (!(Test-Path $Path)) {
        return
    }

    $watcher = New-Object System.IO.FileSystemWatcher

    $watcher.Path = $Path
    $watcher.IncludeSubdirectories = $true
    $watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, DirectoryName'

    $watcher.EnableRaisingEvents = $true

    $watchers += $watcher

    return $watcher
}

$frontendWatcher = Add-Watcher $frontendPath
$sharedWatcher = Add-Watcher $sharedPath

$action = {
    $path = $Event.SourceEventArgs.FullPath
    $changeType = $Event.SourceEventArgs.ChangeType

    # Ignore noisy/generated directories
    if (
        $path -like "*\node_modules\*" -or
        $path -like "*\.next\*" -or
        $path -like "*\.git\*" -or
        $path -like "*\dist\*"
    ) {
        return
    }

    # Ignore temporary files
    if (
        $path.EndsWith(".tmp") -or
        $path.EndsWith(".swp") -or
        $path.EndsWith("~")
    ) {
        return
    }

    Write-Host ""
    Write-Host "Detected: $changeType" -ForegroundColor DarkYellow
    Write-Host $path -ForegroundColor DarkGray

    # Debounce rapid changes
    Start-Sleep -Milliseconds 800

    Update-Frontend
}

if ($frontendWatcher) {
    Register-ObjectEvent `
        -InputObject $frontendWatcher `
        -EventName Changed `
        -Action $action | Out-Null

    Register-ObjectEvent `
        -InputObject $frontendWatcher `
        -EventName Created `
        -Action $action | Out-Null

    Register-ObjectEvent `
        -InputObject $frontendWatcher `
        -EventName Deleted `
        -Action $action | Out-Null

    Register-ObjectEvent `
        -InputObject $frontendWatcher `
        -EventName Renamed `
        -Action $action | Out-Null
}

if ($sharedWatcher) {
    Register-ObjectEvent `
        -InputObject $sharedWatcher `
        -EventName Changed `
        -Action $action | Out-Null

    Register-ObjectEvent `
        -InputObject $sharedWatcher `
        -EventName Created `
        -Action $action | Out-Null

    Register-ObjectEvent `
        -InputObject $sharedWatcher `
        -EventName Deleted `
        -Action $action | Out-Null

    Register-ObjectEvent `
        -InputObject $sharedWatcher `
        -EventName Renamed `
        -Action $action | Out-Null
}

try {
    while ($true) {
        Wait-Event -Timeout 1 | Out-Null
    }
}
finally {
    Write-Host ""
    Write-Host "Stopping frontend watcher..." -ForegroundColor Yellow

    Get-EventSubscriber | Unregister-Event
    Get-EventSubscriber | Remove-Job

    $watchers | ForEach-Object {
        $_.Dispose()
    }
}