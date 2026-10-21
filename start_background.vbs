' ==============================================================================
' YouTube Downloader - Iniciador silencioso en segundo plano para Windows
' Ejecuta el servidor Node sin mostrar ninguna ventana de consola negra.
' ==============================================================================

Dim WshShell, fso, scriptDir
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Obtener la carpeta donde se ubica este script
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' 0 = Ocultar ventana completamente, False = No bloquear
WshShell.Run "cmd /c node server.js", 0, False
