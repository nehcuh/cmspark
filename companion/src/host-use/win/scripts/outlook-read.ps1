# outlook-read.ps1 — read one classic-Outlook message by TargetId.
# Contract:
#   exit 0 + single-line JSON: {"sender":..,"subject":..,"date_received":..,"body_preview":..}
#   failure → non-zero + stderr; COM ProgID missing → stderr prefix CLASSNOTREG:
# Reads ONLY OMG-unguarded fields: SenderName (never SenderEmailAddress or any
# address field), Subject, ReceivedTime, Body (truncated to MaxChars).

param(
  [Parameter(Mandatory = $true)][string]$TargetId,
  [int]$MaxChars = 500
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

if ($TargetId -notmatch '^win:outlook:[A-Za-z0-9_\-]+:msg-([0-9A-Fa-f]{8,})$') {
  [Console]::Error.WriteLine("outlook-read: malformed TargetId (expected win:outlook:<store>:msg-<hex EntryID>)")
  exit 1
}
$entryId = $Matches[1]

$outlook = $null
try {
  $outlook = New-Object -ComObject Outlook.Application
} catch {
  [Console]::Error.WriteLine("CLASSNOTREG:win.outlook.classic|Classic Outlook is not installed (New Outlook has no COM interface). Fallback: read mail via outlook.com in a browser tab.")
  exit 2
}

try {
  $item = $outlook.Session.GetItemFromID($entryId)
  if ($null -eq $item) {
    [Console]::Error.WriteLine("outlook-read: no message for EntryID (moved or deleted)")
    exit 1
  }
  $body = [string]$item.Body
  if ($body.Length -gt $MaxChars) { $body = $body.Substring(0, $MaxChars) }
  $dateReceived = ""
  try { $dateReceived = ([datetime]$item.ReceivedTime).ToString("o") } catch { $dateReceived = "" }

  $json = ConvertTo-Json -Compress -InputObject @{
    sender        = [string]$item.SenderName
    subject       = [string]$item.Subject
    date_received = $dateReceived
    body_preview  = $body
  }
  Write-Output $json
  exit 0
} catch {
  [Console]::Error.WriteLine("outlook-read: $($_.Exception.Message)")
  exit 1
}
