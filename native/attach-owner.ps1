param(
  [Parameter(Mandatory = $true)][int64]$OwnerHwnd,
  [int]$X = 40,
  [int]$Y = 90,
  [int]$W = 470,
  [int]$H = 640
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class OwnHost
{
    public delegate bool Proc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Proc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr SetParent(IntPtr c, IntPtr p);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern bool RedrawWindow(IntPtr h, IntPtr r, IntPtr g, int f);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    public struct RECT { public int L, T, R, B; }
    public struct POINT { public int X, Y; }

    public static IntPtr FindBlender()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) =>
        {
            var sb = new StringBuilder(256);
            GetWindowText(h, sb, 256);
            if (sb.ToString().Contains("- Blender") && GetParent(h) == IntPtr.Zero)
            {
                found = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@

$owner = [IntPtr]$OwnerHwnd
$ownEx = [OwnHost]::GetWindowLong($owner, -20)

$child = [OwnHost]::FindBlender()
if ($child -eq [IntPtr]::Zero) {
  Write-Output ('{"ok":false,"error":"no-blender","ownerExstyle":' + $ownEx + '}')
  exit
}

$dpi = [OwnHost]::GetDpiForWindow($owner)
if ($dpi -lt 96) { $dpi = 144 }
$scale = $dpi / 96.0

$style = [OwnHost]::GetWindowLong($child, -16)
$style = ($style -band (-bnot [int]0x80C40000)) -bor 0x40000000
[void][OwnHost]::SetWindowLong($child, -16, $style)
$ex = [OwnHost]::GetWindowLong($child, -20)
[void][OwnHost]::SetWindowLong($child, -20, (($ex -bor 0x80) -band (-bnot [int]0x40000)))
[void][OwnHost]::ShowWindow($child, 9)
[void][OwnHost]::SetParent($child, $owner)
[void][OwnHost]::MoveWindow($child, [int]($X * $scale), [int]($Y * $scale), [int]($W * $scale), [int]($H * $scale), $true)
[void][OwnHost]::RedrawWindow($child, [IntPtr]::Zero, [IntPtr]::Zero, 0x0185)

Write-Output ('{"ok":true,"child":' + $child.ToInt64() + ',"ownerExstyle":' + $ownEx + ',"noredirection":' + ((($ownEx -band 0x00200000) -ne 0).ToString().ToLower()) + ',"scale":' + $scale + '}')
