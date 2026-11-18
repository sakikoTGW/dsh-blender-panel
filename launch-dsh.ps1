param(
  [string]$Exe = 'E:\DSH-App\DeepSeek Harness.exe',
  [int]$TimeoutSeconds = 25,
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$running = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  if (-not $Restart) {
    # Already open: bring the existing window to the front instead of starting a
    # second instance (double-clicking the normal icon must feel normal).
    $visible = $running | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -ne $visible) {
      Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public static class Fg { [DllImport(`"user32.dll`")] public static extern bool SetForegroundWindow(IntPtr h); }" -ErrorAction SilentlyContinue
      try { [void][Fg]::SetForegroundWindow($visible.MainWindowHandle) } catch {}
      Write-Output '[dsh] DSH is already running; focused its window.'
      exit 0
    }
    Write-Output ("[dsh] DSH is still running (" + ($running.Count) + " processes). Quit it from the tray, or run:")
    Write-Output "      powershell -File launch-dsh.ps1 -Restart"
    exit 2
  }
  Write-Output "[dsh] stopping the running DSH..."
  $running | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
  Start-Sleep -Seconds 2
  $left = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
  $left | ForEach-Object { try { $_.Kill() } catch {} }
  Start-Sleep -Seconds 2
  if (@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0) {
    Write-Output "[dsh] could not stop DSH; quit it manually from the tray."
    exit 3
  }
}

try {
  # Only the presentation switch: --require crashed the app on a previous run,
  # so the mixin is not part of the launch anymore.
  $launched = Start-Process -FilePath $Exe -ArgumentList @('--disable-direct-composition') -PassThru
} catch {
  Log "flagged launch failed"; Write-Output "[dsh] flagged launch failed: $($_.Exception.Message)"
  exit 1
}

$launched.Refresh()
if ($launched.HasExited) {
  Write-Output ("[dsh] flagged launch exited with code " + $launched.ExitCode)
}

if (Wait-Window -Process $launched -Seconds $TimeoutSeconds) {
  Log "started with panel flags"; Write-Output '[dsh] started with panel flags.'
  exit 0
}

Log "fallback to plain launch"; Write-Output '[dsh] no window appeared, falling back to a plain launch.'
try {
  $fallback = Start-Process -FilePath $Exe -PassThru
  if (Wait-Window -Process $fallback -Seconds $TimeoutSeconds) {
    Log "fallback launched"; Write-Output '[dsh] fallback launch started.'
    exit 0
  }
} catch {
  Write-Output "[dsh] fallback launch failed: $($_.Exception.Message)"
}
Write-Output '[dsh] could not start DSH; use DSH-安全启动.cmd.'
exit 1
