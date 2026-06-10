' launch-hidden.vbs — hidden launcher for CMspark Agent on Windows
' Uses WScript.Shell.Run with windowStyle=0 (hidden) to eliminate console window

Dim objShell, objFSO, strLogDir, strLogFile, intRet, strHere, strCmd

Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")

' Resolve directory where THIS script lives — always correct regardless of working dir
strHere = objFSO.GetParentFolderName(WScript.ScriptFullName)

strLogDir  = objShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\.cmspark-agent\logs"
strLogFile = strLogDir & "\vbs-launcher.log"

If Not objFSO.FolderExists(strLogDir) Then
    On Error Resume Next
    objFSO.CreateFolder strLogDir
    On Error GoTo 0
End If

' --- Resolve launch command ---
' Priority 1: SEA standalone exe (Node.js Single Executable Application)
If objFSO.FileExists(strHere & "\cmspark-agent.exe") Then
    strCmd = """" & strHere & "\cmspark-agent.exe" & """ tray"
' Priority 2: Bundled node.exe + cmspark-agent.js (legacy package)
ElseIf objFSO.FileExists(strHere & "\node.exe") And objFSO.FileExists(strHere & "\cmspark-agent.js") Then
    strCmd = """" & strHere & "\node.exe" & """ """ & strHere & "\cmspark-agent.js" & """ tray"
' Priority 3: System node + local cmspark-agent.js
ElseIf objFSO.FileExists(strHere & "\cmspark-agent.js") Then
    strCmd = "node """ & strHere & "\cmspark-agent.js" & """ tray"
Else
    Dim ts
    Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
    ts.WriteLine Now & " [ERROR] Neither cmspark-agent.exe nor cmspark-agent.js found in " & strHere
    ts.Close
    WScript.Quit 1
End If

' Launch hidden — windowStyle=0 (hidden), waitOnReturn=False (async)
' Crash logging is handled by Node.js (uncaught exception → crash.log)
intRet = objShell.Run(strCmd, 0, False)

If intRet <> 0 Then
    Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
    ts.WriteLine Now & " [ERROR] Launch failed with code " & intRet
    ts.Close
    WScript.Quit intRet
End If
