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

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DpiInfo {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  public static void EnablePerMonitor() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch {}
  }
  public static double ScaleOf(IntPtr hwnd) {
    try { uint dpi = GetDpiForWindow(hwnd); if (dpi > 0) return dpi / 96.0; } catch {}
    return 1.0;
  }
}
'@
[DpiInfo]::EnablePerMonitor()

$signature = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WindowHost
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumChildProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int index, int value);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr region, bool redraw);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr hWnd, IntPtr rect, IntPtr region, int flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public struct POINT { public int X; public int Y; }

    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;
    public const int GWLP_HWNDPARENT = -8;
    public const int WS_CHILD = 0x40000000;
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_CAPTION = 0x00C00000;
    public const int WS_THICKFRAME = 0x00040000;
    public const int WS_MINIMIZEBOX = 0x00020000;
    public const int WS_MAXIMIZEBOX = 0x00010000;
    public const int WS_SYSMENU = 0x00080000;
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_NOREDIRECTIONBITMAP = 0x00200000;
    public const int WS_CLIPCHILDREN = 0x02000000;
    public const int WS_EX_APPWINDOW = 0x00040000;
    public const int SW_RESTORE = 9;
    public const int RDW_INVALIDATE = 0x0001;
    public const int RDW_ERASE = 0x0004;
    public const int RDW_ALLCHILDREN = 0x0080;
    public const int RDW_UPDATENOW = 0x0100;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_SHOWWINDOW = 0x0040;

    public static string TitleOf(IntPtr handle)
    {
        var text = new StringBuilder(512);
        GetWindowTextW(handle, text, 512);
        return text.ToString();
    }

    public static IntPtr LargestByTitle(string needle, bool requireTopLevel)
    {
        IntPtr best = IntPtr.Zero;
        int bestArea = -1;
        EnumWindows((handle, _) =>
        {
            if (!IsWindowVisible(handle)) return true;
            if (requireTopLevel && GetParent(handle) != IntPtr.Zero) return true;
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

    public static IntPtr ChildOfProcess(IntPtr parent, uint pid)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (handle, _) =>
        {
            uint windowPid;
            GetWindowThreadProcessId(handle, out windowPid);
            if (windowPid == pid)
            {
                found = handle;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static POINT ClientOrigin(IntPtr window)
    {
        POINT point = new POINT();
        point.X = 0;
        point.Y = 0;
        ClientToScreen(window, ref point);
        return point;
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'WindowHost').Type) {
  Add-Type -TypeDefinition $signature
}

function Find-BlenderWindow {
  # the remembered handle survives style/parent changes, so try it first
  $stateFile = Join-Path $env:TEMP 'dsh-blender-child.txt'
  if (Test-Path $stateFile) {
    $parts = (Get-Content $stateFile -Raw).Trim().Split(' ')
    if ($parts.Length -ge 1) {
      $candidate = [IntPtr][int64]$parts[0]
      if ($candidate -ne [IntPtr]::Zero -and [WindowHost]::IsWindowVisible($candidate)) {
        $title = [WindowHost]::TitleOf($candidate)
        if ($title.IndexOf('Blender', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $candidate }
      }
    }
  }
  $window = [WindowHost]::LargestByTitle($ChildTitle, $true)
  if ($window -ne [IntPtr]::Zero) { return $window }
  $owner = [WindowHost]::LargestByTitle($OwnerTitle, $true)
  $blenderPid = (Get-Process blender -ErrorAction SilentlyContinue | Select-Object -First 1).Id
  if ($owner -ne [IntPtr]::Zero -and $blenderPid) {
    $window = [WindowHost]::ChildOfProcess($owner, [uint32]$blenderPid)
  }
  return $window
}

switch ($Action) {
  'attach' {
    $owner = [WindowHost]::LargestByTitle($OwnerTitle, $true)
    if ($owner -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"owner-window-not-found"}'; exit 0 }
    $child = Find-BlenderWindow
    if ($child -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"blender-window-not-found"}'; exit 0 }

    if ([WindowHost]::GetParent($child) -ne [IntPtr]::Zero) {
      # WS_CHILD must go first or the window stays a child of the desktop
      $detachStyle = [WindowHost]::GetWindowLong($child, [WindowHost]::GWL_STYLE)
      $detachStyle = $detachStyle -band (-bnot [WindowHost]::WS_CHILD)
      [void][WindowHost]::SetWindowLong($child, [WindowHost]::GWL_STYLE, $detachStyle)
      [void][WindowHost]::ShowWindow($child, [WindowHost]::SW_RESTORE)
      [void][WindowHost]::SetParent($child, [IntPtr]::Zero)
    }

    $style = [WindowHost]::GetWindowLong($child, [WindowHost]::GWL_STYLE)
    $style = ($style -band (-bnot ([WindowHost]::WS_CHILD -bor [WindowHost]::WS_CAPTION -bor [WindowHost]::WS_THICKFRAME -bor [WindowHost]::WS_MINIMIZEBOX -bor [WindowHost]::WS_MAXIMIZEBOX -bor [WindowHost]::WS_SYSMENU))) -bor [WindowHost]::WS_POPUP
    [void][WindowHost]::SetWindowLong($child, [WindowHost]::GWL_STYLE, $style)

    $exStyle = [WindowHost]::GetWindowLong($child, [WindowHost]::GWL_EXSTYLE)
    $exStyle = ($exStyle -bor [WindowHost]::WS_EX_TOOLWINDOW) -band (-bnot [WindowHost]::WS_EX_APPWINDOW)
    [void][WindowHost]::SetWindowLong($child, [WindowHost]::GWL_EXSTYLE, $exStyle)

    [void][WindowHost]::SetWindowLongPtr($child, [WindowHost]::GWLP_HWNDPARENT, $owner)

    $scale = [DpiInfo]::ScaleOf($owner)
    $screenX = $origin.X + [int][Math]::Round($X * $scale)
    $screenY = $origin.Y + [int][Math]::Round($Y * $scale)
    $physW = [int][Math]::Round($W * $scale)
    $physH = [int][Math]::Round($H * $scale)
    [void][WindowHost]::ShowWindow($child, [WindowHost]::SW_RESTORE)
    [void][WindowHost]::SetWindowPos($child, [IntPtr]::Zero, $screenX, $screenY, $physW, $physH,
      ([WindowHost]::SWP_NOACTIVATE -bor [WindowHost]::SWP_SHOWWINDOW))
    [void][WindowHost]::RedrawWindow($child, [IntPtr]::Zero, [IntPtr]::Zero,
      ([WindowHost]::RDW_INVALIDATE -bor [WindowHost]::RDW_ERASE -bor [WindowHost]::RDW_ALLCHILDREN -bor [WindowHost]::RDW_UPDATENOW))

    $stateFile = Join-Path $env:TEMP 'dsh-blender-child.txt'
    Set-Content -Path $stateFile -Value ($child.ToInt64().ToString() + ' ' + $owner.ToInt64().ToString()) -Encoding ASCII
    Write-Output ('{"ok":true,"child":' + $child.ToInt64() + ',"owner":' + $owner.ToInt64() + ',"x":' + $screenX + ',"y":' + $screenY + '}')
  }
  'status' {
    $stateFile = Join-Path $env:TEMP 'dsh-blender-child.txt'
    $child = [IntPtr]::Zero
    if (Test-Path $stateFile) {
      $parts = (Get-Content $stateFile -Raw).Trim().Split(' ')
      if ($parts.Length -ge 1) { $child = [IntPtr][int64]$parts[0] }
    }
    if ($child -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"no-child"}'; exit 0 }
    $rect = New-Object WindowHost+RECT
    [void][WindowHost]::GetWindowRect($child, [ref]$rect)
    $ownerHandle = [WindowHost]::GetWindowLongPtr($child, [WindowHost]::GWLP_HWNDPARENT)
    $visible = [WindowHost]::IsWindowVisible($child)
    Write-Output ('{"ok":true,"child":' + $child.ToInt64() + ',"ownedBy":' + $ownerHandle.ToInt64() + ',"visible":' + $visible.ToString().ToLower() + ',"left":' + $rect.Left + ',"top":' + $rect.Top + ',"right":' + $rect.Right + ',"bottom":' + $rect.Bottom + '}')
  }
  'child' {
    $owner = [WindowHost]::LargestByTitle($OwnerTitle, $true)
    if ($owner -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"owner-window-not-found"}'; exit 0 }
    $child = Find-BlenderWindow
    if ($child -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"blender-window-not-found"}'; exit 0 }

    # DWM refuses to compose children of a no-redirection-bitmap window, which
    # is what Electron creates for DirectComposition. Clear it on the host and
    # make the host clip its children so the child gets its own area.
    $hostEx = [WindowHost]::GetWindowLong($owner, [WindowHost]::GWL_EXSTYLE)
    [void][WindowHost]::SetWindowLong($owner, [WindowHost]::GWL_EXSTYLE, ($hostEx -band (-bnot [WindowHost]::WS_EX_NOREDIRECTIONBITMAP)))
    $hostStyle = [WindowHost]::GetWindowLong($owner, [WindowHost]::GWL_STYLE)
    [void][WindowHost]::SetWindowLong($owner, [WindowHost]::GWL_STYLE, ($hostStyle -bor [WindowHost]::WS_CLIPCHILDREN))

    [void][WindowHost]::SetWindowLongPtr($child, [WindowHost]::GWLP_HWNDPARENT, [IntPtr]::Zero)
    $style = [WindowHost]::GetWindowLong($child, [WindowHost]::GWL_STYLE)
    $style = ($style -band (-bnot ([WindowHost]::WS_CAPTION -bor [WindowHost]::WS_THICKFRAME -bor [WindowHost]::WS_MINIMIZEBOX -bor [WindowHost]::WS_MAXIMIZEBOX -bor [WindowHost]::WS_SYSMENU -bor [WindowHost]::WS_POPUP))) -bor [WindowHost]::WS_CHILD
    [void][WindowHost]::SetWindowLong($child, [WindowHost]::GWL_STYLE, $style)
    [void][WindowHost]::ShowWindow($child, [WindowHost]::SW_RESTORE)
    $scale = [DpiInfo]::ScaleOf($owner)
    [void][WindowHost]::SetParent($child, $owner)
    [void][WindowHost]::MoveWindow($child, [int][Math]::Round($X * $scale), [int][Math]::Round($Y * $scale),
      [int][Math]::Round($W * $scale), [int][Math]::Round($H * $scale), $true)

    # Clip the child to exactly the panel rectangle: a stale or oversized window
    # can never bleed outside the sidebar area.
    $clipW = [int][Math]::Round($W * $scale)
    $clipH = [int][Math]::Round($H * $scale)
    $region = [WindowHost]::CreateRectRgn(0, 0, $clipW, $clipH)
    if ($region -ne [IntPtr]::Zero) {
      [void][WindowHost]::SetWindowRgn($child, $region, $true)
    }
    [void][WindowHost]::ShowWindow($child, 5)
    [void][WindowHost]::RedrawWindow($child, [IntPtr]::Zero, [IntPtr]::Zero,
      ([WindowHost]::RDW_INVALIDATE -bor [WindowHost]::RDW_ERASE -bor [WindowHost]::RDW_ALLCHILDREN -bor [WindowHost]::RDW_UPDATENOW))

    $stateFile = Join-Path $env:TEMP 'dsh-blender-child.txt'
    Set-Content -Path $stateFile -Value ($child.ToInt64().ToString() + ' ' + $owner.ToInt64().ToString()) -Encoding ASCII
    Write-Output ('{"ok":true,"mode":"child","child":' + $child.ToInt64() + ',"owner":' + $owner.ToInt64() + '}')
  }
  'hide' {
    $child = Find-BlenderWindow
    if ($child -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"blender-window-not-found"}'; exit 0 }
    [void][WindowHost]::ShowWindow($child, 0)
    Write-Output '{"ok":true,"hidden":true}'
  }
  'show' {
    $child = [IntPtr]::Zero
    $stateFile = Join-Path $env:TEMP 'dsh-blender-child.txt'
    if (Test-Path $stateFile) {
      $parts = (Get-Content $stateFile -Raw).Trim().Split(' ')
      if ($parts.Length -ge 1) {
        $candidate = [IntPtr][int64]$parts[0]
        if ([WindowHost]::IsWindow($candidate)) { $child = $candidate }
      }
    }
    if ($child -eq [IntPtr]::Zero) { $child = Find-BlenderWindow }
    if ($child -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"blender-window-not-found"}'; exit 0 }
    [void][WindowHost]::ShowWindow($child, [WindowHost]::SW_RESTORE)
    [void][WindowHost]::ShowWindow($child, 5)
    Write-Output '{"ok":true,"shown":true}'
  }
  'ownerstyle' {
    $owner = [WindowHost]::LargestByTitle($OwnerTitle, $true)
    if ($owner -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"owner-window-not-found"}'; exit 0 }
    $ex = [WindowHost]::GetWindowLong($owner, -20)
    $noRedirect = (($ex -band 0x00200000) -ne 0)
    Write-Output ('{"ok":true,"noredirection":' + $noRedirect.ToString().ToLower() + ',"exstyle":' + $ex + '}')
  }
  'detach' {
    $child = Find-BlenderWindow
    if ($child -eq [IntPtr]::Zero) { Write-Output '{"ok":false,"error":"blender-window-not-found"}'; exit 0 }
    [void][WindowHost]::SetWindowLongPtr($child, [WindowHost]::GWLP_HWNDPARENT, [IntPtr]::Zero)
    $style = [WindowHost]::GetWindowLong($child, [WindowHost]::GWL_STYLE)
    $style = ($style -band (-bnot [WindowHost]::WS_POPUP)) -bor [WindowHost]::WS_CAPTION -bor [WindowHost]::WS_THICKFRAME -bor [WindowHost]::WS_MINIMIZEBOX -bor [WindowHost]::WS_MAXIMIZEBOX
    [void][WindowHost]::SetWindowLong($child, [WindowHost]::GWL_STYLE, $style)
    $exStyle = [WindowHost]::GetWindowLong($child, [WindowHost]::GWL_EXSTYLE)
    $exStyle = ($exStyle -band (-bnot [WindowHost]::WS_EX_TOOLWINDOW)) -bor [WindowHost]::WS_EX_APPWINDOW
    [void][WindowHost]::SetWindowLong($child, [WindowHost]::GWL_EXSTYLE, $exStyle)
    [void][WindowHost]::SetWindowPos($child, [IntPtr]::Zero, 80, 80, 1280, 900,
      ([WindowHost]::SWP_NOACTIVATE -bor [WindowHost]::SWP_SHOWWINDOW))
    [void][WindowHost]::SetForegroundWindow($child)
    Write-Output '{"ok":true}'
  }
  default { Write-Output '{"ok":false,"error":"unknown-action"}' }
}
