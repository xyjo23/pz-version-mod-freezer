[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $PSCommandPath))).TrimEnd('\')
$manager=Join-Path $projectRoot 'tools\PZ-Freeze-Manager.ps1'
$tempBase=Join-Path ([IO.Path]::GetTempPath()) ('PZFreezerMigrationTest_'+[guid]::NewGuid().ToString('N'))
$tempFull=[IO.Path]::GetFullPath($tempBase)
$tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')+'\'
if(-not $tempFull.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe test path: $tempFull"}

function New-Dir([string]$Path){New-Item -ItemType Directory -Path $Path -Force|Out-Null}
function Write-TestFile([string]$Path,[string]$Value){New-Dir (Split-Path -Parent $Path);Set-Content -LiteralPath $Path -Value $Value -Encoding UTF8}

try{
    $sourceGame=Join-Path $tempBase 'source\steamapps\common\ProjectZomboid'
    $sourceWorkshop=Join-Path $tempBase 'source\steamapps\workshop\content\108600'
    $sourceCache=Join-Path $tempBase 'source-cache'
    $managerRoot=Join-Path $tempBase 'manager'
    $profile=Join-Path $tempBase 'target-profile'
    $game=Join-Path $profile 'game';$cache=Join-Path $profile 'cache';$manifests=Join-Path $profile 'manifests'
    $metadata=Join-Path $profile 'metadata';$reports=Join-Path $profile 'reports';$backups=Join-Path $profile 'backups'
    foreach($dir in @($sourceGame,$sourceWorkshop,$sourceCache,$managerRoot,$game,$cache,$manifests,$metadata,$reports,$backups,(Join-Path $managerRoot 'logs'))){New-Dir $dir}

    Write-TestFile (Join-Path $sourceGame 'ProjectZomboid64.exe') 'fixture-exe'
    Write-TestFile (Join-Path $sourceGame 'media\missing-game-file.txt') 'missing-game-content'
    Write-TestFile (Join-Path $game 'ProjectZomboid64.exe') 'fixture-exe'
    Write-TestFile (Join-Path $sourceCache 'version.txt') "42.21.0 fixture`nrevision=test"
    Write-TestFile (Join-Path $cache 'version.txt') "42.21.0 fixture`nrevision=test"
    Write-TestFile (Join-Path $cache 'options.ini') 'fixture=true'
    New-Dir (Join-Path $cache 'Saves')

    $existingRoot=Join-Path $cache 'mods\ExistingMod'
    Write-TestFile (Join-Path $existingRoot '42\mod.info') "name=Existing Mod`nid=existing_mod"
    Write-TestFile (Join-Path $existingRoot '42\media\existing.txt') 'existing'
    $sourceMod=Join-Path $sourceWorkshop '123456\mods\TestMod'
    Write-TestFile (Join-Path $sourceMod '42\mod.info') "name=Test Mod`nid=test_mod"
    Write-TestFile (Join-Path $sourceMod '42\media\test.txt') 'new-mod-content'

    $gameExe=Get-Item -LiteralPath (Join-Path $game 'ProjectZomboid64.exe')
    @([pscustomobject]@{RelativePath='ProjectZomboid64.exe';Length=[int64]$gameExe.Length;SHA256=(Get-FileHash -LiteralPath $gameExe.FullName -Algorithm SHA256).Hash})|
        Export-Csv -LiteralPath (Join-Path $manifests 'game.sha256.csv') -NoTypeInformation -Encoding UTF8
    $existingFiles=@(Get-ChildItem -LiteralPath $existingRoot -File -Recurse|ForEach-Object{
        $inside=$_.FullName.Substring([IO.Path]::GetFullPath($existingRoot).TrimEnd('\').Length).TrimStart('\')
        [pscustomobject]@{RelativePath=(Join-Path 'ExistingMod' $inside);Length=[int64]$_.Length;SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
    })
    $existingFiles|Export-Csv -LiteralPath (Join-Path $manifests 'mods.sha256.csv') -NoTypeInformation -Encoding UTF8
    @([pscustomobject]@{WorkshopID='fixture';SourcePath=$existingRoot;DestinationName='ExistingMod';DestinationPath=$existingRoot})|
        Export-Csv -LiteralPath (Join-Path $metadata 'mod-copy-map.csv') -NoTypeInformation -Encoding UTF8
    @([pscustomobject]@{WorkshopID='fixture';ModFolder='ExistingMod';ModID='existing_mod';ModName='Existing Mod';SourcePath=$existingRoot})|
        Export-Csv -LiteralPath (Join-Path $metadata 'mod-inventory.csv') -NoTypeInformation -Encoding UTF8

    $config=[ordered]@{SchemaVersion=1;Created=(Get-Date).ToString('o');Version='42.21.0';FullVersion='42.21.0 fixture';BuildID='unknown';ManagerRoot=$managerRoot;FreezeRoot=$profile;GamePath=$game;CachePath=$cache;ManifestPath=$manifests;ReportPath=$reports;BackupPath=$backups;SourceGame=$sourceGame;SourceWorkshop=$sourceWorkshop;SourceCache=$sourceCache;SourceSteamManifest='';WorkshopProjectCount=1;EffectiveModCount=1;LatestSaveActiveModCount=0;CopiedModRootCount=1;LaunchArguments=@('-nosteam',('-cachedir="{0}"' -f $cache))}
    $config|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $metadata 'freeze.json') -Encoding UTF8
    $config|ConvertTo-Json -Depth 12|Set-Content -LiteralPath (Join-Path $managerRoot 'current-freeze.json') -Encoding UTF8

    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $manager -Action Migrate -ManagerRoot $managerRoot -SourceGame $sourceGame -SourceWorkshop $sourceWorkshop -SourceCache $sourceCache -ConfirmedExistingTarget
    if($LASTEXITCODE -ne 0){throw "Fixture migration failed: $LASTEXITCODE"}
    $addedGame=Join-Path $game 'media\missing-game-file.txt'
    $addedMod=Get-ChildItem -LiteralPath (Join-Path $cache 'mods') -Filter test.txt -File -Recurse|Select-Object -First 1
    $pointer=Join-Path $profile 'migrations\last-migration.json'
    if(-not(Test-Path -LiteralPath $addedGame -PathType Leaf)){throw 'Missing game file was not migrated.'}
    if(-not $addedMod){throw 'Missing mod was not migrated.'}
    if(-not(Test-Path -LiteralPath $pointer -PathType Leaf)){throw 'Migration pointer was not created.'}

    Set-Content -LiteralPath $addedGame -Value 'changed-after-migration' -Encoding UTF8
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $manager -Action RollbackMigration -ManagerRoot $managerRoot
    if($LASTEXITCODE -eq 0){throw 'Rollback should have stopped after an imported file changed.'}
    if(-not(Test-Path -LiteralPath $addedGame -PathType Leaf)){throw 'Conflict rollback deleted a changed file.'}
    if(-not(Test-Path -LiteralPath $pointer -PathType Leaf)){throw 'Conflict rollback removed the migration pointer.'}
    Copy-Item -LiteralPath (Join-Path $sourceGame 'media\missing-game-file.txt') -Destination $addedGame -Force

    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $manager -Action RollbackMigration -ManagerRoot $managerRoot
    if($LASTEXITCODE -ne 0){throw "Fixture rollback failed: $LASTEXITCODE"}
    if(Test-Path -LiteralPath $addedGame -PathType Leaf){throw 'Migrated game file remained after rollback.'}
    if(Test-Path -LiteralPath $addedMod.FullName -PathType Leaf){throw 'Migrated mod file remained after rollback.'}
    if(Test-Path -LiteralPath $pointer -PathType Leaf){throw 'Latest migration pointer remained after rollback.'}
    if(-not(Test-Path -LiteralPath (Join-Path $existingRoot '42\media\existing.txt') -PathType Leaf)){throw 'Existing mod content was damaged.'}
    'MIGRATION_FIXTURE_TEST_PASS'
}finally{
    if((Test-Path -LiteralPath $tempFull) -and $tempFull.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase)){
        Remove-Item -LiteralPath $tempFull -Recurse -Force
    }
}
