# Remote-only interpreter regression. Runs no Node, browser, registry or host.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows') { throw 'COCKPIT_BRIDGE_REMOTE_ONLY' }
$launcher = Join-Path $PSScriptRoot 'run-cockpit-bridge-first.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($launcher, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'COCKPIT_BRIDGE_NODE_TEST_PARSE' }
# Extract actual complete selection statements, including the old failing shape.
$starts = @($ast.EndBlock.Statements | Where-Object {
  $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and
  $_.Left.Extent.Text -cin @('$node', '$nodeCommands') -and
  @($_.Right.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Get-Command' }, $true)).Count -eq 1
})
$ends = @($ast.EndBlock.Statements | Where-Object { $_ -is [System.Management.Automation.Language.AssignmentStatementAst] -and $_.Left.Extent.Text -ceq '$entry' })
if ($starts.Count -ne 1 -or $ends.Count -ne 1 -or $starts[0].Extent.StartOffset -ge $ends[0].Extent.StartOffset) { throw 'COCKPIT_BRIDGE_NODE_TEST_REGION' }
$text = [IO.File]::ReadAllText($launcher)
$selection = [scriptblock]::Create($text.Substring($starts[0].Extent.StartOffset, $ends[0].Extent.StartOffset - $starts[0].Extent.StartOffset))
$realCommands = @(Microsoft.PowerShell.Core\Get-Command node.exe -CommandType Application -TotalCount 1 -ErrorAction Stop)
if ($realCommands.Count -ne 1 -or $realCommands[0] -isnot [System.Management.Automation.ApplicationInfo]) { throw 'COCKPIT_BRIDGE_NODE_TEST_SETUP' }
$realItems = @(Microsoft.PowerShell.Management\Get-Item -LiteralPath $realCommands[0].Source -ErrorAction Stop)
if ($realItems.Count -ne 1 -or $realItems[0] -isnot [IO.FileInfo]) { throw 'COCKPIT_BRIDGE_NODE_TEST_SETUP' }
function Invoke-ActualNodeSelection {
  param([object[]]$Commands, [object[]]$Items)
  $script:queryCount = 0; $script:itemCount = 0; $script:queryTotal = 0
  function Get-Command {
    [CmdletBinding()] param([string]$Name, [string]$CommandType, [int]$TotalCount)
    if ($Name -cne 'node.exe' -or $CommandType -cne 'Application') { throw 'COCKPIT_BRIDGE_NODE_TEST_QUERY' }
    $script:queryCount++; $script:queryTotal = $TotalCount
    return $Commands
  }
  function Get-Item {
    [CmdletBinding()] param([object]$LiteralPath)
    $script:itemCount++; $script:itemPath = $LiteralPath
    return $Items
  }
  . $selection
  return $node
}
$passed = 0
$selected = Invoke-ActualNodeSelection -Commands $realCommands -Items $realItems
if ($selected -isnot [string] -or $selected -cne $realItems[0].FullName -or $script:queryCount -ne 1 -or $script:queryTotal -ne 1 -or $script:itemCount -ne 1 -or $script:itemPath -isnot [string] -or $script:itemPath -cne $realCommands[0].Source) { throw 'COCKPIT_BRIDGE_NODE_TEST_SINGLE' }
$passed++
function Assert-NodeRefused {
  param([object[]]$Commands, [object[]]$Items, [int]$ExpectedItemCalls)
  $caught = $null
  try { $null = Invoke-ActualNodeSelection -Commands $Commands -Items $Items } catch { $caught = $_ }
  if ($null -eq $caught -or $caught.Exception.Message -cne 'COCKPIT_BRIDGE_NODE_PATH' -or $script:itemCount -ne $ExpectedItemCalls) { throw 'COCKPIT_BRIDGE_NODE_TEST_REFUSAL' }
}
Assert-NodeRefused -Commands @() -Items $realItems -ExpectedItemCalls 0; $passed++
Assert-NodeRefused -Commands @($realCommands[0], $realCommands[0]) -Items $realItems -ExpectedItemCalls 0; $passed++
Assert-NodeRefused -Commands @([pscustomobject]@{ Source = $realCommands[0].Source }) -Items $realItems -ExpectedItemCalls 0; $passed++
Assert-NodeRefused -Commands $realCommands -Items @() -ExpectedItemCalls 1; $passed++
Assert-NodeRefused -Commands $realCommands -Items @($realItems[0], $realItems[0]) -ExpectedItemCalls 1; $passed++
$directory = Microsoft.PowerShell.Management\Get-Item -LiteralPath $PSScriptRoot
Assert-NodeRefused -Commands $realCommands -Items @($directory) -ExpectedItemCalls 1; $passed++
# Explicit FileInfo attribute-boundary control, not a physical reparse creation.
$reparse = Microsoft.PowerShell.Management\Get-Item -LiteralPath $realCommands[0].Source
$reparse | Add-Member -MemberType NoteProperty -Name Attributes -Value ([IO.FileAttributes]::ReparsePoint) -Force
Assert-NodeRefused -Commands $realCommands -Items @($reparse) -ExpectedItemCalls 1; $passed++
# Real unmocked discovery + Get-Item run the exact selected block once as well.
. $selection
if ($node -isnot [string] -or $node -cne $realItems[0].FullName) { throw 'COCKPIT_BRIDGE_NODE_TEST_REAL' }
$passed++
[Console]::Out.WriteLine('COCKPIT_BRIDGE_NODE_SELECTION {"version":1,"passed":' + $passed + ',"native_identity":"NOT_RUN"}')
exit 0
