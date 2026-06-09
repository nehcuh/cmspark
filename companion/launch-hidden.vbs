' launch-hidden.vbs — hidden launcher for CMspark Agent on Windows
' Uses WScript.Shell.Run with windowStyle=0 (hidden) to eliminate console window

Dim objShell, objFSO, strNode, strScript, strLogDir, strLogFile, intRet, strHere

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

' Resolve node executable (prefer bundled node.exe, fall back to system PATH)
If objFSO.FileExists(strHere & "\node.exe") Then
    strNode = strHere & "\node.exe"
Else
    strNode = "node"
End If

strScript = "cmspark-agent.js"

' Validate script exists
If Not objFSO.FileExists(strHere & "\" & strScript) Then
    Dim ts
    Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
    ts.WriteLine Now & " [ERROR] cmspark-agent.js not found in " & strHere
    ts.Close
    WScript.Quit 1
End If

' Launch hidden — windowStyle=0 (hidden), waitOnReturn=False (async)
intRet = objShell.Run("""" & strNode & """ """ & strScript & """ tray", 0, False)

If intRet <> 0 Then
    Set ts = objFSO.OpenTextFile(strLogFile, 8, True)
    ts.WriteLine Now & " [ERROR] Launch failed with code " & intRet
    ts.Close
    WScript.Quit intRet
End If
