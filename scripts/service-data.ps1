# Task metadata binds authenticated stop to the same directory as startup.
function Resolve-RegisteredServiceDataDir($Task, [string]$Fallback) {
    $Prefix = 'CMspark source data: '
    if ($Task -and $Task.Description -and $Task.Description.StartsWith($Prefix)) {
        $Binding = $Task.Description.Substring($Prefix.Length) | ConvertFrom-Json
        $Value = [string]$Binding.dataDir
        if ($Value -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)' -or $Value -match "[\r\n\x00]") {
            throw 'Registered service data directory must be an absolute literal path'
        }
        return [System.IO.Path]::GetFullPath($Value)
    }
    return $Fallback
}
