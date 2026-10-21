param([ValidateSet('matting', 'general')][string]$Model = 'matting')
$ErrorActionPreference = 'Stop'
$qaRoot = if ($Model -eq 'general') { 'D:/CanvasStudioBiRefNetFullQA' } else { 'D:/CanvasStudioBiRefNetQA' }
$python = 'D:/CanvasStudioRuntime/segment-python/Scripts/python.exe'
$script = Join-Path $PSScriptRoot 'atelier-birefnet-proof.py'
$resultPath = Join-Path $qaRoot 'matting-resource-profile-tree.json'
if (Test-Path -LiteralPath $resultPath) { throw 'Existing evidence: choose a justified new run before replacing it.' }
$oldMatting = $env:STUDIO_BIREFNET_MATTING_FP16
$oldFull = $env:STUDIO_BIREFNET_FULL
$oldProfile = $env:STUDIO_BIREFNET_PROFILE
$samples = [System.Collections.Generic.List[object]]::new()
$timer = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $env:STUDIO_BIREFNET_MATTING_FP16 = if ($Model -eq 'matting') { '1' } else { '0' }
    $env:STUDIO_BIREFNET_FULL = if ($Model -eq 'general') { '1' } else { '0' }
    $env:STUDIO_BIREFNET_PROFILE = '1'
    $worker = Start-Process -FilePath $python -ArgumentList @('"' + $script + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $qaRoot 'matting-resource-profile-tree.log') -RedirectStandardError (Join-Path $qaRoot 'matting-resource-profile-tree.err')
    while (-not $worker.HasExited) {
        # Windows venv python.exe launches the actual interpreter as its child.
        $processIds = @($worker.Id) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($worker.Id)" | ForEach-Object { [int]$_.ProcessId })
        $processes = @(Get-Process -Id $processIds -ErrorAction SilentlyContinue)
        $gpu = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory | Where-Object { $_.Name -match '^pid_(\d+)_' -and [int]$Matches[1] -in $processIds })
        $worker.Refresh()
        if ($worker.HasExited) { break }
        $samples.Add([pscustomobject]@{
            elapsedMs = $timer.ElapsedMilliseconds
            processIds = $processIds
            workingMiB = [math]::Round(($processes | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 1)
            privateMiB = [math]::Round(($processes | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB, 1)
            dedicatedMiB = [math]::Round(($gpu | Measure-Object DedicatedUsage -Sum).Sum / 1MB, 1)
            sharedMiB = [math]::Round(($gpu | Measure-Object SharedUsage -Sum).Sum / 1MB, 1)
            gpuInstances = $gpu.Count
        })
        Start-Sleep -Milliseconds 300
    }
    $worker.WaitForExit()
    $result = [pscustomobject]@{
        processId = $worker.Id
        exitCode = $worker.ExitCode
        limits = 'Sampled Windows GPU Process Memory counters; may miss transient peaks. Formal editor is hidden/idle, not interactive co-running acceptance. ORT profiling changes timing.'
        samples = $samples
    }
    $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8
    $result | Select-Object processId,exitCode,@{n='samples';e={$samples.Count}} | ConvertTo-Json
    if ($result.exitCode -ne 0) { throw 'Isolated model did not complete; retain failure evidence.' }
    if (-not ($samples | Where-Object { $_.gpuInstances -gt 0 })) { throw 'No GPU worker counters captured: this run cannot substantiate GPU usage.' }
} finally {
    $env:STUDIO_BIREFNET_MATTING_FP16 = $oldMatting
    $env:STUDIO_BIREFNET_FULL = $oldFull
    $env:STUDIO_BIREFNET_PROFILE = $oldProfile
}
