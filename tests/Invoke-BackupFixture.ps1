[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $PSCommandPath))).TrimEnd('\')
$manager=Join-Path $projectRoot 'tools\PZ-Freeze-Manager.ps1'
$fixture=Join-Path $env:TEMP ('PZFreezerBackupTest_'+[guid]::NewGuid().ToString('N'))
$managerRoot=Join-Path $fixture 'manager'
$profile=Join-Path $fixture 'profile'
$cache=Join-Path $profile 'cache'
$selected=Join-Path $cache 'Saves\Sandbox\SelectedSave'
$other=Join-Path $cache 'Saves\Sandbox\OtherSave'
$destination=Join-Path $fixture 'external-backups'

try{
    foreach($path in @($managerRoot,$selected,$other,$destination,(Join-Path $cache 'Logs'),(Join-Path $cache 'mods'))){New-Item -ItemType Directory -Path $path -Force|Out-Null}
    Set-Content -LiteralPath (Join-Path $selected 'players.db') -Value 'player-state' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $selected 'map_1_1.bin') -Value 'world-chunk' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $selected 'mods.txt') -Value 'example-mod' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $other 'must-not-appear.bin') -Value 'other-save' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $cache 'Logs\must-not-appear.log') -Value 'diagnostic' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $cache 'mods\must-not-appear.txt') -Value 'mod-asset' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $cache 'version.txt') -Value '42.21.0' -Encoding UTF8
    $config=[ordered]@{SchemaVersion=1;Version='42.21.0';BuildID='fixture';ManagerRoot=$managerRoot;FreezeRoot=$profile;CachePath=$cache;BackupPath=(Join-Path $profile 'backups')}
    $config|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $managerRoot 'current-freeze.json') -Encoding UTF8

    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $manager -Action BackupSave -ManagerRoot $managerRoot -SavePath $selected -BackupDestination $destination
    if($LASTEXITCODE -ne 0){throw "Backup process exit code: $LASTEXITCODE"}
    $zip=Get-ChildItem -LiteralPath $destination -Filter '*.zip' -File|Select-Object -First 1
    if(-not $zip){throw 'Backup ZIP was not created.'}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($zip.FullName)
    try{$names=@($archive.Entries.FullName)}finally{$archive.Dispose()}
    foreach($required in @('Saves/Sandbox/SelectedSave/players.db','Saves/Sandbox/SelectedSave/map_1_1.bin','Saves/Sandbox/SelectedSave/mods.txt','backup-manifest.json','metadata/version.txt')){
        if($required -notin $names){throw "Backup entry missing: $required"}
    }
    if($names|Where-Object{$_ -match 'OtherSave|must-not-appear'}){throw 'Backup contains out-of-scope content.'}
    if(-not(Test-Path -LiteralPath ($zip.FullName+'.json') -PathType Leaf)){throw 'Backup sidecar JSON is missing.'}
    'BACKUP_FIXTURE_TEST_PASS'
}finally{
    $fixtureFull=[IO.Path]::GetFullPath($fixture)
    $tempRoot=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
    if($fixtureFull.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $fixtureFull)){Remove-Item -LiteralPath $fixtureFull -Recurse -Force -ErrorAction SilentlyContinue}
}
