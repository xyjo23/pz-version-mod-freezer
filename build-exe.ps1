[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath)).TrimEnd('\')
$ico=Join-Path $root 'assets\pz-freezer-icon.ico'
$source=Join-Path $root 'launcher\PZFreezerLauncher.cs'
$output=Join-Path $root 'PZ-Freezer.exe'
$compiler='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

foreach($path in @($ico,$source,$compiler)){
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "构建依赖不存在：$path"}
}

& $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/win32icon:$ico" "/out:$output" /reference:System.dll /reference:System.Windows.Forms.dll $source
if($LASTEXITCODE -ne 0 -or -not(Test-Path -LiteralPath $output -PathType Leaf)){throw "EXE 编译失败，退出码：$LASTEXITCODE"}
Get-Item -LiteralPath $output | Select-Object FullName,Length,LastWriteTime
