param([Parameter(Mandatory=$true)][string]$ScriptPath)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) { throw 'DESKTOP_PS51_REQUIRED' }
$raw = [IO.File]::ReadAllBytes($ScriptPath)
if ($raw.Length -lt 4 -or $raw[0] -ne 239 -or $raw[1] -ne 187 -or $raw[2] -ne 191) { throw 'UIA_SCRIPT_SOURCE_UTF8_BOM_REQUIRED' }
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'UIA_SCRIPT_FILE_PARSE_FAILED' }
$names = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
foreach ($name in @('Hwnd', 'Name', 'Mode', 'StopFile')) { if ($names -notcontains $name) { throw 'UIA_SCRIPT_PARAMETER_MISSING' } }
$expected = 'emergency-stop flag present ' + [char]0x2014 + ' delivery aborted'
$literals = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true)
if (@($literals | Where-Object { $_.Value -ceq $expected }).Count -ne 1) { throw 'UIA_SCRIPT_UNICODE_LITERAL_CHANGED' }
# Model the documented Windows PowerShell legacy ANSI source decoding explicitly,
# independent of this runner's system locale. This never executes the UIA script.
$legacy = [Text.Encoding]::GetEncoding(1252).GetString($raw, 3, $raw.Length - 3)
$oldTokens = $null; $oldErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseInput($legacy, [ref]$oldTokens, [ref]$oldErrors)
if ($oldErrors.Count -lt 1 -or $oldErrors.Count -gt 100) { throw 'UIA_SCRIPT_ANSI_COUNTERFACTUAL_NOT_REPRODUCED' }
@{ desktop51 = $true; current_errors = 0; ansi_counterfactual_errors = $oldErrors.Count; stop_literal_exact = $true } | ConvertTo-Json -Compress
