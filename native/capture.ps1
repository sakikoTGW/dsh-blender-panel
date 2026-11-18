param(
  [Parameter(Mandatory = $true)][int]$Pid,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 0,
  [int]$Height = 0
)

$ErrorActionPreference = 'Stop'

$signature = @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class WindowCap
{
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);

    public const uint PW_RENDERFULLCONTENT = 0x00000002;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOZORDER = 0x0004;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const int SW_HIDE = 0;
    public const int SW_SHOWNOACTIVATE = 4;

    public static string Capture(int pid, string path, int width, int height)
    {
        Process proc = Process.GetProcessById(pid);
        IntPtr hwnd = proc.MainWindowHandle;
        if (hwnd == IntPtr.Zero) return "no-window";

        RECT rect;
        GetClientRect(hwnd, out rect);
        int w = width > 0 ? width : Math.Max(rect.Right - rect.Left, 1);
        int h = height > 0 ? height : Math.Max(rect.Bottom - rect.Top, 1);

        using (var bitmap = new Bitmap(w, h))
        {
            using (var graphics = Graphics.FromImage(bitmap))
            {
                IntPtr hdc = graphics.GetHdc();
                bool ok = PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT);
                graphics.ReleaseHdc(hdc);
                bitmap.Save(path, ImageFormat.Png);
                return (ok ? "ok" : "printwindow-failed") + " " + w + "x" + h;
            }
        }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'WindowCap').Type) {
  Add-Type -TypeDefinition $signature -ReferencedAssemblies System.Drawing
}

Write-Output ([WindowCap]::Capture($Pid, $Out, $Width, $Height))
