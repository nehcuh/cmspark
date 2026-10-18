# Legacy action entry is closed: use the Companion-owned two-process pipeline.
param(
  [Parameter(Mandatory=$true)][long]$Hwnd,
  [Parameter(Mandatory=$true)][string]$Name,
  [ValidateSet('auto','invoke','setvalue','select','toggle','scroll')][string]$Mode = 'auto',
  [string]$Value = '',
  [ValidateSet('up','down','left','right')][string]$Direction = 'down',
  [int]$ScrollAmount = 1,
  [string]$ExpectControlType = '',
  [string]$ExpectAutomationId = '',
  [int]$MaxDepth = 24,
  [int]$MaxNodes = 4000,
  # WP2 (E.6): emergency-stop flag. The CALLER (PsInputInjector.withStop) appends this to
  # every injector call, so omitting it here does not "opt out" — it makes the parameter
  # binding fail outright and the whole background route silently degrade to the
  # foreground path. That is exactly what shipped in the first cut of #572 and was caught
  # only by review, because the adapter tests use a fake runner (no argv binding) and the
  # manual E2E drove this script without the flag. Keep it, and keep it checked.
  [string]$StopFile = '',
  # Private first-party built DLL; Companion supplies this, never the model.
  [string]$NoFocusLibrary = ''
)
[Console]::Error.WriteLine('UIA_TERMINAL:UIA_PATTERN_UNAVAILABLE')
# host_pipeline_required: no action, no nested PowerShell, no alternate foreground path.
exit 6
