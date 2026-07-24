# apps-signer.ps1 — add-time Authenticode signer probe for the App tab (WP2).
# Records WHO signed the candidate exe (design §6 AppExeBlock.signer:
# "Authenticode signer captured at add-time; absent/empty = unsigned").
# Only a Valid signature yields a signer — every other status (NotSigned,
# HashMismatch, UnknownError, ...) is reported as unsigned.
#
# Contract (companion/src/host-use/win/powershell.ts):
#   exit 0 + single-line JSON on stdout: {"signer":"<Subject or empty>","status":"<Status>"}
#   target missing → exit 2 + stderr; any other failure → non-zero + stderr.
# The target path travels exclusively as argv (-TargetPath) — no string
# interpolation of caller-controlled values into the script body.

param(
  [Parameter(Mandatory=$true)][string]$TargetPath
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

try {
  if (-not (Test-Path -LiteralPath $TargetPath)) {
    [Console]::Error.WriteLine("apps-signer: target not found: $TargetPath")
    exit 2
  }
  $sig = Get-AuthenticodeSignature -LiteralPath $TargetPath
  $status = [string]$sig.Status
  $signer = ""
  if ($status -eq "Valid" -and $null -ne $sig.SignerCertificate) {
    $signer = [string]$sig.SignerCertificate.Subject
  }
  Write-Output (ConvertTo-Json -Compress -InputObject @{ signer = $signer; status = $status })
  exit 0
} catch {
  [Console]::Error.WriteLine("apps-signer: $($_.Exception.Message)")
  exit 1
}
