[CmdletBinding()]
param([string]$Version='0.5.0-preview')

$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath)).TrimEnd('\')
& (Join-Path $root 'build-exe.ps1') | Out-Host
$dist=Join-Path $root 'dist'
$folderName=('PZ-Version-Mod-Freezer-{0}' -f $Version)
$layout=Join-Path $dist ($folderName+'-release-layout')
$outerDir=Join-Path $layout $folderName
$appDir=Join-Path $outerDir 'PZ-Freezer-Files'
$zip=Join-Path $dist ($folderName+'.zip')

$distFull=[IO.Path]::GetFullPath($dist).TrimEnd('\')
$layoutFull=[IO.Path]::GetFullPath($layout)
if(-not $layoutFull.StartsWith($distFull+'\',[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe staging path: $layoutFull"}

if(Test-Path -LiteralPath $layout){Remove-Item -LiteralPath $layout -Recurse -Force}
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
New-Item -ItemType Directory -Path $appDir -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $root 'PZ-Freezer.exe') -Destination (Join-Path $outerDir 'PZ-Freezer.exe')

foreach($file in @('PZ-Freezer.cmd','PZ-Freezer.ps1','README.md','LICENSE','NOTICE.md','SECURITY.md','CHANGELOG.md','project.json')){
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $appDir $file)
}
foreach($directory in @('tools','docs','assets')){Copy-Item -LiteralPath (Join-Path $root $directory) -Destination (Join-Path $appDir $directory) -Recurse}
New-Item -ItemType Directory -Path (Join-Path $appDir 'profiles')|Out-Null
New-Item -ItemType Directory -Path (Join-Path $appDir 'logs')|Out-Null

Compress-Archive -Path (Join-Path $layout '*') -DestinationPath $zip -CompressionLevel Optimal
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
Set-Content -LiteralPath ($zip+'.sha256') -Value ("{0}  {1}" -f $hash,(Split-Path -Leaf $zip)) -Encoding ASCII
[pscustomobject]@{Package=$zip;SHA256=$hash;Bytes=(Get-Item -LiteralPath $zip).Length}|Format-List
