# onenote-create.ps1 — create a page in the OneNote desktop Unfiled Notes section.
# Contract:
#   exit 0 + single-line JSON: {"target_id":"win:onenote:unfiled:note-<id>","undoable":true}
#   failure → non-zero + stderr; COM ProgID missing → stderr prefix CLASSNOTREG:
# Name/Body are XML-escaped in-script before being embedded in the page XML
# (plan §D.10 — no LLM string reaches an interpreter unescaped).

param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Body
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$onenote = $null
try {
  $onenote = New-Object -ComObject OneNote.Application
} catch {
  [Console]::Error.WriteLine("CLASSNOTREG:win.onenote.desktop|OneNote desktop is not installed (the Microsoft Store OneNote app has no COM interface). Fallback: ask the user to create the note manually.")
  exit 2
}

function Escape-Xml([string]$s) {
  return [System.Security.SecurityElement]::Escape($s)
}

try {
  # 2 = hslUnfiledNotesSection
  $sectionPath = ""
  $onenote.GetSpecialLocation(2, [ref]$sectionPath)
  if ([string]::IsNullOrEmpty($sectionPath)) {
    [Console]::Error.WriteLine("onenote-create: GetSpecialLocation(unfiled) returned empty path")
    exit 1
  }

  $pageId = ""
  # CreateNewPage(sectionPath, out pageId, npsDefault=0)
  $onenote.CreateNewPage($sectionPath, [ref]$pageId, 0)
  if ([string]::IsNullOrEmpty($pageId)) {
    [Console]::Error.WriteLine("onenote-create: CreateNewPage returned empty page id")
    exit 1
  }

  $safeName = Escape-Xml $Name
  $safeBody = (Escape-Xml $Body) -replace "`r?`n", "<br/>"

  $pageXml = "<?xml version=`"1.0`" encoding=`"utf-8`" standalone=`"yes`"?>" +
    "<one:Page xmlns:one=`"http://schemas.microsoft.com/office/onenote/2013/onenote`" ID=`"$pageId`">" +
    "<one:Title><one:OE><one:T>$safeName</one:T></one:OE></one:Title>" +
    "<one:Outline><one:OEChildren><one:OE><one:T>$safeBody</one:T></one:OE></one:OEChildren></one:Outline>" +
    "</one:Page>"

  $onenote.UpdatePageContent($pageXml)

  # TargetId page id: strip braces/dashes → [A-Za-z0-9] only.
  $idSlug = $pageId -replace '[^A-Za-z0-9]', ''
  $json = ConvertTo-Json -Compress -InputObject @{
    target_id = "win:onenote:unfiled:note-$idSlug"
    undoable  = $true
  }
  Write-Output $json
  exit 0
} catch {
  [Console]::Error.WriteLine("onenote-create: $($_.Exception.Message)")
  exit 1
}
