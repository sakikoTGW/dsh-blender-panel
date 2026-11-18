param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$OwnerTitle = 'DeepSeek Harness',
  [string]$ChildTitle = '- Blender',
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 800,
  [int]$H = 900
)

$ErrorActionPreference = 'Stop'

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DwmHost
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("dwmapi.dll")] public static extern int DwmRegisterThumbnail(IntPtr destination, IntPtr source, out IntPtr thumbnail);
    [DllImport("dwmapi.dll")] public static extern int DwmUnregisterThumbnail(IntPtr thumbnail);
    [DllImport("dwmapi.dll")] public static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail, ref THUMBNAIL_PROPERTIES properties);

    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct THUMBNAIL_PROPERTIES
    {
        public uint dwFlags;
        public RECT rcDestination;
        public RECT rcSource;
        public byte opacity;
        public bool fVisible;
        public bool fSourceClientAreaOnly;
    }

    public const uint DWM_TNP_RECTDESTINATION = 0x00000001;
    public const uint DWM_TNP_RECTSOURCE = 0x00000002;
    public const uint DWM_TNP_OPACITY = 0x00000004;
    public const uint DWM_TNP_VISIBLE = 0x00000008;
    public const uint DWM_TNP_SOURCECLIENTAREAONLY = 0x00000010;
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_FRAMECHANGED = 0x0020;

    public static string TitleOf(IntPtr handle)
    {
        var text = new StringBuilder(512);
        GetWindowTextW(handle, text, 512);
        return text.ToString();
    }

    public static IntPtr LargestByTitle(string needle)
    {
        IntPtr best = IntPtr.Zero;
        int bestArea = -1;
        EnumWindows((handle, _) =>
        {
            string title = TitleOf(handle);
            if (title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) return true;
            RECT rect;
            if (!GetWindowRect(handle, out rect)) return true;
            if (rect.Left < -30000) return true;
            int area = (rect.Right - rect.Left) * (rect.Bottom - rect.Top);
            if (area > bestArea)
            {
                bestArea = area;
                best = handle;
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'DwmHost').Type) {
  Add-Type -TypeDefinition $signature
}

$stateFile = Join-Path $env:TEMP 'dsh-blender-thumb.txt'

switch ($Action) {
  'register' {
    $owner = [DwmHost]::LargestByTitle($OwnerTitle)
    if ($owner -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"owner-window-not-found"}'; exit 0 }
    $source = [DwmHost]::LargestByTitle($ChildTitle)
    if ($source -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"blender-window-not-found"}'; exit 0 }

    if (Test-Path $stateFile) {
      $old = (Get-Content $stateFile -Raw).Trim()
      if ($old -ne '') { try { [void][DwmHost]::DwmUnregisterThumbnail([IntPtr][int64]$old) } catch {} }
    }

    # Ask DWM to redirect this window again: Chromium marks the host as a
    # no-redirection-bitmap surface, which makes register fail with E_INVALIDARG.
    $ex = [DwmHost]::GetWindowLong($owner, [DwmHost]::GWL_EXSTYLE)
    [void][DwmHost]::SetWindowLong($owner, [DwmHost]::GWL_EXSTYLE, ($ex -band (-bnot [DwmHost]::WS_EX_NOREDIRECTIONBITMAP)))
    [void][DwmHost]::SetWindowPos($owner, [IntPtr]::Zero, 0, 0, 0, 0,
      ([DwmHost]::SWP_NOMOVE -bor [DwmHost]::SWP_NOSIZE -bor [DwmHost]::SWP_NOZORDER -bor [DwmHost]::SWP_FRAMECHANGED))

    $thumb = [IntPtr]::Zero
    $code = [DwmHost]::DwmRegisterThumbnail($owner, $source, [ref]$thumb)
    if ($code -ne 0) { Write-Output ('{"ok":false,"error":"register-' + $code + '"}'); exit 0 }

    $props = New-Object DwmHost+THUMBNAIL_PROPERTIES
    $props.dwFlags = [DwmHost]::DWM_TNP_RECTDESTINATION -bor [DwmHost]::DWM_TNP_VISIBLE -bor [DwmHost]::DWM_TNP_OPACITY -bor [DwmHost]::DWM_TNP_SOURCECLIENTAREAONLY
    $props.rcDestination = New-Object DwmHost+RECT
    $props.rcDestination.Left = $X
    $props.rcDestination.Top = $Y
    $props.rcDestination.Right = $X + $W
    $props.rcDestination.Bottom = $Y + $H
    $props.opacity = 255
    $props.fVisible = $true
    $props.fSourceClientAreaOnly = $true
    [void][DwmHost]::DwmUpdateThumbnailProperties($thumb, [ref]$props)

    Set-Content -Path $stateFile -Value $thumb.ToInt64().ToString() -Encoding ASCII
    Write-Output ('{"ok":true,"thumb":' + $thumb.ToInt64() + ',"owner":' + $owner.ToInt64() + ',"source":' + $source.ToInt64() + '}')
  }
  'move' {
    if (-not (Test-Path $stateFile)) { Write-Output '{"ok":false,"error":"not-registered"}'; exit 0 }
    $thumb = [IntPtr][int64]((Get-Content $stateFile -Raw).Trim())
    $props = New-Object DwmHost+THUMBNAIL_PROPERTIES
    $props.dwFlags = [DwmHost]::DWM_TNP_RECTDESTINATION -bor [DwmHost]::DWM_TNP_VISIBLE
    $props.rcDestination = New-Object DwmHost+RECT
    $props.rcDestination.Left = $X
    $props.rcDestination.Top = $Y
    $props.rcDestination.Right = $X + $W
    $props.rcDestination.Bottom = $Y + $H
    $props.fVisible = $true
    [void][DwmHost]::DwmUpdateThumbnailProperties($thumb, [ref]$props)
    Write-Output '{"ok":true}'
  }
  'unregister' {
    if (Test-Path $stateFile) {
      $thumb = [IntPtr][int64]((Get-Content $stateFile -Raw).Trim())
      [void][DwmHost]::DwmUnregisterThumbnail($thumb)
      Remove-Item $stateFile -Force
    }
    Write-Output '{"ok":true}'
  }
  default { Write-Output '{"ok":false,"error":"unknown-action"}' }
}
