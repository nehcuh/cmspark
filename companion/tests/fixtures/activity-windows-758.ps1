# Owned hosted-desktop fixture. Product code never imports this script.
param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName WindowsBase
$encoding=New-Object Text.UTF8Encoding $false
function Receipt([string]$name,$value) {
  $file=[IO.Path]::Combine($Directory,$name)
  [IO.File]::WriteAllText(($file+'.pending'),(ConvertTo-Json -Compress -InputObject $value),$encoding)
  [IO.File]::Move(($file+'.pending'),$file)
}
$window=New-Object Windows.Window
$window.Title='CMspark Activity 758 Owned Fixture'
$window.Width=800; $window.Height=300; $window.Left=80; $window.Top=80
$text=New-Object Windows.Controls.TextBox
$text.Text="PROJECT ALPHA`r`nSEND REPORT FRIDAY"
$text.FontSize=32; $text.Background=[Windows.Media.Brushes]::White
$text.Foreground=[Windows.Media.Brushes]::Black; $text.IsReadOnly=$true
$window.Content=$text
$window.Add_ContentRendered({
  $window.Activate() | Out-Null
  $text.Focus() | Out-Null
  $h=(New-Object Windows.Interop.WindowInteropHelper $window).Handle
  Receipt 'ready.json' ([ordered]@{pid=$PID;hwnd=$h.ToInt64()})
})
$timer=New-Object Windows.Threading.DispatcherTimer
$timer.Interval=[TimeSpan]::FromMilliseconds(50)
$script:last=''
$timer.Add_Tick({
  $file=[IO.Path]::Combine($Directory,'control.json')
  if([IO.File]::Exists($file)) {
    $value=[IO.File]::ReadAllText($file)
    if($value -cne $script:last) {
      $script:last=$value
      $command=(ConvertFrom-Json $value).command
      if($command -eq 'minimize') {$window.WindowState=[Windows.WindowState]::Minimized}
      elseif($command -eq 'quit') {$window.Close();return}
      Receipt 'ack.json' ([ordered]@{command=$command;minimized=($window.WindowState -eq [Windows.WindowState]::Minimized)})
    }
  }
})
$timer.Start()
try {$window.ShowDialog() | Out-Null}finally{$timer.Stop()}
