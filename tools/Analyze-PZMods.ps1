param(
    [Parameter(Mandatory=$true)][string]$WorkshopRoot,
    [Parameter(Mandatory=$true)][string]$SaveModsFile,
    [Parameter(Mandatory=$true)][version]$GameVersion
)

$ErrorActionPreference = 'Stop'

function Get-InfoValues {
    param([string]$Text, [string]$Key)
    $pattern = '(?im)^\s*' + [regex]::Escape($Key) + '\s*=\s*(.*?)\s*$'
    @([regex]::Matches($Text, $pattern) | ForEach-Object {
        $_.Groups[1].Value.Trim().Trim("'", '"')
    })
}

function Split-InfoList {
    param([string[]]$Values)
    @($Values | ForEach-Object {
        $_ -split ',' | ForEach-Object {
            $_.Trim().TrimStart('\').Trim().Trim("'", '"')
        }
    } | Where-Object { $_ } | Select-Object -Unique)
}

function Read-ModInfo {
    param([System.IO.FileInfo]$File)
    $text = Get-Content -LiteralPath $File.FullName -Raw
    $ids = @(Get-InfoValues -Text $text -Key 'id')
    if ($ids.Count -eq 0) { return $null }
    [pscustomobject]@{
        ID         = $ids[0]
        Name       = @(Get-InfoValues -Text $text -Key 'name')[0]
        Requires   = @(Split-InfoList (Get-InfoValues -Text $text -Key 'require'))
        LoadAfter  = @(Split-InfoList (Get-InfoValues -Text $text -Key 'loadModAfter'))
        LoadBefore = @(Split-InfoList (Get-InfoValues -Text $text -Key 'loadModBefore'))
        VersionMin = (Get-InfoValues -Text $text -Key 'versionMin' | Select-Object -First 1)
        InfoPath   = $File.FullName
    }
}

function Get-EffectiveInfoFile {
    param([System.IO.DirectoryInfo]$ModRoot, [version]$CurrentVersion)
    $versioned = @()
    foreach ($dir in @(Get-ChildItem -LiteralPath $ModRoot.FullName -Directory -ErrorAction SilentlyContinue)) {
        if ($dir.Name -notmatch '^\d+(?:\.\d+){0,3}$') { continue }
        $versionText = if ($dir.Name -match '^\d+$') { $dir.Name + '.0' } else { $dir.Name }
        try { $v = [version]$versionText } catch { continue }
        $info = Join-Path $dir.FullName 'mod.info'
        if ($v -le $CurrentVersion -and (Test-Path -LiteralPath $info -PathType Leaf)) {
            $versioned += [pscustomobject]@{ Version=$v; File=(Get-Item -LiteralPath $info) }
        }
    }
    if ($versioned.Count -gt 0) {
        return ($versioned | Sort-Object Version -Descending | Select-Object -First 1).File
    }
    $commonInfo = Join-Path $ModRoot.FullName 'common\mod.info'
    if (Test-Path -LiteralPath $commonInfo -PathType Leaf) { return Get-Item -LiteralPath $commonInfo }
    $rootInfo = Join-Path $ModRoot.FullName 'mod.info'
    if (Test-Path -LiteralPath $rootInfo -PathType Leaf) { return Get-Item -LiteralPath $rootInfo }
    return $null
}

$rows = @()
foreach ($item in @(Get-ChildItem -LiteralPath $WorkshopRoot -Directory | Sort-Object Name)) {
    $modsDir = Join-Path $item.FullName 'mods'
    if (-not (Test-Path -LiteralPath $modsDir -PathType Container)) { continue }
    $workshopText = ''
    $workshopFile = Join-Path $item.FullName 'workshop.txt'
    if (Test-Path -LiteralPath $workshopFile) { $workshopText = Get-Content -LiteralPath $workshopFile -Raw }
    $workshopTitle = @(Get-InfoValues -Text $workshopText -Key 'title')[0]
    foreach ($modRoot in @(Get-ChildItem -LiteralPath $modsDir -Directory | Sort-Object Name)) {
        $effective = Get-EffectiveInfoFile -ModRoot $modRoot -CurrentVersion $GameVersion
        if (-not $effective) { continue }
        $meta = Read-ModInfo -File $effective
        if (-not $meta) { continue }
        $versionFolder = Split-Path -Leaf (Split-Path -Parent $effective.FullName)
        if ($versionFolder -eq $modRoot.Name) { $versionFolder = 'root' }
        $rows += [pscustomobject]@{
            WorkshopID   = $item.Name
            WorkshopName = $workshopTitle
            ModFolder    = $modRoot.Name
            ModID        = $meta.ID
            ModName      = $meta.Name
            VersionDir   = $versionFolder
            VersionMin   = $meta.VersionMin
            Requires     = @($meta.Requires)
            LoadAfter    = @($meta.LoadAfter)
            LoadBefore   = @($meta.LoadBefore)
            SourcePath   = $modRoot.FullName
            ModInfoPath  = $meta.InfoPath
        }
    }
}

$saveText = Get-Content -LiteralPath $SaveModsFile -Raw
$active = @([regex]::Matches($saveText, '(?im)^\s*mod\s*=\s*(.+?),\s*$') | ForEach-Object {
    $_.Groups[1].Value.Trim()
})
$byId = @{}
foreach ($row in $rows) {
    if (-not $byId.ContainsKey($row.ModID)) { $byId[$row.ModID] = @() }
    $byId[$row.ModID] += $row
}
$missingActive = @($active | Where-Object { -not $byId.ContainsKey($_) } | Select-Object -Unique)
$required = @()
foreach ($id in $active) {
    if ($byId.ContainsKey($id)) {
        foreach ($row in $byId[$id]) { $required += @($row.Requires) }
    }
}
$required = @($required | Where-Object { $_ } | Select-Object -Unique)
$missingDependencies = @($required | Where-Object { -not $byId.ContainsKey($_) } | Select-Object -Unique)
$inactiveDependencies = @($required | Where-Object { $_ -notin $active } | Select-Object -Unique)
$duplicates = @($rows | Group-Object ModID | Where-Object Count -gt 1 | ForEach-Object {
    [pscustomobject]@{ ModID=$_.Name; Count=$_.Count; WorkshopIDs=@($_.Group.WorkshopID | Select-Object -Unique) }
})

$result = [ordered]@{
    GameVersion          = $GameVersion.ToString()
    WorkshopProjectCount = @(Get-ChildItem -LiteralPath $WorkshopRoot -Directory).Count
    EffectiveModCount    = $rows.Count
    ActiveModCount       = $active.Count
    MissingActive        = $missingActive
    RequiredModCount     = $required.Count
    MissingDependencies  = $missingDependencies
    InactiveDependencies = $inactiveDependencies
    DuplicateModIDs      = $duplicates
    ActiveMods           = $active
    Inventory            = $rows
}
$result | ConvertTo-Json -Depth 10
