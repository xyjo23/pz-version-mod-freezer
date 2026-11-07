[CmdletBinding()]
param([string]$Version='0.1.0-preview')

$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath)).TrimEnd('\')
$dist=Join-Path $root 'dist'
$stage=Join-Path $dist ('PZ-Version-Mod-Freezer-{0}' -f $Version)
$zip=$stage+'.zip'

$distFull=[IO.Path]::GetFullPath($dist).TrimEnd('\')
$stageFull=[IO.Path]::GetFullPath($stage)
if(-not $stageFull.StartsWith($distFull+'\',[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe staging path: $stageFull"}

if(Test-Path -LiteralPath $stage){Remove-Item -LiteralPath $stage -Recurse -Force}
if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}
New-Item -ItemType Directory -Path $stage -Force|Out-Null

foreach($file in @('PZ-Freezer.cmd','PZ-Freezer.ps1','README.md','LICENSE','NOTICE.md','SECURITY.md','CHANGELOG.md','project.json')){
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $stage $file)
}
Copy-Item -LiteralPath (Join-Path $root 'tools') -Destination (Join-Path $stage 'tools') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination (Join-Path $stage 'docs') -Recurse
New-Item -ItemType Directory -Path (Join-Path $stage 'profiles')|Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'logs')|Out-Null

Compress-Archive -LiteralPath $stage -DestinationPath $zip -CompressionLevel Optimal
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
Set-Content -LiteralPath ($zip+'.sha256') -Value ("{0}  {1}" -f $hash,(Split-Path -Leaf $zip)) -Encoding ASCII
[pscustomobject]@{Package=$zip;SHA256=$hash;Bytes=(Get-Item -LiteralPath $zip).Length}|Format-List
