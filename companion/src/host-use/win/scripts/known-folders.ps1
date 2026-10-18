# Fixed Windows Known Folders only; never accepts paths or IDs from a caller.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = Microsoft.PowerShell.Utility\New-Object System.Text.UTF8Encoding($false)
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CmsparkKnownFolders {
    [DllImport("shell32.dll")]
    private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);
    public static string Get(string value) {
        Guid id = new Guid(value);
        IntPtr pointer = IntPtr.Zero;
        try {
            // KF_FLAG_DONT_VERIFY: missing/offline folders stay their configured
            // location and listing can skip them without choosing another root.
            int hr = SHGetKnownFolderPath(ref id, 0x4000, IntPtr.Zero, out pointer);
            Marshal.ThrowExceptionForHR(hr);
            return Marshal.PtrToStringUni(pointer);
        } finally {
            if (pointer != IntPtr.Zero) Marshal.FreeCoTaskMem(pointer);
        }
    }
}
'@
@{
    documents = [CmsparkKnownFolders]::Get('FDD39AD0-238F-46AF-ADB4-6C85480369C7')
    desktop = [CmsparkKnownFolders]::Get('B4BFCC3A-DB2C-424C-B029-7FE99A87C641')
    downloads = [CmsparkKnownFolders]::Get('374DE290-123F-4565-9164-39C4925E467B')
} | Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
