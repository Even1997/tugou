param(
    [Parameter(Mandatory)][string] $Executable,
    [ValidateRange(1, 35)][int] $TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
$executableName = [IO.Path]::GetFileName($Executable)
$targetPaths = @([IO.Path]::GetFullPath($Executable))
foreach ($directory in @($env:TUGOU_SETUP_PREVIOUS_DIR, $env:TUGOU_SETUP_USER_DIR)) {
    if ($directory) {
        $targetPaths += [IO.Path]::GetFullPath([IO.Path]::Combine($directory, $executableName))
    }
}

function Get-InstalledProcesses {
    $escapedName = $executableName.Replace("'", "''")
    Get-CimInstance -ClassName Win32_Process -Filter "Name='$escapedName'" | Where-Object {
        $_.ExecutablePath -in $targetPaths -or -not $_.ExecutablePath
    }
}

function Test-BackgroundProcess($entry) {
    $command = $entry.CommandLine
    $command -match '(?:^|\s)--type=(?:renderer|gpu-process|utility)(?:\s|$)' -or
    ($command -match '[\\/]app\.asar[\\/]core[\\/]mcp\.cjs(?=["\s]|$)' -and
     $command -match '(?:^|\s)--session(?:\s|$)')
}

try {
    $sessionId = (Get-Process -Id $PID).SessionId
    $requested = @{}
    $clock = [Diagnostics.Stopwatch]::StartNew()
    do {
        $running = @(Get-InstalledProcesses)
        if (-not $running.Count) { exit 0 }

        # Handle each installation separately and let its app save before touching its helpers.
        foreach ($path in $targetPaths | Select-Object -Unique) {
            $matching = @($running | Where-Object ExecutablePath -EQ $path)
            $windows = @($matching | Where-Object { -not (Test-BackgroundProcess $_) })
            $candidates = if ($windows.Count) { $windows } else { $matching }
            foreach ($entry in $candidates) {
                if ($entry.SessionId -ne $sessionId) { continue }
                $process = Get-Process -Id $entry.ProcessId -ErrorAction SilentlyContinue
                if (-not $process -or $process.Path -ine $path -or $process.HasExited) { continue }
                if ($windows.Count) {
                    $identity = "$($process.Id):$($process.StartTime.Ticks)"
                    if (-not $requested.ContainsKey($identity) -and $process.CloseMainWindow()) {
                        $requested[$identity] = $true
                    }
                } elseif ($process.MainWindowHandle -eq [IntPtr]::Zero) {
                    # Revalidate the role before stopping a PID returned by the earlier snapshot.
                    $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$($process.Id)"
                    if ($current.ExecutablePath -ieq $path -and
                        $current.CreationDate -eq $entry.CreationDate -and (Test-BackgroundProcess $current)) {
                        try { $process.Kill() } catch [InvalidOperationException] {
                            if (-not $process.HasExited) { throw }
                        }
                    }
                }
            }
        }
        Start-Sleep -Milliseconds 250
    } while ($clock.Elapsed.TotalSeconds -lt $TimeoutSeconds)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
}
exit 2
