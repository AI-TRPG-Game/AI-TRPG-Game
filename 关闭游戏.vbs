Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shell.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
On Error Resume Next
shell.Run "node ""scripts\launcher.cjs"" --stop", 0, False
If Err.Number <> 0 Then MsgBox ChrW(32570) & ChrW(23569) & ChrW(32) & ChrW(78) & ChrW(111) & ChrW(100) & ChrW(101) & ChrW(46) & ChrW(106) & ChrW(115) & ChrW(12290) & ChrW(35831) & ChrW(23433) & ChrW(35013) & ChrW(32) & ChrW(78) & ChrW(111) & ChrW(100) & ChrW(101) & ChrW(46) & ChrW(106) & ChrW(115) & ChrW(65292) & ChrW(24182) & ChrW(22312) & ChrW(39033) & ChrW(30446) & ChrW(30446) & ChrW(24405) & ChrW(36816) & ChrW(34892) & ChrW(19968) & ChrW(27425) & ChrW(32) & ChrW(110) & ChrW(112) & ChrW(109) & ChrW(32) & ChrW(105) & ChrW(110) & ChrW(115) & ChrW(116) & ChrW(97) & ChrW(108) & ChrW(108) & ChrW(12290), 16, "AI-TRPG"
