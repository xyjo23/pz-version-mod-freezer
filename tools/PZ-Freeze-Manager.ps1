[CmdletBinding()]
param(
    [ValidateSet('Detect','Preflight','Create','PreviewMigration','Migrate','RollbackMigration','Verify','Info','Launch','TestLaunch','BackupSave','RestoreSave','ValidateStatic','ViewLog')]
    [string]$Action = 'Info',
    [string]$ManagerRoot,
    [string]$BackupPath,
    [string]$SourceGame,
    [string]$SourceWorkshop,
    [string]$SourceCache,
    [string]$SourceManifest,
    [switch]$ConfirmedExistingTarget,
    [int]$TestSeconds = 45
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Get-TimeStamp { Get-Date -Format 'yyyyMMdd_HHmmss' }

function Write-ManagerLog {
    param([string]$Message, [ValidateSet('INFO','WARN','ERROR','PASS')][string]$Level='INFO')
    $line = '[{0}] [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    if ($script:LogFile) { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 }
}

function Get-SteamInstall {
    $candidates = @(
        (Get-ItemProperty -LiteralPath 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath,
        (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath,
        (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath,
        'C:\Program Files (x86)\Steam',
        'C:\Program Files\Steam'
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
    if (-not $candidates) { throw '未检测到 Steam 安装目录。' }
    [IO.Path]::GetFullPath($candidates[0])
}

function Get-SteamLibraries {
    param([string]$SteamPath)
    $result = New-Object System.Collections.Generic.List[string]
    $result.Add([IO.Path]::GetFullPath($SteamPath))
    $vdf = Join-Path $SteamPath 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $vdf) {
        $raw = Get-Content -LiteralPath $vdf -Raw
        foreach ($m in [regex]::Matches($raw, '(?m)^\s*"path"\s+"([^"]+)"')) {
            $p = $m.Groups[1].Value -replace '\\\\','\'
            if ($p -and (Test-Path -LiteralPath $p)) {
                $full = [IO.Path]::GetFullPath($p)
                if (-not ($result | Where-Object { $_.TrimEnd('\') -ieq $full.TrimEnd('\') })) { $result.Add($full) }
            }
        }
    }
    @($result)
}

function Get-PZEnvironment {
    if ($SourceGame) {
        $game = [IO.Path]::GetFullPath($SourceGame).TrimEnd('\')
        if (-not (Test-Path -LiteralPath $game -PathType Container)) { throw "指定的游戏目录不存在：$game" }
        $common = Split-Path -Parent $game
        $steamApps = Split-Path -Parent $common
        $library = Split-Path -Parent $steamApps
        $manifest = if ($SourceManifest) { [IO.Path]::GetFullPath($SourceManifest) } else { Join-Path $steamApps 'appmanifest_108600.acf' }
        $workshop = if ($SourceWorkshop) { [IO.Path]::GetFullPath($SourceWorkshop).TrimEnd('\') } else { Join-Path $steamApps 'workshop\content\108600' }
        $cache = if ($SourceCache) { [IO.Path]::GetFullPath($SourceCache).TrimEnd('\') } else { Join-Path $env:USERPROFILE 'Zomboid' }
        if (-not (Test-Path -LiteralPath $workshop -PathType Container)) { throw "指定的 Workshop 目录不存在：$workshop" }
        if (-not (Test-Path -LiteralPath $cache -PathType Container)) { throw "指定的缓存/存档目录不存在：$cache" }
        $acf = if (Test-Path -LiteralPath $manifest -PathType Leaf) { Get-Content -LiteralPath $manifest -Raw } else { '' }
        $build = [regex]::Match($acf, '"buildid"\s+"([^"]+)"').Groups[1].Value
        $versionFile = Join-Path $cache 'version.txt'
        if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) { throw "缓存目录缺少 version.txt：$versionFile" }
        $versionText = Get-Content -LiteralPath $versionFile -Raw
        $versionString = ([regex]::Match($versionText, '(?m)^(\d+\.\d+\.\d+)')).Groups[1].Value
        if (-not $versionString) { throw "无法从 $versionFile 识别游戏版本。" }
        $steam = try { Get-SteamInstall } catch { $library }
        return [pscustomobject]@{
            SteamPath=$steam; Library=$library; Manifest=$manifest; Game=$game; Workshop=$workshop; Cache=$cache
            BuildID=if($build){$build}else{'unknown'}; Version=$versionString; FullVersion=$versionText.Trim()
        }
    }

    $steam = Get-SteamInstall
    foreach ($library in @(Get-SteamLibraries $steam)) {
        $manifest = Join-Path $library 'steamapps\appmanifest_108600.acf'
        if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
        $acf = Get-Content -LiteralPath $manifest -Raw
        $installName = [regex]::Match($acf, '"installdir"\s+"([^"]+)"').Groups[1].Value
        $build = [regex]::Match($acf, '"buildid"\s+"([^"]+)"').Groups[1].Value
        $game = Join-Path (Join-Path $library 'steamapps\common') $installName
        $workshop = Join-Path $library 'steamapps\workshop\content\108600'
        $cache = Join-Path $env:USERPROFILE 'Zomboid'
        if ((Test-Path -LiteralPath $game -PathType Container) -and (Test-Path -LiteralPath $workshop -PathType Container)) {
            $versionText = Get-Content -LiteralPath (Join-Path $cache 'version.txt') -Raw
            $versionString = ([regex]::Match($versionText, '(?m)^(\d+\.\d+\.\d+)')).Groups[1].Value
            return [pscustomobject]@{
                SteamPath=$steam; Library=$library; Manifest=$manifest; Game=$game; Workshop=$workshop; Cache=$cache
                BuildID=$build; Version=$versionString; FullVersion=$versionText.Trim()
            }
        }
    }
    throw '未检测到完整的 Project Zomboid (AppID 108600) 安装。'
}

function Get-DirectoryStats {
    param([string]$Path)
    $files = @(Get-ChildItem -LiteralPath $Path -File -Recurse -Force)
    [pscustomobject]@{ Files=$files.Count; Bytes=[int64](($files | Measure-Object Length -Sum).Sum) }
}

function Assert-NoPZProcess {
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -match '^ProjectZomboid64$' -or ($_.ProcessName -eq 'java' -and $_.Path -like '*ProjectZomboid*')
    })
    if ($running) { throw 'Project Zomboid 正在运行。为避免复制变化中的存档，操作已停止。' }
}

function Assert-NoReparsePoints {
    param([string[]]$Roots)
    $links = @()
    foreach ($root in $Roots) {
        $links += @(Get-ChildItem -LiteralPath $root -Force -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue)
    }
    if ($links.Count -gt 0) {
        $sample = ($links | Select-Object -First 10 -ExpandProperty FullName) -join '; '
        throw "源目录包含符号链接/目录联接，不能保证独立性：$sample"
    }
}

function Invoke-Preflight {
    $running=@(Get-Process -ErrorAction SilentlyContinue|Where-Object{$_.ProcessName -match '^ProjectZomboid64$' -or ($_.ProcessName -eq 'java' -and $_.Path -like '*ProjectZomboid*')})
    $envInfo=Get-PZEnvironment
    Assert-NoReparsePoints @($envInfo.Game,$envInfo.Workshop,$envInfo.Cache)
    $gameStats=Get-DirectoryStats $envInfo.Game
    $workshopStats=Get-DirectoryStats $envInfo.Workshop
    $cacheStats=Get-DirectoryStats $envInfo.Cache
    $requiredBytes=[int64](($gameStats.Bytes+$workshopStats.Bytes+$cacheStats.Bytes)*1.15)
    $targetRoot=if($ManagerRoot){[IO.Path]::GetFullPath($ManagerRoot)}else{Join-Path ([IO.Path]::GetPathRoot($envInfo.Game)) 'PZ_Freezer'}
    $driveName=[IO.Path]::GetPathRoot($targetRoot).Substring(0,1)
    $drive=Get-PSDrive -Name $driveName
    $latestMods=$null
    $latestFile=Join-Path $envInfo.Cache 'latestSave.ini'
    if(Test-Path -LiteralPath $latestFile -PathType Leaf){
        $latest=@(Get-Content -LiteralPath $latestFile)
        if($latest.Count -ge 2){
            $candidate=Join-Path $envInfo.Cache ('Saves\{0}\{1}\mods.txt' -f $latest[1],$latest[0])
            if(Test-Path -LiteralPath $candidate -PathType Leaf){$latestMods=$candidate}
        }
    }
    if(-not $latestMods){
        $latestMods=(Get-ChildItem -LiteralPath (Join-Path $envInfo.Cache 'Saves') -Filter mods.txt -File -Recurse -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1).FullName
    }
    $temporaryMods=$false
    if(-not $latestMods){
        $latestMods=Join-Path $env:TEMP ('pz_empty_mods_{0}.txt' -f (Get-TimeStamp))
        Set-Content -LiteralPath $latestMods -Value '' -Encoding UTF8
        $temporaryMods=$true
    }
    try{
        $analyzer=Join-Path $PSScriptRoot 'Analyze-PZMods.ps1'
        $analysis=(& $analyzer -WorkshopRoot $envInfo.Workshop -SaveModsFile $latestMods -GameVersion $envInfo.Version|ConvertFrom-Json)
    }finally{
        if($temporaryMods){Remove-Item -LiteralPath $latestMods -Force -ErrorAction SilentlyContinue}
    }
    $result=[ordered]@{
        Time=(Get-Date).ToString('o');Pass=($running.Count -eq 0 -and $analysis.MissingActive.Count -eq 0 -and $analysis.MissingDependencies.Count -eq 0 -and $drive.Free -ge $requiredBytes)
        GameRunning=($running.Count -gt 0);RunningProcessIds=@($running.Id)
        Environment=$envInfo;GameFiles=$gameStats.Files;WorkshopFiles=$workshopStats.Files;CacheFiles=$cacheStats.Files
        SourceBytes=($gameStats.Bytes+$workshopStats.Bytes+$cacheStats.Bytes);RequiredBytes=$requiredBytes;FreeBytes=[int64]$drive.Free
        WorkshopProjects=$analysis.WorkshopProjectCount;EffectiveMods=$analysis.EffectiveModCount;ActiveMods=$analysis.ActiveModCount
        MissingActive=@($analysis.MissingActive);MissingDependencies=@($analysis.MissingDependencies);TargetRoot=$targetRoot
    }
    if($result.Pass){Write-ManagerLog ('预检通过：预计需要 {0:N2} GiB，目标盘可用 {1:N2} GiB。' -f ($requiredBytes/1GB),($drive.Free/1GB)) 'PASS'}
    elseif($result.GameRunning){Write-ManagerLog '环境检查已完成，但游戏仍在运行；退出游戏后才能创建冻结版本。' 'WARN'}
    else{Write-ManagerLog '预检失败：请检查磁盘空间、缺失 MOD 或依赖。' 'ERROR'}
    [pscustomobject]$result
}

function Invoke-RobocopySafe {
    param([string]$Source, [string]$Destination, [string]$Label)
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "复制源不存在：$Source" }
    if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
    Write-ManagerLog "复制 $Label：$Source -> $Destination"
    $copyLog = Join-Path (Split-Path -Parent $script:LogFile) ('robocopy_{0}_{1}.log' -f ($Label -replace '[^A-Za-z0-9_-]','_'), (Get-TimeStamp))
    & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /MT:16 /XJ /NP /TEE /LOG:$copyLog
    $code = $LASTEXITCODE
    if ($code -ge 8) { throw "Robocopy 复制 $Label 失败，退出码 $code。详见 $copyLog" }
    Write-ManagerLog "复制完成：$Label（Robocopy 退出码 $code）" 'PASS'
}

function Get-CurrentConfig {
    param([string]$Root)
    if (-not $Root) { throw '未指定 ManagerRoot。' }
    $file = Join-Path $Root 'current-freeze.json'
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "没有当前冻结配置：$file" }
    Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
}

function New-HashManifest {
    param([string]$Root, [string]$OutputFile, [string]$Label)
    Write-ManagerLog "生成 SHA-256 清单：$Label"
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $rows = foreach ($file in @(Get-ChildItem -LiteralPath $rootFull -File -Recurse -Force | Where-Object { $_.Name -notlike 'hs_err_pid*.log' -and $_.Name -notlike 'replay_pid*.log' } | Sort-Object FullName)) {
        $relative = $file.FullName.Substring($rootFull.Length).TrimStart('\')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        [pscustomobject]@{ RelativePath=$relative; Length=[int64]$file.Length; SHA256=$hash }
    }
    $rows | Export-Csv -LiteralPath $OutputFile -NoTypeInformation -Encoding UTF8
    Write-ManagerLog "SHA-256 清单完成：$Label，$($rows.Count) 个文件" 'PASS'
    @($rows)
}

function New-MappedWorkshopManifest {
    param([object[]]$CopyMap, [string]$OutputFile)
    Write-ManagerLog '生成 Workshop 源文件映射 SHA-256 清单'
    $rows = foreach ($map in $CopyMap) {
        $sourceFull = [IO.Path]::GetFullPath($map.SourcePath).TrimEnd('\')
        foreach ($file in @(Get-ChildItem -LiteralPath $sourceFull -File -Recurse -Force | Sort-Object FullName)) {
            $inside = $file.FullName.Substring($sourceFull.Length).TrimStart('\')
            $relative = Join-Path $map.DestinationName $inside
            [pscustomobject]@{
                RelativePath=$relative; Length=[int64]$file.Length
                SHA256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            }
        }
    }
    $rows | Sort-Object RelativePath | Export-Csv -LiteralPath $OutputFile -NoTypeInformation -Encoding UTF8
    Write-ManagerLog "Workshop 源清单完成：$($rows.Count) 个文件" 'PASS'
    @($rows)
}

function New-MappedLocalManifest {
    param([object[]]$CopyMap, [string]$OutputFile, [string]$Label='冻结本地 MOD')
    Write-ManagerLog "生成 SHA-256 清单：$Label"
    $rows = foreach ($map in $CopyMap) {
        $destFull = [IO.Path]::GetFullPath($map.DestinationPath).TrimEnd('\')
        foreach ($file in @(Get-ChildItem -LiteralPath $destFull -File -Recurse -Force | Sort-Object FullName)) {
            $inside = $file.FullName.Substring($destFull.Length).TrimStart('\')
            [pscustomobject]@{
                RelativePath=(Join-Path $map.DestinationName $inside); Length=[int64]$file.Length
                SHA256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            }
        }
    }
    $rows | Sort-Object RelativePath | Export-Csv -LiteralPath $OutputFile -NoTypeInformation -Encoding UTF8
    Write-ManagerLog "SHA-256 清单完成：$Label，$($rows.Count) 个文件" 'PASS'
    @($rows)
}

function Compare-ManifestRows {
    param([object[]]$Expected, [object[]]$Actual)
    $exp = @{}; $act = @{}
    foreach ($row in $Expected) { $exp[$row.RelativePath.ToLowerInvariant()] = $row }
    foreach ($row in $Actual) { $act[$row.RelativePath.ToLowerInvariant()] = $row }
    $missing=@();$added=@();$modified=@()
    foreach ($key in $exp.Keys) {
        if (-not $act.ContainsKey($key)) { $missing += $exp[$key].RelativePath; continue }
        if ([int64]$exp[$key].Length -ne [int64]$act[$key].Length -or $exp[$key].SHA256 -ne $act[$key].SHA256) {
            $modified += $exp[$key].RelativePath
        }
    }
    foreach ($key in $act.Keys) { if (-not $exp.ContainsKey($key)) { $added += $act[$key].RelativePath } }
    [pscustomobject]@{ Pass=($missing.Count -eq 0 -and $added.Count -eq 0 -and $modified.Count -eq 0); Missing=$missing; Added=$added; Modified=$modified }
}

function Write-JsonFile {
    param($Object,[string]$Path,[int]$Depth=12)
    $Object | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Set-SafeFrozenMemory {
    param([string]$GamePath,[string]$ReportPath)
    $jsonPath = Join-Path $GamePath 'ProjectZomboid64.json'
    if (-not (Test-Path -LiteralPath $jsonPath -PathType Leaf)) { return $null }
    $raw = [IO.File]::ReadAllText($jsonPath)
    $match = [regex]::Match($raw, '-Xmx(\d+)[mM]')
    if (-not $match.Success) { return $null }
    $physicalMB = [math]::Floor((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
    $recommendedMB = [math]::Floor(($physicalMB * 0.38) / 512) * 512
    $recommendedMB = [math]::Max(4096,[math]::Min(16384,$recommendedMB))
    $originalMB = [int]$match.Groups[1].Value
    $originalHash = (Get-FileHash -LiteralPath $jsonPath -Algorithm SHA256).Hash
    if ($originalMB -gt $recommendedMB) {
        $updated = [regex]::Replace($raw, '-Xmx\d+[mM]', ('-Xmx{0}m' -f $recommendedMB), 1)
        [IO.File]::WriteAllText($jsonPath,$updated,(New-Object System.Text.UTF8Encoding($false)))
    }
    $result = [ordered]@{
        Time=(Get-Date).ToString('o'); PhysicalMemoryMB=$physicalMB; OriginalXmxMB=$originalMB
        RecommendedXmxMB=$recommendedMB; Applied=($originalMB -gt $recommendedMB)
        OriginalSHA256=$originalHash; FinalSHA256=(Get-FileHash -LiteralPath $jsonPath -Algorithm SHA256).Hash
    }
    Write-JsonFile $result (Join-Path $ReportPath ('runtime-memory_{0}.json' -f (Get-TimeStamp)))
    if($result.Applied){Write-ManagerLog "已仅对冻结副本应用安全内存上限：$originalMB MB -> $recommendedMB MB" 'PASS'}
    [pscustomobject]$result
}

function Get-EffectiveLocalModInfo {
    param([System.IO.DirectoryInfo]$ModRoot,[version]$GameVersion)
    $versioned=@()
    foreach($dir in @(Get-ChildItem -LiteralPath $ModRoot.FullName -Directory -ErrorAction SilentlyContinue)){
        if($dir.Name -notmatch '^\d+(?:\.\d+){0,3}$'){continue}
        $versionText=if($dir.Name -match '^\d+$'){$dir.Name+'.0'}else{$dir.Name}
        try{$v=[version]$versionText}catch{continue}
        $info=Join-Path $dir.FullName 'mod.info'
        if($v -le $GameVersion -and (Test-Path -LiteralPath $info -PathType Leaf)){$versioned+=[pscustomobject]@{Version=$v;Path=$info}}
    }
    if($versioned.Count -gt 0){return ($versioned|Sort-Object Version -Descending|Select-Object -First 1).Path}
    foreach($candidate in @((Join-Path $ModRoot.FullName 'common\mod.info'),(Join-Path $ModRoot.FullName 'mod.info'))){
        if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}
    }
    $null
}

function Get-ModInfoId {
    param([string]$InfoPath)
    if(-not $InfoPath){return $null}
    $text=Get-Content -LiteralPath $InfoPath -Raw
    $match=[regex]::Match($text,'(?im)^\s*id\s*=\s*(.*?)\s*$')
    if($match.Success){$match.Groups[1].Value.Trim().Trim("'",'"')}else{$null}
}

function Get-TargetModIds {
    param([string]$ModsRoot,[version]$GameVersion)
    $ids=New-Object System.Collections.Generic.List[string]
    if(Test-Path -LiteralPath $ModsRoot -PathType Container){
        foreach($root in @(Get-ChildItem -LiteralPath $ModsRoot -Directory -ErrorAction SilentlyContinue)){
            $id=Get-ModInfoId (Get-EffectiveLocalModInfo -ModRoot $root -GameVersion $GameVersion)
            if($id -and -not $ids.Contains($id)){$ids.Add($id)}
        }
    }
    @($ids)
}

function Get-SourceModInventory {
    param($Environment,[version]$GameVersion)
    $empty=Join-Path $env:TEMP ('pz_migration_empty_{0}.txt' -f (Get-TimeStamp))
    Set-Content -LiteralPath $empty -Value '' -Encoding UTF8
    try{
        $analyzer=Join-Path $PSScriptRoot 'Analyze-PZMods.ps1'
        (& $analyzer -WorkshopRoot $Environment.Workshop -SaveModsFile $empty -GameVersion $GameVersion|ConvertFrom-Json)
    }finally{Remove-Item -LiteralPath $empty -Force -ErrorAction SilentlyContinue}
}

function Get-MigrationPlan {
    param($Config)
    $envInfo=Get-PZEnvironment
    $targetVersion=[version]$Config.Version
    $targetMods=Join-Path $Config.CachePath 'mods'
    $targetIds=@(Get-TargetModIds -ModsRoot $targetMods -GameVersion $targetVersion)
    $analysis=Get-SourceModInventory -Environment $envInfo -GameVersion $targetVersion
    $sourceInventory=@($analysis.Inventory)
    $rawMissingMods=@($sourceInventory|Where-Object{$_.ModID -and $_.ModID -notin $targetIds})
    $duplicates=@($rawMissingMods|Group-Object ModID|Where-Object Count -gt 1|ForEach-Object{$_.Name})
    $missingMods=@($rawMissingMods|Group-Object ModID|ForEach-Object{$_.Group|Select-Object -First 1}|Sort-Object ModID)
    $availableIds=@($targetIds+@($sourceInventory.ModID)|Where-Object{$_}|Select-Object -Unique)
    $missingDependencies=@()
    foreach($mod in $missingMods){
        foreach($required in @($mod.Requires)){
            if($required -and $required -notin $availableIds){$missingDependencies+=$required}
        }
    }
    $missingDependencies=@($missingDependencies|Select-Object -Unique)
    $sameVersion=([string]$Config.Version -eq [string]$envInfo.Version)
    $sameBuild=($sameVersion -and (($Config.BuildID -eq $envInfo.BuildID) -or $Config.BuildID -eq 'unknown' -or $envInfo.BuildID -eq 'unknown'))
    $gameMissing=New-Object System.Collections.Generic.List[string]
    $gameSizeMismatch=New-Object System.Collections.Generic.List[string]
    if($sameBuild){
        $sourceRoot=[IO.Path]::GetFullPath($envInfo.Game).TrimEnd('\')
        foreach($file in @(Get-ChildItem -LiteralPath $sourceRoot -File -Recurse -Force|Where-Object{$_.Name -notlike 'hs_err_pid*.log' -and $_.Name -notlike 'replay_pid*.log'})){
            $relative=$file.FullName.Substring($sourceRoot.Length).TrimStart('\')
            $dest=Join-Path $Config.GamePath $relative
            if(-not(Test-Path -LiteralPath $dest -PathType Leaf)){$gameMissing.Add($relative)}
            elseif((Get-Item -LiteralPath $dest).Length -ne $file.Length){$gameSizeMismatch.Add($relative)}
        }
    }
    [pscustomobject]@{
        Time=(Get-Date).ToString('o');Environment=$envInfo;TargetProfile=$Config.FreezeRoot
        TargetHasGame=(Test-Path -LiteralPath (Join-Path $Config.GamePath 'ProjectZomboid64.exe') -PathType Leaf)
        TargetHasMods=((Test-Path -LiteralPath $targetMods -PathType Container) -and @(Get-ChildItem -LiteralPath $targetMods -Directory -ErrorAction SilentlyContinue).Count -gt 0)
        TargetGameVersion=$Config.Version;SourceGameVersion=$envInfo.Version;TargetBuildID=$Config.BuildID;SourceBuildID=$envInfo.BuildID
        GameBuildCompatible=$sameBuild;GameMissing=@($gameMissing);GameSizeMismatch=@($gameSizeMismatch)
        TargetModCount=$targetIds.Count;SourceModCount=$sourceInventory.Count;MissingMods=$missingMods
        DuplicateMissingModIds=$duplicates;MissingDependencies=$missingDependencies
        FullIntegrityChecked=$false;ComparisonMode='path-existence-and-size-only'
    }
}

function Backup-MigrationMetadata {
    param($Config,[string]$MigrationDir)
    $before=Join-Path $MigrationDir 'before';New-Item -ItemType Directory -Path $before -Force|Out-Null
    $targets=@(
        (Join-Path $Config.ManifestPath 'game.sha256.csv'),(Join-Path $Config.ManifestPath 'mods.sha256.csv'),
        (Join-Path $Config.FreezeRoot 'metadata\mod-copy-map.csv'),(Join-Path $Config.FreezeRoot 'metadata\mod-inventory.csv'),
        (Join-Path $Config.FreezeRoot 'metadata\freeze.json'),(Join-Path $ManagerRoot 'current-freeze.json')
    )
    $rows=@();$index=0
    foreach($target in $targets){
        $index++;$exists=Test-Path -LiteralPath $target -PathType Leaf;$backup=Join-Path $before (('{0:D2}_' -f $index)+(Split-Path -Leaf $target))
        if($exists){Copy-Item -LiteralPath $target -Destination $backup}
        $rows+=[pscustomobject]@{Target=$target;OriginalExists=$exists;Backup=$backup}
    }
    @($rows)
}

function Restore-MigrationMetadata {
    param([object[]]$Rows,$Config)
    $profileRoot=[IO.Path]::GetFullPath($Config.FreezeRoot).TrimEnd('\')+'\'
    $currentConfig=[IO.Path]::GetFullPath((Join-Path $ManagerRoot 'current-freeze.json'))
    foreach($row in $Rows){
        $target=[IO.Path]::GetFullPath($row.Target)
        if(-not($target.StartsWith($profileRoot,[StringComparison]::OrdinalIgnoreCase) -or $target -ieq $currentConfig)){throw "元数据回迁目标越界：$target"}
        if($row.OriginalExists){
            $backup=Assert-PathInsideProfile $row.Backup $Config.FreezeRoot
            Copy-Item -LiteralPath $backup -Destination $target -Force
        }elseif(Test-Path -LiteralPath $target -PathType Leaf){Remove-Item -LiteralPath $target -Force}
    }
}

function Assert-PathInsideProfile {
    param([string]$Path,[string]$ProfileRoot)
    $full=[IO.Path]::GetFullPath($Path)
    $root=[IO.Path]::GetFullPath($ProfileRoot).TrimEnd('\')+'\'
    if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw "迁移记录包含越界路径：$full"}
    $full
}

function Invoke-IncrementalMigration {
    param($Config)
    Assert-NoPZProcess
    $plan=Get-MigrationPlan $Config
    if(($plan.TargetHasGame -or $plan.TargetHasMods) -and -not $ConfirmedExistingTarget){throw '目标位置已包含游戏或 MOD。必须由用户明确确认后才能增量迁移。'}
    if($plan.DuplicateMissingModIds.Count -gt 0){throw ('来源中存在重复 Mod ID，无法自动选择：'+($plan.DuplicateMissingModIds -join ', '))}
    if($plan.MissingDependencies.Count -gt 0){throw ('缺少 MOD 依赖：'+($plan.MissingDependencies -join ', '))}
    if(-not $plan.GameBuildCompatible){Write-ManagerLog "Steam 游戏版本/BuildID 与冻结版不同；不会混合游戏文件，只迁移兼容 Mod。" 'WARN'}
    Invoke-SaveBackup $Config
    $stamp=Get-TimeStamp;$migrationRoot=Join-Path $Config.FreezeRoot 'migrations';$migrationDir=Join-Path $migrationRoot $stamp
    New-Item -ItemType Directory -Path $migrationDir -Force|Out-Null
    $pointer=Join-Path $migrationRoot 'last-migration.json'
    $previous=if(Test-Path -LiteralPath $pointer -PathType Leaf){(Get-Content -LiteralPath $pointer -Raw|ConvertFrom-Json).MigrationPath}else{$null}
    $metadataBackup=@(Backup-MigrationMetadata -Config $Config -MigrationDir $migrationDir)
    $added=New-Object System.Collections.Generic.List[object]
    $newMaps=New-Object System.Collections.Generic.List[object]
    try{
        foreach($relative in @($plan.GameMissing)){
            $source=Join-Path $plan.Environment.Game $relative;$dest=Join-Path $Config.GamePath $relative
            $parent=Split-Path -Parent $dest;if(-not(Test-Path -LiteralPath $parent)){New-Item -ItemType Directory -Path $parent -Force|Out-Null}
            Copy-Item -LiteralPath $source -Destination $dest
            $file=Get-Item -LiteralPath $dest
            $added.Add([pscustomobject]@{Category='Game';Path=$file.FullName;RelativePath=$relative;ManifestPath=$relative;Length=[int64]$file.Length;SHA256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash})
        }
        foreach($mod in @($plan.MissingMods)){
            $baseName=('WS{0}__{1}' -f $mod.WorkshopID,($mod.ModFolder -replace '[\\/:*?"<>|]','_'))
            $destName=$baseName;$dest=Join-Path (Join-Path $Config.CachePath 'mods') $destName
            if(Test-Path -LiteralPath $dest){$destName=$baseName+'__import_'+$stamp;$dest=Join-Path (Join-Path $Config.CachePath 'mods') $destName}
            Invoke-RobocopySafe $mod.SourcePath $dest ('import_mod_'+$mod.WorkshopID+'_'+$mod.ModFolder)
            $newMaps.Add([pscustomobject]@{WorkshopID=$mod.WorkshopID;SourcePath=$mod.SourcePath;DestinationName=$destName;DestinationPath=$dest})
            $destRoot=[IO.Path]::GetFullPath($dest).TrimEnd('\')
            foreach($file in @(Get-ChildItem -LiteralPath $destRoot -File -Recurse -Force|Sort-Object FullName)){
                $inside=$file.FullName.Substring($destRoot.Length).TrimStart('\')
                $added.Add([pscustomobject]@{Category='Mod';Path=$file.FullName;RelativePath=$file.FullName.Substring([IO.Path]::GetFullPath($Config.FreezeRoot).TrimEnd('\').Length).TrimStart('\');ManifestPath=(Join-Path $destName $inside);Length=[int64]$file.Length;SHA256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash})
            }
        }
        $gameManifest=Join-Path $Config.ManifestPath 'game.sha256.csv';$gameRows=@();if(Test-Path -LiteralPath $gameManifest){$gameRows=@(Import-Csv -LiteralPath $gameManifest)}
        $gameRows+=@($added|Where-Object Category -eq 'Game'|ForEach-Object{[pscustomobject]@{RelativePath=$_.ManifestPath;Length=$_.Length;SHA256=$_.SHA256}})
        $gameRows|Sort-Object RelativePath -Unique|Export-Csv -LiteralPath $gameManifest -NoTypeInformation -Encoding UTF8
        $modsManifest=Join-Path $Config.ManifestPath 'mods.sha256.csv';$modRows=@();if(Test-Path -LiteralPath $modsManifest){$modRows=@(Import-Csv -LiteralPath $modsManifest)}
        $modRows+=@($added|Where-Object Category -eq 'Mod'|ForEach-Object{[pscustomobject]@{RelativePath=$_.ManifestPath;Length=$_.Length;SHA256=$_.SHA256}})
        $modRows|Sort-Object RelativePath -Unique|Export-Csv -LiteralPath $modsManifest -NoTypeInformation -Encoding UTF8
        $mapFile=Join-Path $Config.FreezeRoot 'metadata\mod-copy-map.csv';$maps=@();if(Test-Path -LiteralPath $mapFile){$maps=@(Import-Csv -LiteralPath $mapFile)};$maps+=@($newMaps|ForEach-Object{$_})
        $maps|Export-Csv -LiteralPath $mapFile -NoTypeInformation -Encoding UTF8
        $inventoryFile=Join-Path $Config.FreezeRoot 'metadata\mod-inventory.csv';$inventory=@();if(Test-Path -LiteralPath $inventoryFile){$inventory=@(Import-Csv -LiteralPath $inventoryFile)};$inventory+=@($plan.MissingMods)
        $inventory|Export-Csv -LiteralPath $inventoryFile -NoTypeInformation -Encoding UTF8
        $Config.CopiedModRootCount=@($maps).Count;$Config.EffectiveModCount=@(Get-TargetModIds -ModsRoot (Join-Path $Config.CachePath 'mods') -GameVersion ([version]$Config.Version)).Count
        Write-JsonFile $Config (Join-Path $Config.FreezeRoot 'metadata\freeze.json');Write-JsonFile $Config (Join-Path $ManagerRoot 'current-freeze.json')
        $record=[ordered]@{SchemaVersion=1;Status='Completed';Time=(Get-Date).ToString('o');MigrationPath=(Join-Path $migrationDir 'migration.json');PreviousMigrationPath=$previous;TargetProfile=$Config.FreezeRoot;ComparisonMode=$plan.ComparisonMode;FullIntegrityChecked=$false;GameBuildCompatible=$plan.GameBuildCompatible;GameSizeMismatch=@($plan.GameSizeMismatch);ImportedModIds=@($plan.MissingMods.ModID);AddedFiles=@($added|ForEach-Object{$_});MetadataBackup=@($metadataBackup)}
        Write-JsonFile $record $record.MigrationPath 15;Write-JsonFile ([ordered]@{MigrationPath=$record.MigrationPath}) $pointer
        $report=Join-Path $Config.ReportPath ('migration_{0}.json' -f $stamp);Write-JsonFile $record $report 15
        Write-ManagerLog "增量迁移完成：新增游戏文件 $(@($added|Where-Object Category -eq 'Game').Count) 个，新增 MOD $($plan.MissingMods.Count) 个。" 'PASS'
        [pscustomobject]$record
    }catch{
        foreach($item in @($added|Sort-Object Path -Descending)){if(Test-Path -LiteralPath $item.Path -PathType Leaf){Remove-Item -LiteralPath (Assert-PathInsideProfile $item.Path $Config.FreezeRoot) -Force -ErrorAction SilentlyContinue}}
        Restore-MigrationMetadata $metadataBackup $Config
        throw
    }
}

function Invoke-RollbackLatestMigration {
    param($Config)
    Assert-NoPZProcess
    $pointer=Join-Path $Config.FreezeRoot 'migrations\last-migration.json'
    if(-not(Test-Path -LiteralPath $pointer -PathType Leaf)){throw '没有可回迁的迁移记录。'}
    $migrationPath=Assert-PathInsideProfile (Get-Content -LiteralPath $pointer -Raw|ConvertFrom-Json).MigrationPath $Config.FreezeRoot
    if(-not(Test-Path -LiteralPath $migrationPath -PathType Leaf)){throw "迁移记录不存在：$migrationPath"}
    $record=Get-Content -LiteralPath $migrationPath -Raw|ConvertFrom-Json
    if($record.Status -ne 'Completed'){throw "最近迁移状态不是可回迁状态：$($record.Status)"}
    $conflicts=@()
    foreach($item in @($record.AddedFiles)){
        $path=Assert-PathInsideProfile $item.Path $Config.FreezeRoot
        if(Test-Path -LiteralPath $path -PathType Leaf){
            $hash=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            if($hash -ne $item.SHA256){$conflicts+=$path}
        }
    }
    if($conflicts.Count -gt 0){throw ("回迁已停止：本次新增文件中有 $($conflicts.Count) 个后来被修改。首个冲突：$($conflicts[0])")}
    foreach($item in @($record.AddedFiles|Sort-Object Path -Descending)){
        $path=Assert-PathInsideProfile $item.Path $Config.FreezeRoot
        if(Test-Path -LiteralPath $path -PathType Leaf){Remove-Item -LiteralPath $path -Force}
    }
    Restore-MigrationMetadata @($record.MetadataBackup) $Config
    $record.Status='RolledBack';$record|Add-Member -NotePropertyName RollbackTime -NotePropertyValue (Get-Date).ToString('o') -Force
    Write-JsonFile $record $migrationPath 15
    if($record.PreviousMigrationPath){Write-JsonFile ([ordered]@{MigrationPath=$record.PreviousMigrationPath}) $pointer}else{Remove-Item -LiteralPath $pointer -Force}
    Write-ManagerLog "最近一次增量迁移已回迁：$migrationPath" 'PASS'
    $record
}

function Install-ManagerFiles {
    param([string]$Root)
    $toolDir = Join-Path $Root 'tools'
    if (-not (Test-Path -LiteralPath $toolDir)) { New-Item -ItemType Directory -Path $toolDir -Force | Out-Null }
    $managerDest=Join-Path $toolDir 'PZ-Freeze-Manager.ps1'
    if([IO.Path]::GetFullPath($PSCommandPath) -ine [IO.Path]::GetFullPath($managerDest)){
        Copy-Item -LiteralPath $PSCommandPath -Destination $managerDest -Force
    }
    $analyzer = Join-Path $PSScriptRoot 'Analyze-PZMods.ps1'
    $analyzerDest=Join-Path $toolDir 'Analyze-PZMods.ps1'
    if ((Test-Path -LiteralPath $analyzer) -and ([IO.Path]::GetFullPath($analyzer) -ine [IO.Path]::GetFullPath($analyzerDest))) {
        Copy-Item -LiteralPath $analyzer -Destination $analyzerDest -Force
    }
    $commands = [ordered]@{
        '01-启动冻结版.cmd'='Launch'; '02-校验冻结文件.cmd'='Verify'; '03-查看冻结信息.cmd'='Info'
        '04-备份独立存档.cmd'='BackupSave'; '05-安全恢复存档到新目录.cmd'='RestoreSave'; '06-查看操作日志.cmd'='ViewLog'
    }
    foreach ($name in $commands.Keys) {
        $actionName = $commands[$name]
        $content = "@echo off`r`nchcp 65001 >nul`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0tools\PZ-Freeze-Manager.ps1`" -Action $actionName -ManagerRoot `"%~dp0.`"`r`npause`r`n"
        Set-Content -LiteralPath (Join-Path $Root $name) -Value $content -Encoding ASCII
    }
}

function Invoke-StaticValidation {
    param($Config)
    $freeze = $Config.FreezeRoot
    $game = $Config.GamePath
    $cache = $Config.CachePath
    $issues = New-Object System.Collections.Generic.List[string]
    if ($game -like ($Config.SourceGame.TrimEnd('\') + '*')) { $issues.Add('冻结游戏仍在原始 Steam 游戏目录内。') }
    if ($cache -like ($Config.SourceCache.TrimEnd('\') + '*')) { $issues.Add('冻结缓存仍在原始用户缓存目录内。') }
    if (-not (Test-Path -LiteralPath (Join-Path $game 'ProjectZomboid64.exe'))) { $issues.Add('冻结游戏缺少 ProjectZomboid64.exe。') }
    if (-not (Test-Path -LiteralPath (Join-Path $cache 'Saves'))) { $issues.Add('冻结缓存缺少 Saves。') }
    $links = @(Get-ChildItem -LiteralPath $freeze -Force -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue)
    if ($links) { $issues.Add("冻结目录包含 $($links.Count) 个符号链接/目录联接。") }
    $launcher = Join-Path $ManagerRoot '01-启动冻结版.cmd'
    if (-not (Test-Path -LiteralPath $launcher)) { $issues.Add('缺少启动脚本。') }
    $result = [ordered]@{
        Time=(Get-Date).ToString('o'); Pass=($issues.Count -eq 0); Issues=@($issues)
        GameOutsideSteam=(-not ($game -like ($Config.SourceGame.TrimEnd('\') + '*')))
        CacheIsolated=(-not ($cache -like ($Config.SourceCache.TrimEnd('\') + '*')))
        ReparsePointCount=$links.Count
        LaunchArguments=@('-nosteam',('-cachedir="{0}"' -f $cache))
    }
    $out = Join-Path $Config.ReportPath ('static-validation_{0}.json' -f (Get-TimeStamp))
    Write-JsonFile $result $out
    if ($result.Pass) { Write-ManagerLog '静态隔离验证通过。' 'PASS' } else { Write-ManagerLog ("静态隔离验证失败：" + ($issues -join '; ')) 'ERROR' }
    $result
}

function Invoke-Verify {
    param($Config)
    $gameExpected = @(Import-Csv -LiteralPath (Join-Path $Config.ManifestPath 'game.sha256.csv'))
    $modsExpected = @(Import-Csv -LiteralPath (Join-Path $Config.ManifestPath 'mods.sha256.csv'))
    $tempGame = Join-Path $env:TEMP ('pz_game_verify_{0}.csv' -f (Get-TimeStamp))
    $tempMods = Join-Path $env:TEMP ('pz_mods_verify_{0}.csv' -f (Get-TimeStamp))
    try {
        $gameActual = @(New-HashManifest -Root $Config.GamePath -OutputFile $tempGame -Label '冻结游戏（验证）')
        $copyMap = @(Import-Csv -LiteralPath (Join-Path $Config.FreezeRoot 'metadata\mod-copy-map.csv'))
        $modsActual = @(New-MappedLocalManifest -CopyMap $copyMap -OutputFile $tempMods -Label '冻结 MOD（验证）')
        $gameResult = Compare-ManifestRows $gameExpected $gameActual
        $modsResult = Compare-ManifestRows $modsExpected $modsActual
        $result=[ordered]@{Time=(Get-Date).ToString('o');Pass=($gameResult.Pass -and $modsResult.Pass);Game=$gameResult;Mods=$modsResult}
        $path=Join-Path $Config.ReportPath ('integrity-verify_{0}.json' -f (Get-TimeStamp))
        Write-JsonFile $result $path
        if($result.Pass){Write-ManagerLog "完整性校验通过。报告：$path" 'PASS'}else{Write-ManagerLog "完整性校验失败。报告：$path" 'ERROR'}
        $result
    } finally {
        Remove-Item -LiteralPath $tempGame,$tempMods -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Launch {
    param($Config,[switch]$Testing)
    Assert-NoPZProcess
    $exe = Join-Path $Config.GamePath 'ProjectZomboid64.exe'
    $args = @('-nosteam',('-cachedir={0}' -f $Config.CachePath))
    Write-ManagerLog "启动冻结版：$exe $($args -join ' ')"
    $p = Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $Config.GamePath -PassThru
    if (-not $Testing) { return $p }
    $limit=[Math]::Max(15,$TestSeconds)
    $deadline=(Get-Date).AddSeconds($limit)
    $observed=$null
    while((Get-Date) -lt $deadline){
        Start-Sleep -Seconds 2
        $observed=Get-Process -Id $p.Id -ErrorAction SilentlyContinue
        if(-not $observed){break}
        if($observed.Responding -and ((Get-Date)-$p.StartTime).TotalSeconds -ge 15){break}
    }
    $path = if($observed){$observed.Path}else{$null}
    $cacheConsole=Join-Path $Config.CachePath 'console.txt'
    $consoleText=if(Test-Path -LiteralPath $cacheConsole){Get-Content -LiteralPath $cacheConsole -Raw}else{''}
    $workshopRefs=@([regex]::Matches($consoleText,[regex]::Escape($Config.SourceWorkshop),[Text.RegularExpressions.RegexOptions]::IgnoreCase))
    $loaded=@([regex]::Matches($consoleText,'(?im)>\s*loading\s+(.+?)\.?\s*$')|ForEach-Object{$_.Groups[1].Value.TrimEnd('.') }|Select-Object -Unique)
    $errors=@($consoleText -split "`r?`n" | Where-Object { $_ -match '(?i)ERROR.*(mod|workshop)|required mod.*(missing|not found)|mod.*not found' } | Select-Object -First 100)
    $result=[ordered]@{
        Time=(Get-Date).ToString('o');Started=($null -ne $observed);ProcessId=$p.Id;ProcessPath=$path
        ProcessFromFrozenPath=($path -and $path.StartsWith($Config.GamePath,[StringComparison]::OrdinalIgnoreCase))
        CacheConsoleExists=(Test-Path -LiteralPath $cacheConsole);LoadedModCount=$loaded.Count
        SourceWorkshopReferenceCount=$workshopRefs.Count;RelevantErrors=$errors
    }
    $report=Join-Path $Config.ReportPath ('launch-test_{0}.json' -f (Get-TimeStamp));Write-JsonFile $result $report
    if($observed){
        [void]$observed.CloseMainWindow(); Start-Sleep -Seconds 5
        if(-not $observed.HasExited){ Stop-Process -Id $observed.Id -Force -ErrorAction SilentlyContinue }
    }
    if($result.ProcessFromFrozenPath -and $result.CacheConsoleExists -and $result.SourceWorkshopReferenceCount -eq 0 -and $errors.Count -eq 0){
        Write-ManagerLog "启动测试通过。报告：$report" 'PASS'
    } else { Write-ManagerLog "启动测试存在待核查项。报告：$report" 'WARN' }
    $result
}

function Invoke-SaveBackup {
    param($Config)
    Assert-NoPZProcess
    $stamp=Get-TimeStamp
    $dest=Join-Path $Config.BackupPath ('cache-snapshot_{0}.zip' -f $stamp)
    $stage=Join-Path $Config.FreezeRoot ('work\backup_stage_{0}' -f $stamp)
    New-Item -ItemType Directory -Path $stage -Force|Out-Null
    try {
        foreach($dirName in @('Saves','Lua','Sandbox Presets')){
            $source=Join-Path $Config.CachePath $dirName
            if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $stage $dirName) -Recurse}
        }
        foreach($fileName in @('options.ini','latestSave.ini','version.txt')){
            $source=Join-Path $Config.CachePath $fileName
            if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $stage $fileName)}
        }
        $modsStage=Join-Path $stage 'mods';New-Item -ItemType Directory -Path $modsStage -Force|Out-Null
        foreach($fileName in @('default.txt','reset-mods-42_00.txt')){
            $source=Join-Path $Config.CachePath ('mods\'+$fileName)
            if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $modsStage $fileName)}
        }
        Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $dest -CompressionLevel Optimal
    } finally {
        $resolved=[IO.Path]::GetFullPath($stage)
        if($resolved.StartsWith([IO.Path]::GetFullPath($Config.FreezeRoot),[StringComparison]::OrdinalIgnoreCase)){
            Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    $hash=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    [pscustomobject]@{Backup=$dest;SHA256=$hash;Bytes=(Get-Item -LiteralPath $dest).Length} | ConvertTo-Json | Set-Content -LiteralPath ($dest+'.json') -Encoding UTF8
    Write-ManagerLog "独立缓存/存档备份完成：$dest" 'PASS'
}

function Invoke-SafeRestore {
    param($Config,[string]$SelectedBackup)
    Assert-NoPZProcess
    if(-not $SelectedBackup){$SelectedBackup=(Get-ChildItem -LiteralPath $Config.BackupPath -Filter 'cache-snapshot_*.zip' -File|Sort-Object LastWriteTime -Descending|Select-Object -First 1).FullName}
    if(-not $SelectedBackup -or -not (Test-Path -LiteralPath $SelectedBackup)){throw '没有可恢复的存档备份。'}
    $recovery=Join-Path $Config.FreezeRoot ('recovery\restore_{0}' -f (Get-TimeStamp))
    New-Item -ItemType Directory -Path $recovery -Force|Out-Null
    Expand-Archive -LiteralPath $SelectedBackup -DestinationPath $recovery
    Write-ManagerLog "已安全恢复到新目录（未覆盖当前存档）：$recovery" 'PASS'
}

function Invoke-CreateFreeze {
    Assert-NoPZProcess
    $envInfo = Get-PZEnvironment
    if (-not $ManagerRoot) { $ManagerRoot = Join-Path ([IO.Path]::GetPathRoot($envInfo.Game)) 'PZ_Freeze_Manager' }
    $ManagerRoot = [IO.Path]::GetFullPath($ManagerRoot).TrimEnd('\')
    $steamManagedRoot = Join-Path $envInfo.Library 'steamapps'
    if ($ManagerRoot.StartsWith($steamManagedRoot.TrimEnd('\') + '\',[StringComparison]::OrdinalIgnoreCase) -or $ManagerRoot -ieq $steamManagedRoot) {
        throw 'ManagerRoot 不能位于 Steam 管理的 steamapps 目录内。'
    }
    if (-not (Test-Path -LiteralPath $ManagerRoot)) { New-Item -ItemType Directory -Path $ManagerRoot -Force | Out-Null }
    $logs=Join-Path $ManagerRoot 'logs';New-Item -ItemType Directory -Path $logs -Force|Out-Null
    $script:LogFile=Join-Path $logs ('create_{0}.log' -f (Get-TimeStamp))
    Write-ManagerLog '开始创建 Project Zomboid 文件级冻结环境。'
    Assert-NoReparsePoints @($envInfo.Game,$envInfo.Workshop,$envInfo.Cache)
    $gameStats=Get-DirectoryStats $envInfo.Game;$wsStats=Get-DirectoryStats $envInfo.Workshop;$cacheStats=Get-DirectoryStats $envInfo.Cache
    $need=[int64](($gameStats.Bytes+$wsStats.Bytes+$cacheStats.Bytes)*1.15)
    $drive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($ManagerRoot).Substring(0,1))
    if($drive.Free -lt $need){throw ('磁盘空间不足。预计至少需要 {0:N2} GiB，当前可用 {1:N2} GiB。' -f ($need/1GB),($drive.Free/1GB))}
    $latestMods=$null
    $latestFile=Join-Path $envInfo.Cache 'latestSave.ini'
    if(Test-Path -LiteralPath $latestFile -PathType Leaf){
        $latest=@(Get-Content -LiteralPath $latestFile)
        if($latest.Count -ge 2){
            $candidate=Join-Path $envInfo.Cache ('Saves\{0}\{1}\mods.txt' -f $latest[1],$latest[0])
            if(Test-Path -LiteralPath $candidate -PathType Leaf){$latestMods=$candidate}
        }
    }
    if(-not $latestMods){
        $latestMods=(Get-ChildItem -LiteralPath (Join-Path $envInfo.Cache 'Saves') -Filter mods.txt -File -Recurse -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1).FullName
    }
    if(-not $latestMods){
        $latestMods=Join-Path $logs 'empty-mods.txt'
        Set-Content -LiteralPath $latestMods -Value '' -Encoding UTF8
    }
    $analyzer=Join-Path $PSScriptRoot 'Analyze-PZMods.ps1'
    if(-not(Test-Path -LiteralPath $analyzer)){throw "缺少模组分析器：$analyzer"}
    $analysisJson=& $analyzer -WorkshopRoot $envInfo.Workshop -SaveModsFile $latestMods -GameVersion $envInfo.Version
    $analysis=$analysisJson|ConvertFrom-Json
    if($analysis.MissingActive.Count -gt 0 -or $analysis.MissingDependencies.Count -gt 0){
        throw ('模组预检失败。缺少 Mod ID：{0}；缺少依赖：{1}' -f ($analysis.MissingActive -join ','),($analysis.MissingDependencies -join ','))
    }
    foreach($modsFile in @(Get-ChildItem -LiteralPath (Join-Path $envInfo.Cache 'Saves') -Filter mods.txt -File -Recurse)){
        $check=(& $analyzer -WorkshopRoot $envInfo.Workshop -SaveModsFile $modsFile.FullName -GameVersion $envInfo.Version|ConvertFrom-Json)
        if($check.MissingActive.Count -gt 0 -or $check.MissingDependencies.Count -gt 0){throw "存档模组预检失败：$($modsFile.FullName)"}
    }
    Write-ManagerLog "模组预检通过：$($analysis.WorkshopProjectCount) 个 Workshop 项目，$($analysis.EffectiveModCount) 个有效 Mod ID，最新存档使用 $($analysis.ActiveModCount) 个。" 'PASS'
    $tag='B{0}_build{1}_{2}' -f $envInfo.Version,$envInfo.BuildID,(Get-TimeStamp)
    $freeze=Join-Path (Join-Path $ManagerRoot 'profiles') $tag
    if(Test-Path -LiteralPath $freeze){throw "目标已存在：$freeze"}
    $gameDest=Join-Path $freeze 'game';$cacheDest=Join-Path $freeze 'cache';$meta=Join-Path $freeze 'metadata';$manifests=Join-Path $freeze 'manifests';$reports=Join-Path $freeze 'reports';$backups=Join-Path $freeze 'backups'
    foreach($d in @($gameDest,$cacheDest,$meta,$manifests,$reports,$backups)){New-Item -ItemType Directory -Path $d -Force|Out-Null}
    Invoke-RobocopySafe $envInfo.Game $gameDest 'game'
    Invoke-RobocopySafe $envInfo.Cache $cacheDest 'cache'
    $localMods=Join-Path $cacheDest 'mods'
    $copyMap=@()
    foreach($item in @(Get-ChildItem -LiteralPath $envInfo.Workshop -Directory|Sort-Object Name)){
        $modsDir=Join-Path $item.FullName 'mods';if(-not(Test-Path -LiteralPath $modsDir)){continue}
        foreach($root in @(Get-ChildItem -LiteralPath $modsDir -Directory|Sort-Object Name)){
            $safeName=('WS{0}__{1}' -f $item.Name,($root.Name -replace '[\\/:*?"<>|]','_'))
            $dest=Join-Path $localMods $safeName
            if(Test-Path -LiteralPath $dest){throw "本地 MOD 目标冲突：$dest"}
            Invoke-RobocopySafe $root.FullName $dest ('mod_'+$item.Name+'_'+$root.Name)
            $copyMap += [pscustomobject]@{WorkshopID=$item.Name;SourcePath=$root.FullName;DestinationName=$safeName;DestinationPath=$dest}
        }
    }
    $analysis.Inventory|Export-Csv -LiteralPath (Join-Path $meta 'mod-inventory.csv') -NoTypeInformation -Encoding UTF8
    $copyMap|Export-Csv -LiteralPath (Join-Path $meta 'mod-copy-map.csv') -NoTypeInformation -Encoding UTF8
    $saveUsage=foreach($mf in @(Get-ChildItem -LiteralPath (Join-Path $envInfo.Cache 'Saves') -Filter mods.txt -File -Recurse)){
        $txt=Get-Content -LiteralPath $mf.FullName -Raw
        foreach($m in [regex]::Matches($txt,'(?im)^\s*mod\s*=\s*(.+?),\s*$')){[pscustomobject]@{SaveModsFile=$mf.FullName;ModID=$m.Groups[1].Value.Trim()}}
    }
    $saveUsage|Export-Csv -LiteralPath (Join-Path $meta 'save-mod-usage.csv') -NoTypeInformation -Encoding UTF8
    Copy-Item -LiteralPath $envInfo.Manifest -Destination (Join-Path $meta 'appmanifest_108600.original.acf')
    Get-Content -LiteralPath (Join-Path $envInfo.Cache 'version.txt') -Raw|Set-Content -LiteralPath (Join-Path $meta 'game-version.txt') -Encoding UTF8
    $sourceGame=New-HashManifest $envInfo.Game (Join-Path $meta 'source-game.sha256.csv') 'Steam 原始游戏'
    $frozenGame=New-HashManifest $gameDest (Join-Path $manifests 'game.sha256.csv') '冻结游戏'
    $sourceMods=New-MappedWorkshopManifest $copyMap (Join-Path $meta 'source-mods.sha256.csv')
    $frozenMods=New-MappedLocalManifest $copyMap (Join-Path $manifests 'mods.sha256.csv') '冻结本地 MOD'
    $gameCopyResult=Compare-ManifestRows $sourceGame $frozenGame;$modCopyResult=Compare-ManifestRows $sourceMods $frozenMods
    if(-not $gameCopyResult.Pass -or -not $modCopyResult.Pass){throw '复制前后 SHA-256 不一致，冻结创建已停止。原始数据未改动。'}
    Write-ManagerLog '复制前后 SHA-256 完全一致。' 'PASS'
    $memory=Set-SafeFrozenMemory -GamePath $gameDest -ReportPath $reports
    if($memory -and $memory.Applied){
        $jsonRow=$frozenGame|Where-Object {$_.RelativePath -ieq 'ProjectZomboid64.json'}|Select-Object -First 1
        if($jsonRow){
            $jsonFile=Get-Item -LiteralPath (Join-Path $gameDest 'ProjectZomboid64.json')
            $jsonRow.Length=[int64]$jsonFile.Length
            $jsonRow.SHA256=(Get-FileHash -LiteralPath $jsonFile.FullName -Algorithm SHA256).Hash
            $frozenGame|Export-Csv -LiteralPath (Join-Path $manifests 'game.sha256.csv') -NoTypeInformation -Encoding UTF8
        }
    }
    $config=[ordered]@{
        SchemaVersion=1;Created=(Get-Date).ToString('o');Version=$envInfo.Version;FullVersion=$envInfo.FullVersion;BuildID=$envInfo.BuildID
        ManagerRoot=$ManagerRoot;FreezeRoot=$freeze;GamePath=$gameDest;CachePath=$cacheDest;ManifestPath=$manifests;ReportPath=$reports;BackupPath=$backups
        SourceGame=$envInfo.Game;SourceWorkshop=$envInfo.Workshop;SourceCache=$envInfo.Cache;SourceSteamManifest=$envInfo.Manifest
        WorkshopProjectCount=$analysis.WorkshopProjectCount;EffectiveModCount=$analysis.EffectiveModCount;LatestSaveActiveModCount=$analysis.ActiveModCount
        CopiedModRootCount=$copyMap.Count;LaunchArguments=@('-nosteam',('-cachedir="{0}"' -f $cacheDest));MemoryTuning=$memory
    }
    Write-JsonFile $config (Join-Path $meta 'freeze.json');Write-JsonFile $config (Join-Path $ManagerRoot 'current-freeze.json')
    Install-ManagerFiles $ManagerRoot
    $script:ManagerRoot=$ManagerRoot
    $static=Invoke-StaticValidation ([pscustomobject]$config)
    if(-not $static.Pass){throw '静态隔离验证失败。'}
    Invoke-SaveBackup ([pscustomobject]$config)
    $summary=[ordered]@{Environment=$envInfo;SourceStats=@{Game=$gameStats;Workshop=$wsStats;Cache=$cacheStats};Config=$config;CopyVerification=@{Game=$gameCopyResult;Mods=$modCopyResult};MemoryTuning=$memory;StaticValidation=$static}
    Write-JsonFile $summary (Join-Path $reports 'creation-summary.json') 15
    Write-ManagerLog "冻结环境创建完成：$freeze" 'PASS'
    [pscustomobject]$config
}

if($Action -eq 'Detect'){
    Get-PZEnvironment | ConvertTo-Json -Depth 6
    exit 0
}

if($Action -eq 'Preflight'){
    if(-not $ManagerRoot){$ManagerRoot=$PSScriptRoot|Split-Path -Parent}
    $logDir=Join-Path $ManagerRoot 'logs';if(-not(Test-Path -LiteralPath $logDir)){New-Item -ItemType Directory -Path $logDir -Force|Out-Null}
    $script:LogFile=Join-Path $logDir ('preflight_{0}.log' -f (Get-TimeStamp))
    Invoke-Preflight|ConvertTo-Json -Depth 12
    exit 0
}

if (-not $ManagerRoot -and $Action -ne 'Create') {
    $candidate = Split-Path -Parent $PSScriptRoot
    if (Test-Path -LiteralPath (Join-Path $candidate 'current-freeze.json')) { $ManagerRoot=$candidate }
}

switch ($Action) {
    'Create' { $config=Invoke-CreateFreeze; $config|Format-List }
    default {
        $ManagerRoot=[IO.Path]::GetFullPath($ManagerRoot).TrimEnd('\')
        $logDir=Join-Path $ManagerRoot 'logs';if(-not(Test-Path -LiteralPath $logDir)){New-Item -ItemType Directory -Path $logDir -Force|Out-Null}
        $script:LogFile=Join-Path $logDir ('{0}_{1}.log' -f $Action.ToLowerInvariant(),(Get-TimeStamp))
        $config=Get-CurrentConfig $ManagerRoot
        switch($Action){
            'PreviewMigration' {$plan=Get-MigrationPlan $config;Write-ManagerLog "快速迁移检查：缺失游戏文件 $($plan.GameMissing.Count)，大小不一致 $($plan.GameSizeMismatch.Count)，缺失 MOD $($plan.MissingMods.Count)。"; $plan|ConvertTo-Json -Depth 12}
            'Migrate' {[void](Invoke-IncrementalMigration $config)}
            'RollbackMigration' {[void](Invoke-RollbackLatestMigration $config)}
            'Verify' {[void](Invoke-Verify $config)}
            'Info' {$config|Format-List;Write-ManagerLog "冻结目录：$($config.FreezeRoot)"}
            'Launch' {[void](Invoke-Launch $config)}
            'TestLaunch' {[void](Invoke-Launch $config -Testing)}
            'BackupSave' {Invoke-SaveBackup $config}
            'RestoreSave' {Invoke-SafeRestore $config $BackupPath}
            'ValidateStatic' {[void](Invoke-StaticValidation $config)}
            'ViewLog' {Start-Process explorer.exe -ArgumentList $logDir}
        }
    }
}
