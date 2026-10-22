# Stop only runtimes owned by this installation. The root is data, not source.
# The installer embeds this script; ZIP uninstall uses its shipped copy.
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($env:CMSPARK_INSTALL_STOP_ROOT)
if ($root.TrimEnd('\') -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) {
    throw 'Refusing a volume/share root as an installation directory'
}
$root = $root.TrimEnd('\') + '\'
$entry = [IO.Path]::Combine($root, 'cmspark-agent.js')
# Launchers pass an absolute script as the FIRST Node argument, followed by an
# agent mode. Reject --eval/--require, relative paths, substring matches and
# scripts passed as data to unrelated programs. Windows paths cannot contain ".
$commandPattern = '^\s*(?:"[^"]+"|\S+)\s+(?:"(?<script>[^"]+)"|(?<script>\S+))\s+(?:tray|daemon|start)(?:\s|$)'
Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmspark-agent.exe'" | ForEach-Object {
    if (($_.Name -ne 'node.exe' -and $_.Name -ne 'cmspark-agent.exe') -or -not $_.ExecutablePath) { return }
    $owned = $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)
    if (-not $owned -and $_.Name -eq 'node.exe' -and $_.CommandLine) {
        $match = [regex]::Match($_.CommandLine, $commandPattern)
        if ($match.Success) {
            $script = $match.Groups['script'].Value
            # IsPathRooted alone accepts drive-relative C:foo and root-relative \foo.
            if ($script -match '^(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\[^\\]+\\)') {
                try { $owned = [IO.Path]::GetFullPath($script).Equals($entry, [StringComparison]::OrdinalIgnoreCase) }
                catch { $owned = $false }
            }
        }
    }
    if ($owned) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
