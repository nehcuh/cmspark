# Owned hosted-desktop fixture. Product code never imports this script.
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
$encoding=New-Object Text.UTF8Encoding $false
function Receipt([string]$name,$value) {
  $file=[IO.Path]::Combine($Directory,$name)
  [IO.File]::WriteAllText(($file+'.pending'),(ConvertTo-Json -Compress -InputObject $value),$encoding)
  [IO.File]::Move(($file+'.pending'),$file)
}
$script:phase='SETUP'
function Fixture-Phase([string]$phase) {
  $script:phase=$phase
  try { [IO.File]::WriteAllText([IO.Path]::Combine($Directory,'phase.json'),('{"phase":"'+$phase+'"}'),$encoding) } catch {}
}
function Fixture-Failure($errorRecord) {
  # Owned fixture only: one finite first rejection, no environment or user data.
  if (-not [IO.File]::Exists([IO.Path]::Combine($Directory,'failure.json'))) {
    Receipt 'failure.json' ([ordered]@{phase=$script:phase;type=$errorRecord.Exception.GetType().FullName;hresult=$errorRecord.Exception.HResult;message=$errorRecord.Exception.Message.Substring(0,[Math]::Min(512,$errorRecord.Exception.Message.Length))})
  }
}
trap { Fixture-Failure $_; exit 1 }
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
$window=New-Object Windows.Window
$window.Title='CMspark Activity 758 Owned Fixture'
$window.Width=800; $window.Height=300; $window.Left=80; $window.Top=80
$text=New-Object Windows.Controls.TextBox
$text.Text="PROJECT ALPHA`r`nSEND REPORT FRIDAY"
$text.FontSize=32; $text.Background=[Windows.Media.Brushes]::White
$text.Foreground=[Windows.Media.Brushes]::Black; $text.IsReadOnly=$true
$window.Content=$text
$window.Add_ContentRendered({
  Fixture-Phase 'CONTENT_RENDERED'
  try {
  $window.Activate() | Out-Null
  $text.Focus() | Out-Null
  $h=(New-Object Windows.Interop.WindowInteropHelper $window).Handle
  Receipt 'ready.json' ([ordered]@{pid=$PID;hwnd=$h.ToInt64()})
  } catch { Fixture-Failure $_; $window.Close() }
})
$timer=New-Object Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromMilliseconds(50)
$script:last=''
$timer.Add_Tick({
  try {
  $file=[IO.Path]::Combine($Directory,'control.json')
  if([IO.File]::Exists($file)) {
    $value=[IO.File]::ReadAllText($file)
    if($value -cne $script:last) {
      $script:last=$value
      Fixture-Phase 'CONTROL'
      $command=(ConvertFrom-Json $value).command
      if($command -eq 'minimize') {$window.WindowState=[Windows.WindowState]::Minimized}
      elseif($command -eq 'quit') {$window.Close();return}
      Receipt 'ack.json' ([ordered]@{command=$command;minimized=($window.WindowState -eq [Windows.WindowState]::Minimized)})
    }
  }
  } catch { Fixture-Failure $_; $window.Close() }
})
$timer.Start()
Fixture-Phase 'SHOW_DIALOG'
try {$window.ShowDialog() | Out-Null}finally{$timer.Stop()}
