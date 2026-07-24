# outlook-list.ps1 — list top-N classic-Outlook inbox message TargetIds.
# Contract (companion/src/host-use/win/powershell.ts):
#   exit 0 + single-line JSON on stdout: {"ids":["win:outlook:<store-slug>:msg-<EntryID>", ...]}
#   failure → non-zero exit + stderr; COM ProgID missing → stderr prefix CLASSNOTREG:
# Only Object-Model-Guard-unguarded members are touched (EntryID, default
# store, inbox folder) — no address fields, no body.

param(
  [int]$Limit = 100
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$outlook = $null
try {
  $outlook = New-Object -ComObject Outlook.Application
} catch {
  [Console]::Error.WriteLine("CLASSNOTREG:win.outlook.classic|Classic Outlook is not installed (New Outlook has no COM interface). Fallback: read mail via outlook.com in a browser tab.")
  exit 2
}

try {
  $session = $outlook.Session
  $store = $session.DefaultStore
  # Store slug: sanitized display name (SMTP or store name), charset [A-Za-z0-9_-].
  $storeSlug = ([string]$store.DisplayName) -replace '[^A-Za-z0-9_\-]', '_'
  if ([string]::IsNullOrEmpty($storeSlug)) { $storeSlug = "default" }

  $inbox = $session.GetDefaultFolder(6)  # 6 = olFolderInbox
  $items = $inbox.Items
  $items.Sort("[ReceivedTime]", $true)   # newest first

  $ids = New-Object System.Collections.Generic.List[string]
  $count = 0
  foreach ($item in $items) {
    if ($count -ge $Limit) { break }
    # 43 = olMail — skip meeting requests / reports / tasks sharing the folder.
    if ($item.Class -eq 43) {
      $ids.Add("win:outlook:${storeSlug}:msg-$($item.EntryID)")
      $count++
    }
  }

  $json = ConvertTo-Json -Compress -InputObject @{ ids = @($ids) }
  Write-Output $json
  exit 0
} catch {
  [Console]::Error.WriteLine("outlook-list: $($_.Exception.Message)")
  exit 1
}
