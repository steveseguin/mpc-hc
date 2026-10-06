param([int]$ProcessId, [string]$Action, [string]$Value)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MPCWindow {
    public delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, ref CopyData d);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct CopyData { public IntPtr tag; public int size; public IntPtr data; }
    public static IntPtr Find(int pid) {
        IntPtr result = IntPtr.Zero;
        EnumWindows((h,p) => {
            uint owner; GetWindowThreadProcessId(h, out owner);
            var name = new StringBuilder(256); GetClassName(h, name, 256);
            if (owner == pid && name.ToString().StartsWith("MediaPlayerClassic")) { result = h; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
    public static void CommandLine(IntPtr h, string[] args) {
        var bytes = Encoding.Unicode.GetBytes(String.Join("\0", args) + "\0");
        var ptr = Marshal.AllocHGlobal(bytes.Length + 4);
        try {
            Marshal.WriteInt32(ptr, args.Length); Marshal.Copy(bytes, 0, IntPtr.Add(ptr,4), bytes.Length);
            var data = new CopyData {tag = (IntPtr)0x6ABE51, size = bytes.Length+4, data = ptr};
            SendMessage(h, 74, IntPtr.Zero, ref data);
        } finally { Marshal.FreeHGlobal(ptr); }
    }
    public static string Text(IntPtr h) {
        var result = new StringBuilder();
        EnumChildWindows(h, (c,p) => {
            var text = new StringBuilder(4096); GetWindowText(c, text, 4096);
            if (text.Length > 0) result.AppendLine(text.ToString());
            return true;
        }, IntPtr.Zero);
        return result.ToString();
    }
}
'@
$window = [MPCWindow]::Find($ProcessId)
if ($window -eq [IntPtr]::Zero) { throw "MPC window not found for PID $ProcessId" }
switch ($Action) {
    'find' { $window.ToInt64() }
    'show' { [MPCWindow]::ShowWindow($window, 4) | Out-Null }
    'command' { [MPCWindow]::PostMessage($window, 273, [IntPtr][int]$Value, [IntPtr]::Zero) | Out-Null }
    'volume' { [MPCWindow]::CommandLine($window, @('/volume', $Value)) }
    'open' { [MPCWindow]::CommandLine($window, @($Value, '/play')) }
    'resize' {
        $width, $height = 960, 640
        if ($Value) {
            if ($Value -notmatch '^(\d+)x(\d+)$') { throw 'Expected WIDTHxHEIGHT' }
            $width, $height = [int]$Matches[1], [int]$Matches[2]
        }
        [MPCWindow]::SetWindowPos($window, [IntPtr]::Zero, 50, 50, $width, $height, 20) | Out-Null
    }
    'rect' { $rect = New-Object MPCWindow+Rect; [MPCWindow]::GetWindowRect($window, [ref]$rect) | Out-Null; $rect | ConvertTo-Json -Compress }
    'text' { [MPCWindow]::Text($window) }
    'modules' { (Get-Process -Id $ProcessId).Modules.FileName | ConvertTo-Json -Compress }
    'key' {
        [MPCWindow]::PostMessage($window, 256, [IntPtr][int]$Value, [IntPtr]::Zero) | Out-Null
        [MPCWindow]::PostMessage($window, 257, [IntPtr][int]$Value, [IntPtr]::Zero) | Out-Null
    }
    'screenshot' {
        Add-Type -AssemblyName System.Drawing
        $rect = New-Object MPCWindow+Rect
        [MPCWindow]::GetWindowRect($window, [ref]$rect) | Out-Null
        $bitmap = New-Object System.Drawing.Bitmap ($rect.right-$rect.left), ($rect.bottom-$rect.top)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $dc = $graphics.GetHdc()
        try { [MPCWindow]::PrintWindow($window, $dc, 2) | Out-Null }
        finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
        try { $bitmap.Save($Value, [System.Drawing.Imaging.ImageFormat]::Png) }
        finally { $bitmap.Dispose() }
    }
    'close' { [MPCWindow]::PostMessage($window, 16, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
}
