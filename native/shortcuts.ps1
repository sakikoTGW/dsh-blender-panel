param(
  [ValidateSet('install', 'restore', 'status')][string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell

$targets = @(
  (Join-Path $env:USERPROFILE 'Desktop\DeepSeek Harness.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk'),
  (Join-Path $env:PUBLIC 'Desktop\DeepSeek Harness.lnk'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\DeepSeek Harness.lnk')
)

$launcher = 'E:\逆向\dsh-blender-panel\launch-dsh.cmd'
$result = @()

foreach ($path in $targets) {
  if (-not (Test-Path $path)) { continue }
  $backup = "$path.dsh-backup"
  $link = $shell.CreateShortcut($path)

  switch ($Action) {
    'install' {
      if (-not (Test-Path $backup)) { Copy-Item $path $backup -Force }
      if ($link.Arguments -notmatch 'launch-dsh') {
        $link.Arguments = "/c `"$launcher`""
        $link.WorkingDirectory = Split-Path $launcher -Parent
        $link.Save()
        $result += [pscustomobject]@{ path = $path; action = 'patched' }
      } else {
        $result += [pscustomobject]@{ path = $path; action = 'already' }
      }
    }
    'restore' {
      if (Test-Path $backup) {
        Copy-Item $backup $path -Force
        $result += [pscustomobject]@{ path = $path; action = 'restored' }
      } else {
        $link.Arguments = '/c "E:\DSH-App\launch-official.cmd"'
        $link.WorkingDirectory = 'E:\DSH-App'
        $link.Save()
        $result += [pscustomobject]@{ path = $path; action = 'rebuilt' }
      }
    }
    default {
      $result += [pscustomobject]@{ path = $path; target = $link.TargetPath; arguments = $link.Arguments }
    }
  }
}

ConvertTo-Json -InputObject @($result) -Compress
