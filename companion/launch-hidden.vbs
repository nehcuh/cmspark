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
' (And does not short-circuit — nest the probe so it only runs when the js file exists)
ElseIf objFSO.FileExists(strHere & "\cmspark-agent.js") Then
    If HasSystemNode() Then
        strCmd = "cmd /c "" set NODE_PATH=" & strHere & " && node """ & strHere & "\cmspark-agent.js"" tray """
    ' Priority 3 fallback: no usable node, but a leftover SEA may still exist
    ElseIf objFSO.FileExists(strHere & "\cmspark-agent.exe") Then
        strCmd = """" & strHere & "\cmspark-agent.exe" & """ tray"
    Else
        Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
        ts.WriteLine Now & " [ERROR] cmspark-agent.js found but no usable node runtime (restore bundled node.exe or install Node.js); no cmspark-agent.exe fallback in " & strHere
        ts.Close
        WScript.Quit 1
    End If
' Priority 3: SEA standalone exe last resort (portable SEA-only trees)
ElseIf objFSO.FileExists(strHere & "\cmspark-agent.exe") Then
    strCmd = """" & strHere & "\cmspark-agent.exe" & """ tray"
Else
    Dim ts
    Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
    If objFSO.FileExists(strHere & "\cmspark-agent.js") Then
        ts.WriteLine Now & " [ERROR] cmspark-agent.js found but no usable node runtime (restore bundled node.exe or install Node.js); no cmspark-agent.exe fallback in " & strHere
    Else
        ts.WriteLine Now & " [ERROR] Neither cmspark-agent.js nor cmspark-agent.exe found in " & strHere
    End If
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

' Probe for a usable system node: cmd exits 9009 when node is not on PATH
Function HasSystemNode()
    Dim intProbe
    intProbe = 1
    On Error Resume Next
    intProbe = objShell.Run("cmd /c node --version >nul 2>nul", 0, True)
    On Error GoTo 0
    HasSystemNode = (intProbe = 0)
End Function
