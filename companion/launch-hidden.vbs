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
' Priority 1: Bundled node.exe + cmspark-agent.js (official zip; wins over leftover SEA)
If objFSO.FileExists(strHere & "\node.exe") And objFSO.FileExists(strHere & "\cmspark-agent.js") Then
    strCmd = "cmd /c "" set NODE_PATH=" & strHere & " && """ & strHere & "\node.exe"" """ & strHere & "\cmspark-agent.js"" tray """
' Priority 2: System node + local cmspark-agent.js with NODE_PATH
ElseIf objFSO.FileExists(strHere & "\cmspark-agent.js") Then
    strCmd = "cmd /c "" set NODE_PATH=" & strHere & " && node """ & strHere & "\cmspark-agent.js"" tray """
' Priority 3: SEA standalone exe last resort (portable SEA-only trees)
ElseIf objFSO.FileExists(strHere & "\cmspark-agent.exe") Then
    strCmd = """" & strHere & "\cmspark-agent.exe" & """ tray"
Else
    Dim ts
    Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
    ts.WriteLine Now & " [ERROR] Neither cmspark-agent.js nor cmspark-agent.exe found in " & strHere
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
