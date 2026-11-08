[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $PSCommandPath))).TrimEnd('\')
$fixture=Join-Path $env:TEMP ('PZFreezerLibraryTest_'+[guid]::NewGuid().ToString('N'))
$app=Join-Path $fixture 'app'
$library=Join-Path $fixture 'library'

try{
    New-Item -ItemType Directory -Path $app,$library,(Join-Path $app 'profiles') -Force|Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot 'PZ-Freezer.ps1'),(Join-Path $projectRoot 'README.md') -Destination $app
    Copy-Item -LiteralPath (Join-Path $projectRoot 'tools') -Destination (Join-Path $app 'tools') -Recurse
    foreach($spec in @(@{Name='B42_A';Version='42.21.0';Build='100';Healthy=$true},@{Name='B41_B';Version='41.78.16';Build='200';Healthy=$false})){
        $profile=Join-Path $library $spec.Name
        $metadata=Join-Path $profile 'metadata'
        New-Item -ItemType Directory -Path $metadata -Force|Out-Null
        if($spec.Healthy){
            New-Item -ItemType Directory -Path (Join-Path $profile 'game'),(Join-Path $profile 'cache'),(Join-Path $profile 'manifests') -Force|Out-Null
            Set-Content -LiteralPath (Join-Path $profile 'game\ProjectZomboid64.exe') -Value 'fixture' -Encoding ASCII
            Set-Content -LiteralPath (Join-Path $profile 'manifests\game.sha256.csv') -Value 'RelativePath,Length,SHA256' -Encoding ASCII
        }
        $config=[ordered]@{SchemaVersion=1;Created=(Get-Date).ToString('o');Version=$spec.Version;BuildID=$spec.Build;FreezeRoot=$profile;GamePath=(Join-Path $profile 'game');CachePath=(Join-Path $profile 'cache');ManifestPath=(Join-Path $profile 'manifests');ReportPath=(Join-Path $profile 'reports');BackupPath=(Join-Path $profile 'backups');EffectiveModCount=3}
        $config|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $metadata 'freeze.json') -Encoding UTF8
    }
    [ordered]@{SchemaVersion=1;Updated=(Get-Date).ToString('o');LibraryRoots=@($library)}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $app 'version-library.json') -Encoding UTF8
    & powershell.exe -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $app 'PZ-Freezer.ps1') -SelfTest -SelfTestExpectedProfileCount 2 -SelfTestSelectFirstProfile
    if($LASTEXITCODE -ne 0){throw "Library fixture exit code: $LASTEXITCODE"}
    'LIBRARY_FIXTURE_TEST_PASS'
}finally{
    $fixtureFull=[IO.Path]::GetFullPath($fixture)
    $tempRoot=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\')+'\'
    if($fixtureFull.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $fixtureFull)){Remove-Item -LiteralPath $fixtureFull -Recurse -Force -ErrorAction SilentlyContinue}
}
