' 바탕화면 아이콘용: 최신 소스로 빌드한 뒤 씬 돌을 띄운다(검은 창 없이). 오류는 %TEMP%\scene-doll-launch.log에 남는다.
Set sh = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
sh.Run "cmd /c npm run desktop:start > ""%TEMP%\scene-doll-launch.log"" 2>&1", 0, False
