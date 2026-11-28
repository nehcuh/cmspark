# Provision the hosted x64 desktop before building or launching native consumers.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$client = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$minimum = [version]'158.0.4370.45'
function Get-RuntimeVersion {
    $value = Get-ItemPropertyValue -LiteralPath $client -Name pv -ErrorAction SilentlyContinue
    if ($value) { return [version]$value }
    return [version]'0.0.0.0'
}

$before = Get-RuntimeVersion
if ($before -ge $minimum) {
    Write-Host "Hosted WebView2 runtime $before already meets the CI baseline."
    return
}

$url = 'https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/58f85fae-b5f5-4443-9b8d-6d4cf627d6f6/MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$digest = '45769d66809a9652050f8a91ab5329881b65cc4123fe7c733841deefbef91bf6'
$installer = Join-Path $env:RUNNER_TEMP ("cmspark-webview2-{0}.exe" -f [guid]::NewGuid())
try {
    Invoke-WebRequest -Uri $url -OutFile $installer
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash -ne $digest) {
        throw 'Unexpected WebView2 installer digest.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.GetNameInfo('SimpleName', $false) -ne 'Microsoft Corporation') {
        throw 'Invalid Microsoft WebView2 installer signature.'
    }
    $setup = Start-Process -FilePath $installer -ArgumentList '/silent', '/install' -Wait -PassThru
    if ($setup.ExitCode -ne 0) { throw "WebView2 install failed with exit code $($setup.ExitCode)." }
    $after = Get-RuntimeVersion
    if ($after -lt $minimum) { throw "WebView2 still reports $after after installation." }
    Write-Host "Hosted WebView2 runtime updated from $before to $after."
} finally {
    if (Test-Path -LiteralPath $installer) { Remove-Item -LiteralPath $installer -Force }
}
