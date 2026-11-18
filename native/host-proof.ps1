param(
  [string]$Out = 'E:\_work\host-proof.png'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HostProof
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
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

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

$form = New-Object System.Windows.Forms.Form
$form.Text = 'host-proof'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(80, 80)
$form.Size = New-Object System.Drawing.Size(640, 820)
$form.BackColor = [System.Drawing.Color]::FromArgb(12, 12, 16)
$form.Show()
[System.Windows.Forms.Application]::DoEvents()

$blender = Start-Process -FilePath 'E:\Blender\blender.exe' -ArgumentList @('--window-geometry', '700', '200', '400', '500') -PassThru
$deadline = (Get-Date).AddSeconds(25)
$child = [IntPtr]::Zero
while ((Get-Date) -lt $deadline -and $child -eq [IntPtr]::Zero) {
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.Application]::DoEvents()
  $child = [HostProof]::FindBlender()
}

$ok = $false
if ($child -ne [IntPtr]::Zero) {
  $style = [HostProof]::GetWindowLong($child, -16)
  $style = ($style -band (-bnot [int]0x80C40000)) -bor 0x40000000
  [void][HostProof]::SetWindowLong($child, -16, $style)
  $ex = [HostProof]::GetWindowLong($child, -20)
  [void][HostProof]::SetWindowLong($child, -20, (($ex -bor 0x80) -band (-bnot [int]0x40000)))
  [void][HostProof]::ShowWindow($child, 9)
  [void][HostProof]::SetParent($child, $form.Handle)
  [void][HostProof]::MoveWindow($child, 10, 10, 610, 760, $true)
  [void][HostProof]::RedrawWindow($child, [IntPtr]::Zero, [IntPtr]::Zero, 0x0185)
  $ok = $true
}

for ($i = 0; $i -lt 12; $i++) {
  [System.Windows.Forms.Application]::DoEvents()
  Start-Sleep -Milliseconds 150
}

$rect = $form.RectangleToScreen($form.ClientRectangle)
$bmp = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Location, [System.Drawing.Point]::Empty, $rect.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Output ('attached=' + $ok)

$form.Close()
Start-Sleep -Milliseconds 500
try { $blender.Kill() } catch {}
