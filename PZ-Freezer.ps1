[CmdletBinding()]
param([switch]$SelfTest,[string]$SelfTestProfilePath,[string]$SelfTestTargetPath,[ValidateSet('Full','Incremental','Invalid')][string]$SelfTestExpectedTargetMode,[string]$SelfTestLibraryRoot,[int]$SelfTestExpectedProfileCount=-1,[switch]$SelfTestSelectFirstProfile,[string]$SelfTestScreenshotPath,[ValidateSet('Migration','Backup')][string]$SelfTestMode='Migration')

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Windows.Forms

$script:AppRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath)).TrimEnd('\')
$script:Manager = Join-Path $script:AppRoot 'tools\PZ-Freeze-Manager.ps1'
$script:LibraryFile = Join-Path $script:AppRoot 'version-library.json'
$script:Job = $null

if(-not(Test-Path -LiteralPath $script:Manager -PathType Leaf)){
    [System.Windows.MessageBox]::Show("缺少核心文件：$script:Manager",'PZ Version & Mod Freezer','OK','Error')|Out-Null
    exit 1
}

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="PZ Version &amp; Mod Freezer" Width="1080" Height="1040"
        MinWidth="940" MinHeight="900" WindowStartupLocation="CenterScreen"
        Background="#111820" FontFamily="Microsoft YaHei UI">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Padding" Value="14,7"/><Setter Property="Margin" Value="4"/>
      <Setter Property="MinHeight" Value="34"/><Setter Property="Cursor" Value="Hand"/>
    </Style>
    <Style TargetType="TextBox">
      <Setter Property="Padding" Value="8,6"/><Setter Property="Margin" Value="4"/><Setter Property="Background" Value="#F7FFFFFF"/>
    </Style>
    <Style TargetType="ComboBox">
      <Setter Property="Padding" Value="8,5"/><Setter Property="Margin" Value="4"/><Setter Property="MinHeight" Value="34"/>
    </Style>
    <Style TargetType="GroupBox">
      <Setter Property="Margin" Value="8,5"/><Setter Property="Padding" Value="10"/><Setter Property="Background" Value="#E8F4F6F8"/>
      <Setter Property="FontWeight" Value="SemiBold"/><Setter Property="Foreground" Value="#16222D"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="GroupBox">
            <Grid>
              <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
              <Border Grid.Row="1" Background="{TemplateBinding Background}" CornerRadius="6" Padding="{TemplateBinding Padding}"><ContentPresenter Content="{TemplateBinding Content}"/></Border>
              <Border Grid.Row="0" Background="#F2F4F6F8" CornerRadius="5,5,0,0" Padding="10,4" Margin="12,0,0,-1" HorizontalAlignment="Left"><ContentPresenter Content="{TemplateBinding Header}"/></Border>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>
  <Grid Background="#EEF1F4" Margin="0">
    <Grid Margin="14">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <Border Grid.Row="0" Background="#E5222F3B" CornerRadius="8" Padding="18" Margin="8,4,8,8">
        <Grid>
          <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
          <StackPanel>
            <TextBlock Text="PZ Version &amp; Mod Freezer" Foreground="White" FontSize="24" FontWeight="SemiBold"/>
            <TextBlock Text="版本、MOD 与存档的独立冻结工具" Foreground="#D7E2EC" Margin="0,6,0,0"/>
          </StackPanel>
          <Border Grid.Column="1" Background="#2F9E72" CornerRadius="14" Padding="12,5" VerticalAlignment="Center">
            <TextBlock x:Name="StatusText" Text="准备就绪" Foreground="White" FontWeight="SemiBold"/>
          </Border>
        </Grid>
      </Border>

      <GroupBox Grid.Row="1" Header="1. Steam / Project Zomboid 来源">
        <Grid>
          <Grid.ColumnDefinitions><ColumnDefinition Width="120"/><ColumnDefinition Width="*"/><ColumnDefinition Width="86"/></Grid.ColumnDefinitions>
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
          <TextBlock Grid.Row="0" VerticalAlignment="Center" Text="游戏本体"/><TextBox Grid.Row="0" Grid.Column="1" x:Name="GamePathBox"/><Button Grid.Row="0" Grid.Column="2" x:Name="BrowseGameButton" Content="选择"/>
          <TextBlock Grid.Row="1" VerticalAlignment="Center" Text="Workshop"/><TextBox Grid.Row="1" Grid.Column="1" x:Name="WorkshopPathBox"/><Button Grid.Row="1" Grid.Column="2" x:Name="BrowseWorkshopButton" Content="选择"/>
          <TextBlock Grid.Row="2" VerticalAlignment="Center" Text="缓存/存档"/><TextBox Grid.Row="2" Grid.Column="1" x:Name="CachePathBox"/><Button Grid.Row="2" Grid.Column="2" x:Name="BrowseCacheButton" Content="选择"/>
          <TextBlock Grid.Row="3" VerticalAlignment="Center" Text="工具目录"/><TextBox Grid.Row="3" Grid.Column="1" x:Name="RootPathBox" IsReadOnly="True" Background="#EEF1F4"/><Button Grid.Row="3" Grid.Column="2" x:Name="DetectButton" Content="自动检测"/>
        </Grid>
      </GroupBox>

      <GroupBox Grid.Row="2" Header="2. 版本库与迁移位置">
        <Grid>
          <Grid.ColumnDefinitions><ColumnDefinition Width="120"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
          <TextBlock Grid.Row="0" VerticalAlignment="Center" Text="版本库"/>
          <ComboBox Grid.Row="0" Grid.Column="1" x:Name="ProfilesBox" DisplayMemberPath="Display"/>
          <StackPanel Grid.Row="0" Grid.Column="2" Orientation="Horizontal"><Button x:Name="LaunchButton" Content="启动所选" Background="#2F9E72" Foreground="White"/><Button x:Name="UseProfileButton" Content="设为当前"/></StackPanel>
          <TextBlock Grid.Row="1" VerticalAlignment="Top" Margin="0,9,0,0" Text="版本详情"/>
          <Border Grid.Row="1" Grid.Column="1" Background="#F4FFFFFF" CornerRadius="4" Padding="9,6" Margin="4"><TextBlock x:Name="ProfileDetailsText" Text="尚未发现冻结版本。" TextWrapping="Wrap" Foreground="#405565"/></Border>
          <StackPanel Grid.Row="1" Grid.Column="2" Orientation="Horizontal"><Button x:Name="VerifyButton" Content="校验所选"/><Button x:Name="OpenSelectedProfileButton" Content="打开目录"/></StackPanel>
          <TextBlock Grid.Row="2" VerticalAlignment="Center" Text="扫描位置"/>
          <TextBlock Grid.Row="2" Grid.Column="1" x:Name="LibrarySummaryText" Text="默认扫描程序内 profiles；可以添加其它版本目录。" VerticalAlignment="Center" Foreground="#405565" Margin="8,4"/>
          <StackPanel Grid.Row="2" Grid.Column="2" Orientation="Horizontal"><Button x:Name="AddLibraryRootButton" Content="添加目录"/><Button x:Name="RefreshButton" Content="重新扫描"/></StackPanel>
          <TextBlock Grid.Row="3" VerticalAlignment="Center" Text="迁移目标"/>
          <TextBox Grid.Row="3" Grid.Column="1" x:Name="TargetProfileBox" IsReadOnly="True" Background="#EEF1F4"/>
          <StackPanel Grid.Row="3" Grid.Column="2" Orientation="Horizontal"><Button x:Name="BrowseTargetProfileButton" Content="选择位置"/><Button x:Name="InspectTargetButton" Content="检测目标" Background="#2F6FA3" Foreground="White"/></StackPanel>
        </Grid>
      </GroupBox>

      <GroupBox Grid.Row="3" Header="3. 执行操作">
        <Grid>
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
          <DockPanel Grid.Row="0" Margin="2,0,2,6">
            <TextBlock Text="操作模式" Width="116" VerticalAlignment="Center"/>
            <ComboBox x:Name="OperationModeBox" SelectedIndex="0">
              <ComboBoxItem Content="自动迁移（优先增量）" Tag="Migration"/><ComboBoxItem Content="备份存档" Tag="Backup"/>
            </ComboBox>
          </DockPanel>
          <Grid Grid.Row="1">
            <StackPanel x:Name="MigrationModePanel">
              <TextBlock x:Name="MigrationDecisionText" Text="迁移方式：请先检测目标；默认优先采用增量迁移。" Foreground="#405565" Margin="8,1,8,4"/>
              <StackPanel Orientation="Horizontal"><Button x:Name="MigrationPreviewButton" Content="检查迁移内容"/><Button x:Name="MigrateButton" Content="开始自动迁移" Background="#2F9E72" Foreground="White" FontWeight="SemiBold"/><Button x:Name="RollbackMigrationButton" Content="回迁最近一次"/></StackPanel>
              <TextBlock Text="已有有效冻结文件时只补齐缺失内容；空目录时自动创建完整冻结版本。" Foreground="#4F5F6B" Margin="8,3"/>
            </StackPanel>
            <Grid x:Name="BackupModePanel" Visibility="Collapsed">
              <Grid.ColumnDefinitions><ColumnDefinition Width="120"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
              <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
              <TextBlock Grid.Row="0" VerticalAlignment="Center" Text="选择存档"/><ComboBox Grid.Row="0" Grid.Column="1" x:Name="SaveProfileBox" DisplayMemberPath="Display"/><Button Grid.Row="0" Grid.Column="2" x:Name="RefreshSavesButton" Content="刷新存档"/>
              <TextBlock Grid.Row="1" VerticalAlignment="Center" Text="外部备份位置"/><TextBox Grid.Row="1" Grid.Column="1" x:Name="BackupDestinationBox"/><Button Grid.Row="1" Grid.Column="2" x:Name="BrowseBackupDestinationButton" Content="选择位置"/>
              <TextBlock Grid.Row="2" Grid.ColumnSpan="2" Text="备份所选存档内部的全部世界/角色文件；不包含其它存档、日志、录像、全局设置和 MOD 资源。" TextWrapping="Wrap" Foreground="#4F5F6B" Margin="8,5"/>
              <Button Grid.Row="2" Grid.Column="2" x:Name="BackupButton" Content="开始备份所选存档" Background="#2F6FA3" Foreground="White" FontWeight="SemiBold"/>
            </Grid>
          </Grid>
        </Grid>
      </GroupBox>

      <GroupBox Grid.Row="4" Header="操作进度与结果" MinHeight="185">
        <Grid>
          <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="*"/></Grid.RowDefinitions>
          <Border Grid.Row="0" Background="#EAF2F8" CornerRadius="6" Padding="12,9" Margin="4,2,4,8"><StackPanel><TextBlock x:Name="StepText" Text="当前：等待操作" FontWeight="SemiBold" Foreground="#243447" FontSize="14"/><TextBlock x:Name="NextStepText" Text="下一步：选择要执行的操作" Foreground="#596773" Margin="0,4,0,0"/></StackPanel></Border>
          <TextBox Grid.Row="1" x:Name="LogBox" IsReadOnly="True" AcceptsReturn="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto" FontFamily="Microsoft YaHei UI" FontSize="13" Background="#E6111820" Foreground="#D8E3EA"/>
        </Grid>
      </GroupBox>

      <Grid Grid.Row="5" Margin="8,2"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><ProgressBar x:Name="BusyBar" Height="7" IsIndeterminate="False" Visibility="Hidden"/><StackPanel Grid.Column="1" Orientation="Horizontal"><Button x:Name="OpenButton" Content="打开工具目录"/><Button x:Name="OpenDocsButton" Content="应用内说明"/></StackPanel></Grid>
    </Grid>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$names = @('StatusText','GamePathBox','WorkshopPathBox','CachePathBox','RootPathBox','DetectButton',
    'BrowseGameButton','BrowseWorkshopButton','BrowseCacheButton','LaunchButton','VerifyButton','OpenSelectedProfileButton','AddLibraryRootButton','ProfileDetailsText','LibrarySummaryText',
    'OperationModeBox','MigrationModePanel','MigrationDecisionText','BackupModePanel','SaveProfileBox','RefreshSavesButton','BackupDestinationBox','BrowseBackupDestinationButton',
    'BackupButton','MigrationPreviewButton','MigrateButton','RollbackMigrationButton','BrowseTargetProfileButton','InspectTargetButton','TargetProfileBox','ProfilesBox','UseProfileButton','RefreshButton','StepText','NextStepText','LogBox','BusyBar','OpenButton','OpenDocsButton')
foreach($name in $names){Set-Variable -Name $name -Value $window.FindName($name) -Scope Script}
$RootPathBox.Text = $script:AppRoot
$script:TargetMode='Unknown'

function Add-Log([string]$Text){
    if([string]::IsNullOrWhiteSpace($Text)){return}
    $LogBox.AppendText("$Text`r`n")
    $LogBox.ScrollToEnd()
}

function Set-Step([string]$Current,[string]$Next){
    $StepText.Text="当前：$Current"
    $NextStepText.Text="下一步：$Next"
}

function Get-ActionLabel([string]$Action){
    switch($Action){
        'Create'{'创建冻结版本'} 'Preflight'{'环境预检'} 'PreviewMigration'{'检查可迁移内容'}
        'Migrate'{'增量迁移'} 'RollbackMigration'{'回迁最近迁移'} 'Verify'{'完整性校验'}
        'BackupSave'{'存档备份'} 'Launch'{'启动冻结版'} default{$Action}
    }
}

function Handle-JobLine([string]$Line){
    if([string]::IsNullOrWhiteSpace($Line)){return}
    if($Line.StartsWith('@@PZSTEP|')){
        $parts=$Line.Split('|',4)
        if($parts.Count -ge 3){
            $detail=if($parts.Count -eq 4){$parts[3]}else{''}
            Set-Step $parts[1] $parts[2]
            Add-Log ("[步骤] {0}{1}" -f $parts[1],$(if($detail){" — $detail"}else{''}))
        }
        return
    }
    if($Line -match '^\[\d{4}-\d{2}-\d{2} .*\] \[(PASS|WARN|ERROR|INFO)\] (.+)$'){
        $level=switch($Matches[1]){'PASS'{'成功'}'WARN'{'提醒'}'ERROR'{'错误'}default{'信息'}}
        Add-Log ("[{0}] {1}" -f $level,$Matches[2])
        if($Matches[1] -eq 'ERROR'){$script:LastErrorReason=$Matches[2]}
        return
    }
    if($Line -match '^(\{|\}|\s*"|\s*\[|\s*\]|\s*[-=]{3,}|\s*Total\s|\s*Dirs\s|\s*Files\s|\s*Bytes\s|\s*Times\s|\s*Ended\s|\s*New File\s)' -or $Line -match '(?i)robocopy') {return}
    if($Line -match '(?i)(exception|失败|错误|error|不存在|无效|无法|退出码)' -and $Line -notmatch 'CategoryInfo|FullyQualifiedErrorId|RemoteException'){
        if(-not $script:LastErrorReason){$script:LastErrorReason=$Line.Trim()}
        Add-Log ("[错误] {0}" -f $Line.Trim())
    }
}

function Show-HelpWindow {
    $doc=Join-Path $script:AppRoot 'README.md'
    $content=if(Test-Path -LiteralPath $doc){Get-Content -LiteralPath $doc -Raw}else{'未找到内置说明文件。'}
    $content=$content -replace '(?m)^#{1,6}\s*','' -replace '`([^`]+)`','$1' -replace '\[([^\]]+)\]\([^\)]+\)','$1'
    $help=New-Object Windows.Window
    $help.Title='PZ Version & Mod Freezer - 使用说明'
    $help.Width=820;$help.Height=680;$help.MinWidth=620;$help.MinHeight=480;$help.WindowStartupLocation='CenterOwner';$help.Owner=$window
    $box=New-Object Windows.Controls.TextBox
    $box.Text=$content;$box.IsReadOnly=$true;$box.AcceptsReturn=$true;$box.TextWrapping='Wrap'
    $box.VerticalScrollBarVisibility='Auto';$box.HorizontalScrollBarVisibility='Disabled';$box.Padding='20';$box.FontFamily='Microsoft YaHei UI';$box.FontSize=14
    $help.Content=$box
    [void]$help.ShowDialog()
}

function Set-Busy([bool]$Busy,[string]$Text){
    $BusyBar.IsIndeterminate=$Busy
    $BusyBar.Visibility=if($Busy){'Visible'}else{'Hidden'}
    $StatusText.Text=$Text
    foreach($control in @($DetectButton,$LaunchButton,$VerifyButton,$OpenSelectedProfileButton,$AddLibraryRootButton,$BackupButton,$MigrationPreviewButton,$MigrateButton,$RollbackMigrationButton,$BrowseTargetProfileButton,$InspectTargetButton,$UseProfileButton,$RefreshButton,$OperationModeBox,$RefreshSavesButton,$BrowseBackupDestinationButton)){
        $control.IsEnabled=-not $Busy
    }
}

function Quote-Display([string]$Path){if($Path){'"'+$Path+'"'}else{'（未检测到）'}}

function Invoke-Detection {
    Set-Busy $true '正在检测'
    Add-Log '[检测] 正在查找 Steam、Project Zomboid、Workshop 和存档目录……'
    try{
        $raw=& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $script:Manager -Action Detect 2>&1 | Out-String
        $envInfo=$raw|ConvertFrom-Json
        $GamePathBox.Text=$envInfo.Game
        $WorkshopPathBox.Text=$envInfo.Workshop
        $CachePathBox.Text=$envInfo.Cache
        Add-Log ("[通过] 游戏版本 {0}，Steam BuildID {1}" -f $envInfo.Version,$envInfo.BuildID)
        Add-Log ("        游戏：{0}`r`n        MOD： {1}`r`n        存档：{2}" -f $envInfo.Game,$envInfo.Workshop,$envInfo.Cache)
        Set-Busy $false '检测完成'
    }catch{
        Add-Log ("[失败] 自动检测失败：{0}" -f $_.Exception.Message)
        Add-Log '请使用右侧“选择”按钮手动指定三个来源目录。'
        Set-Busy $false '需要手动选择'
    }
}

function Select-Folder([System.Windows.Controls.TextBox]$Target,[string]$Description){
    $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description=$Description
    if(Test-Path -LiteralPath $Target.Text){$dialog.SelectedPath=$Target.Text}
    if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){$Target.Text=$dialog.SelectedPath}
    $dialog.Dispose()
}

function Update-OperationMode {
    $mode=if($OperationModeBox.SelectedItem){$OperationModeBox.SelectedItem.Tag.ToString()}else{'Migration'}
    $MigrationModePanel.Visibility=if($mode -eq 'Migration'){'Visible'}else{'Collapsed'}
    $BackupModePanel.Visibility=if($mode -eq 'Backup'){'Visible'}else{'Collapsed'}
    if($mode -eq 'Backup'){Refresh-Saves}
}

function Refresh-Saves {
    $SaveProfileBox.Items.Clear()
    $currentPath=Join-Path $script:AppRoot 'current-freeze.json'
    if(-not(Test-Path -LiteralPath $currentPath -PathType Leaf)){return}
    try{
        $cfg=Get-Content -LiteralPath $currentPath -Raw|ConvertFrom-Json
        $savesRoot=Join-Path $cfg.CachePath 'Saves'
        if(-not(Test-Path -LiteralPath $savesRoot -PathType Container)){return}
        $items=@()
        foreach($mode in @(Get-ChildItem -LiteralPath $savesRoot -Directory -ErrorAction Stop)){
            foreach($save in @(Get-ChildItem -LiteralPath $mode.FullName -Directory -ErrorAction Stop)){
                $items+=[pscustomobject]@{Display=("{0} · {1} · {2}" -f $mode.Name,$save.Name,$save.LastWriteTime.ToString('yyyy-MM-dd HH:mm'));Path=$save.FullName;Modified=$save.LastWriteTime}
            }
        }
        foreach($item in @($items|Sort-Object Modified -Descending)){[void]$SaveProfileBox.Items.Add($item)}
        if($SaveProfileBox.Items.Count -gt 0){$SaveProfileBox.SelectedIndex=0}
    }catch{Add-Log "[警告] 无法读取存档列表：$($_.Exception.Message)"}
}

function Get-FrozenConfigFromFolder([string]$Folder){
    $folderFull=[IO.Path]::GetFullPath($Folder).TrimEnd('\')
    if(-not(Test-Path -LiteralPath $folderFull -PathType Container)){throw "目录不存在：$folderFull"}
    $managerConfig=Join-Path $folderFull 'current-freeze.json'
    $profileConfig=Join-Path $folderFull 'metadata\freeze.json'
    $configPath=$null;$selectedProfileRoot=$null
    if(Test-Path -LiteralPath $managerConfig -PathType Leaf){$configPath=$managerConfig}
    elseif(Test-Path -LiteralPath $profileConfig -PathType Leaf){$configPath=$profileConfig;$selectedProfileRoot=$folderFull}
    else{
        $candidates=@(Get-ChildItem -LiteralPath $folderFull -Directory -ErrorAction SilentlyContinue|ForEach-Object{
            $candidate=Join-Path $_.FullName 'metadata\freeze.json'
            if(Test-Path -LiteralPath $candidate -PathType Leaf){Get-Item -LiteralPath $candidate}
        })
        if($candidates.Count -eq 1){$configPath=$candidates[0].FullName;$selectedProfileRoot=Split-Path -Parent (Split-Path -Parent $configPath)}
        elseif($candidates.Count -gt 1){throw '该目录包含多个冻结版本，请进入并选择具体版本目录。'}
        else{throw '所选目录中没有 current-freeze.json 或 metadata\freeze.json。'}
    }
    $cfg=Get-Content -LiteralPath $configPath -Raw|ConvertFrom-Json
    if($selectedProfileRoot){
        $cfg.FreezeRoot=$selectedProfileRoot
        $cfg.GamePath=Join-Path $selectedProfileRoot 'game';$cfg.CachePath=Join-Path $selectedProfileRoot 'cache'
        $cfg.ManifestPath=Join-Path $selectedProfileRoot 'manifests';$cfg.ReportPath=Join-Path $selectedProfileRoot 'reports';$cfg.BackupPath=Join-Path $selectedProfileRoot 'backups'
    }
    if(-not(Test-Path -LiteralPath $cfg.FreezeRoot -PathType Container)){throw "配置指向的冻结目录不存在：$($cfg.FreezeRoot)"}
    if(-not(Test-Path -LiteralPath $cfg.GamePath -PathType Container)){throw "冻结游戏目录不存在：$($cfg.GamePath)"}
    if(-not(Test-Path -LiteralPath $cfg.CachePath -PathType Container)){throw "冻结缓存目录不存在：$($cfg.CachePath)"}
    $cfg|Add-Member -NotePropertyName ManagerRoot -NotePropertyValue $script:AppRoot -Force
    $cfg
}

function Set-CurrentFrozenConfig($Config,[string]$Label){
    $Config|Add-Member -NotePropertyName ManagerRoot -NotePropertyValue $script:AppRoot -Force
    $Config|ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $script:AppRoot 'current-freeze.json') -Encoding UTF8
    $TargetProfileBox.Text=$Config.FreezeRoot
    Add-Log "[通过] 当前冻结目标：$($Config.FreezeRoot)"
    if($Label){Add-Log "        $Label"}
    $StatusText.Text='已选择冻结目标'
    $script:TargetMode='Incremental'
    $MigrationDecisionText.Text='迁移方式：增量迁移（检测到已有有效冻结文件）。'
    Register-VersionLibraryRoot $Config.FreezeRoot
    Refresh-Saves
    return $true
}

function Select-ExternalFrozenProfile {
    $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description='选择迁移目标：已有冻结版目录，或用于首次完整迁移的空目录'
    $dialog.ShowNewFolderButton=$true
    if(Test-Path -LiteralPath $TargetProfileBox.Text -PathType Container){$dialog.SelectedPath=$TargetProfileBox.Text}
    try{
        if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){
            $TargetProfileBox.Text=[IO.Path]::GetFullPath($dialog.SelectedPath).TrimEnd('\')
            $script:TargetMode='Unknown'
            $SaveProfileBox.Items.Clear()
            $MigrationDecisionText.Text='迁移方式：尚未检测。点击“检测目标”后自动判断。'
            $StatusText.Text='等待检测目标'
            Add-Log "[位置] 已选择迁移目标：$($TargetProfileBox.Text)"
        }
    }catch{
        Add-Log "[失败] 无法选择冻结位置：$($_.Exception.Message)"
        [System.Windows.MessageBox]::Show($_.Exception.Message,'无法选择冻结位置','OK','Error')|Out-Null
    }finally{$dialog.Dispose()}
}

function Inspect-MigrationTarget {
    $target=$TargetProfileBox.Text.Trim()
    if(-not $target -or -not(Test-Path -LiteralPath $target -PathType Container)){
        [System.Windows.MessageBox]::Show('请先选择一个存在的迁移目标目录。','检测迁移目标','OK','Information')|Out-Null
        return $false
    }
    $target=[IO.Path]::GetFullPath($target).TrimEnd('\');$TargetProfileBox.Text=$target
    try{
        $cfg=Get-FrozenConfigFromFolder $target
        Set-CurrentFrozenConfig $cfg ('版本 {0} · BuildID {1}' -f $cfg.Version,$cfg.BuildID)
        Add-Log '[检测] 已发现有效冻结文件，将执行增量迁移。'
        return $true
    }catch{
        $entries=@(Get-ChildItem -LiteralPath $target -Force -ErrorAction Stop)
        if($entries.Count -eq 0){
            $script:TargetMode='Full'
            $MigrationDecisionText.Text='迁移方式：首次完整迁移（目标目录为空）。'
            $StatusText.Text='目标为空：完整迁移'
            Add-Log '[检测] 目标目录为空，将执行首次完整迁移。'
            return $true
        }
        $script:TargetMode='Invalid'
        $MigrationDecisionText.Text='迁移方式：已停止（非空目录不是有效冻结版）。'
        $StatusText.Text='目标目录无效'
        $message="所选目录不是有效冻结版，而且并非空目录。为避免覆盖无关文件，工具不会继续。`n`n$target"
        Add-Log "[失败] $message"
        if(-not $SelfTest){[System.Windows.MessageBox]::Show($message,'检测迁移目标','OK','Error')|Out-Null}
        return $false
    }
}

function Get-VersionLibraryRoots {
    $roots=New-Object System.Collections.Generic.List[string]
    $defaultRoot=Join-Path $script:AppRoot 'profiles'
    if(Test-Path -LiteralPath $defaultRoot -PathType Container){$roots.Add([IO.Path]::GetFullPath($defaultRoot).TrimEnd('\'))}
    if(Test-Path -LiteralPath $script:LibraryFile -PathType Leaf){
        try{foreach($root in @((Get-Content -LiteralPath $script:LibraryFile -Raw|ConvertFrom-Json).LibraryRoots)){if($root -and (Test-Path -LiteralPath $root -PathType Container)){$roots.Add([IO.Path]::GetFullPath([string]$root).TrimEnd('\'))}}}catch{Add-Log "[警告] 版本库配置损坏，将忽略：$($_.Exception.Message)"}
    }
    if($SelfTestLibraryRoot -and (Test-Path -LiteralPath $SelfTestLibraryRoot -PathType Container)){$roots.Add([IO.Path]::GetFullPath($SelfTestLibraryRoot).TrimEnd('\'))}
    @($roots|Select-Object -Unique)
}

function Save-VersionLibraryRoots([string[]]$Roots){
    [ordered]@{SchemaVersion=1;Updated=(Get-Date).ToString('o');LibraryRoots=@($Roots|Where-Object{$_}|Select-Object -Unique)}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $script:LibraryFile -Encoding UTF8
}

function Register-VersionLibraryRoot([string]$Root){
    if(-not $Root -or -not(Test-Path -LiteralPath $Root -PathType Container)){return}
    $full=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    $roots=@(Get-VersionLibraryRoots)
    if($full -notin $roots){Save-VersionLibraryRoots @($roots+$full)}
}

function Add-VersionLibraryRoot {
    $dialog=New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description='选择包含一个或多个冻结版本的目录；工具最多向下扫描 6 层'
    $dialog.ShowNewFolderButton=$false
    try{
        if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){
            $full=[IO.Path]::GetFullPath($dialog.SelectedPath).TrimEnd('\')
            if($full -eq [IO.Path]::GetPathRoot($full)){[System.Windows.MessageBox]::Show('请不要直接扫描整个磁盘，请选择更具体的版本库目录。','添加版本目录','OK','Information')|Out-Null;return}
            Register-VersionLibraryRoot $full
            Add-Log "[版本库] 已添加扫描位置：$full"
            Refresh-Profiles
        }
    }finally{$dialog.Dispose()}
}

function Find-VersionConfigFiles([string]$Root){
    $result=New-Object System.Collections.Generic.List[object]
    $direct=Join-Path $Root 'metadata\freeze.json'
    if(Test-Path -LiteralPath $direct -PathType Leaf){$result.Add((Get-Item -LiteralPath $direct))}
    foreach($file in @(Get-ChildItem -LiteralPath $Root -Filter freeze.json -File -Recurse -Depth 6 -ErrorAction SilentlyContinue|Where-Object{$_.FullName -like '*\metadata\freeze.json'})){
        if(-not($result|Where-Object{$_.FullName -ieq $file.FullName})){$result.Add($file)}
    }
    $result|ForEach-Object{$_}
}

function New-VersionLibraryItem($Config,[string]$ConfigPath){
    $issues=New-Object System.Collections.Generic.List[string]
    if(-not(Test-Path -LiteralPath $Config.FreezeRoot -PathType Container)){$issues.Add('冻结目录不存在')}
    if(-not $Config.GamePath -or -not(Test-Path -LiteralPath (Join-Path $Config.GamePath 'ProjectZomboid64.exe') -PathType Leaf)){$issues.Add('游戏 EXE 缺失')}
    if(-not $Config.CachePath -or -not(Test-Path -LiteralPath $Config.CachePath -PathType Container)){$issues.Add('独立缓存缺失')}
    if(-not $Config.ManifestPath -or -not(Test-Path -LiteralPath (Join-Path $Config.ManifestPath 'game.sha256.csv') -PathType Leaf)){$issues.Add('游戏清单缺失')}
    $healthy=$issues.Count -eq 0;$health=if($healthy){'就绪'}else{'需修复'}
    $created=try{[datetime]$Config.Created}catch{[datetime]::MinValue}
    $mods=if($null-ne$Config.EffectiveModCount){[int]$Config.EffectiveModCount}else{0}
    [pscustomobject]@{
        Display=('B{0} · Build {1} · {2} MOD · {3}' -f $Config.Version,$Config.BuildID,$mods,$health)
        ConfigPath=$ConfigPath;FreezeRoot=[string]$Config.FreezeRoot;GamePath=[string]$Config.GamePath;CachePath=[string]$Config.CachePath
        Version=[string]$Config.Version;BuildID=[string]$Config.BuildID;Created=$created;ModCount=$mods;Healthy=$healthy;Health=$health;Issues=@($issues)
    }
}

function Read-VersionConfigForLibrary([string]$ConfigPath){
    $cfg=Get-Content -LiteralPath $ConfigPath -Raw|ConvertFrom-Json
    if($ConfigPath -like '*\metadata\freeze.json'){
        $profileRoot=Split-Path -Parent (Split-Path -Parent $ConfigPath)
        $cfg.FreezeRoot=$profileRoot;$cfg.GamePath=Join-Path $profileRoot 'game';$cfg.CachePath=Join-Path $profileRoot 'cache'
        $cfg.ManifestPath=Join-Path $profileRoot 'manifests';$cfg.ReportPath=Join-Path $profileRoot 'reports';$cfg.BackupPath=Join-Path $profileRoot 'backups'
    }
    $cfg
}

function Update-SelectedProfileDetails {
    $item=$ProfilesBox.SelectedItem
    if(-not $item){$ProfileDetailsText.Text='尚未发现冻结版本。';return}
    $created=if($item.Created -and $item.Created -ne [datetime]::MinValue){$item.Created.ToString('yyyy-MM-dd HH:mm')}else{'未知'}
    $problem=if($item.Healthy){'无'}else{($item.Issues -join '；')}
    $ProfileDetailsText.Text=("版本 B{0}    BuildID {1}    MOD {2}    状态：{3}`n创建：{4}    问题：{5}`n位置：{6}" -f $item.Version,$item.BuildID,$item.ModCount,$item.Health,$created,$problem,$item.FreezeRoot)
}

function Refresh-Profiles {
    $ProfilesBox.Items.Clear();$seen=@{};$items=New-Object System.Collections.Generic.List[object]
    $currentPath=Join-Path $script:AppRoot 'current-freeze.json'
    $current=if(Test-Path -LiteralPath $currentPath){try{Get-Content -LiteralPath $currentPath -Raw|ConvertFrom-Json}catch{$null}}else{$null}
    $roots=@(Get-VersionLibraryRoots)
    foreach($root in $roots){
        foreach($file in @(Find-VersionConfigFiles $root)){
            try{
                $cfg=Read-VersionConfigForLibrary $file.FullName;$key=$cfg.FreezeRoot.ToLowerInvariant()
                if(-not $seen.ContainsKey($key)){$items.Add((New-VersionLibraryItem $cfg $file.FullName));$seen[$key]=$true}
            }catch{Add-Log "[警告] 无法索引版本配置：$($file.FullName)；$($_.Exception.Message)"}
        }
    }
    if($current){
        try{
            $cfg=$current;$key=([string]$cfg.FreezeRoot).ToLowerInvariant()
            if(-not $seen.ContainsKey($key)){$items.Add((New-VersionLibraryItem $cfg $currentPath));$seen[$key]=$true}
        }catch{Add-Log "[警告] 当前版本配置不可用：$($_.Exception.Message)"}
    }
    $selected=-1
    foreach($item in @($items|Sort-Object -Property @{Expression='Created';Descending=$true},@{Expression='Version';Descending=$true})){
        [void]$ProfilesBox.Items.Add($item)
        if($current -and $current.FreezeRoot -ieq $item.FreezeRoot){$selected=$ProfilesBox.Items.Count-1}
    }
    if($current){$TargetProfileBox.Text=$current.FreezeRoot;$script:TargetMode='Incremental';$MigrationDecisionText.Text='迁移方式：增量迁移（当前已有冻结版本）。'}
    elseif(-not $TargetProfileBox.Text -or $TargetProfileBox.Text -eq '尚未选择迁移目标'){$TargetProfileBox.Text='尚未选择迁移目标';$script:TargetMode='Unknown'}
    if($ProfilesBox.Items.Count -gt 0){$ProfilesBox.SelectedIndex=if($selected -ge 0){$selected}else{0}}else{$ProfilesBox.SelectedIndex=-1}
    $LibrarySummaryText.Text=("已扫描 {0} 个目录，发现 {1} 个冻结版本。" -f $roots.Count,$ProfilesBox.Items.Count)
    Update-SelectedProfileDetails
    Refresh-Saves
}

function Use-SelectedProfile {
    $item=$ProfilesBox.SelectedItem
    if(-not $item){[System.Windows.MessageBox]::Show('请先从版本库选择一个冻结版本。','PZ Freezer')|Out-Null;return $false}
    try{
        $cfg=Get-Content -LiteralPath $item.ConfigPath -Raw|ConvertFrom-Json
        if($item.ConfigPath -like '*\metadata\freeze.json'){$cfg=Get-FrozenConfigFromFolder (Split-Path -Parent (Split-Path -Parent $item.ConfigPath))}
        [void](Set-CurrentFrozenConfig $cfg $item.Display)
        return $true
    }catch{
        Add-Log "[失败] 无法切换冻结版本：$($_.Exception.Message)"
        if($SelfTest){throw}
        [System.Windows.MessageBox]::Show($_.Exception.Message,'无法切换冻结版本','OK','Error')|Out-Null
        return $false
    }
}

function Launch-SelectedProfile {
    $item=$ProfilesBox.SelectedItem
    if(-not $item){[System.Windows.MessageBox]::Show('请先从版本库选择一个版本。','启动版本','OK','Information')|Out-Null;return}
    if(-not $item.Healthy){[System.Windows.MessageBox]::Show(("所选版本需要修复：{0}" -f ($item.Issues -join '；')),'无法启动','OK','Error')|Out-Null;return}
    if(Use-SelectedProfile){Start-ManagerAction 'Launch'}
}

function Verify-SelectedProfile {
    if(Use-SelectedProfile){Start-ManagerAction 'Verify'}
}

function Open-SelectedProfile {
    $item=$ProfilesBox.SelectedItem
    if(-not $item -or -not(Test-Path -LiteralPath $item.FreezeRoot -PathType Container)){[System.Windows.MessageBox]::Show('所选版本目录不存在。','打开版本目录','OK','Error')|Out-Null;return}
    Start-Process explorer.exe -ArgumentList $item.FreezeRoot
}

function Start-AutoPreview {
    if($script:TargetMode -in @('Unknown','Invalid')){if(-not(Inspect-MigrationTarget)){return}}
    if($script:TargetMode -eq 'Full'){Start-ManagerAction 'Preflight'}else{Start-ManagerAction 'PreviewMigration'}
}

function Start-AutoMigration {
    if($script:TargetMode -in @('Unknown','Invalid')){if(-not(Inspect-MigrationTarget)){return}}
    if($script:TargetMode -eq 'Full'){Start-ManagerAction 'Create'}else{Start-ManagerAction 'Migrate'}
}

function Start-ManagerAction([string]$Action){
    if($script:Job -and $script:Job.State -in @('Running','NotStarted')){return}
    if($Action -notin @('Create','Preflight') -and -not(Test-Path -LiteralPath (Join-Path $script:AppRoot 'current-freeze.json'))){
        [System.Windows.MessageBox]::Show('还没有当前冻结版本，请先创建或选择一个版本。','PZ Freezer','OK','Information')|Out-Null
        return
    }
    if($Action -in @('Create','Preflight','PreviewMigration','Migrate')){
        foreach($pair in @(@('游戏本体',$GamePathBox.Text),@('Workshop',$WorkshopPathBox.Text),@('缓存/存档',$CachePathBox.Text))){
            if(-not(Test-Path -LiteralPath $pair[1] -PathType Container)){
                [System.Windows.MessageBox]::Show("$($pair[0])目录无效：$($pair[1])",'PZ Freezer','OK','Error')|Out-Null;return
            }
        }
    }
    if($Action -eq 'Create'){
        $answer=[System.Windows.MessageBox]::Show("目标目录为空，将执行首次完整迁移：`n$($TargetProfileBox.Text)`n`n将复制游戏、MOD、配置和存档并计算 SHA-256。请先退出游戏；操作可能持续较长时间。`n不会修改 Steam 原版。`n`n是否继续？",'确认完整迁移','YesNo','Question')
        if($answer -ne 'Yes'){return}
    }
    if($Action -eq 'Migrate'){
        $answer=[System.Windows.MessageBox]::Show("当前目标通常已经包含游戏本体和 MOD。`n`n继续后只会补齐缺失文件和缺失 Mod ID，不覆盖已有文件；不会执行全量完整性哈希，也不会压缩整个存档。工具会保存迁移事务，可用「回迁最近一次」撤回。`n`n如需存档快照，请单独点击「备份存档」。`n`n确认继续？",'确认增量迁移','YesNo','Warning')
        if($answer -ne 'Yes'){return}
    }
    if($Action -eq 'RollbackMigration'){
        $answer=[System.Windows.MessageBox]::Show("将撤回最近一次增量迁移。若本次新增文件后来发生过修改，回迁会自动停止，不会强制删除。`n`n确认继续？",'确认回迁','YesNo','Warning')
        if($answer -ne 'Yes'){return}
    }
    if($Action -eq 'BackupSave'){
        if(-not $SaveProfileBox.SelectedItem){[System.Windows.MessageBox]::Show('请先选择一个具体存档。','备份存档','OK','Information')|Out-Null;return}
        if(-not(Test-Path -LiteralPath $BackupDestinationBox.Text -PathType Container)){[System.Windows.MessageBox]::Show('请选择有效的外部备份位置。','备份存档','OK','Information')|Out-Null;return}
    }
    $busyText=switch($Action){'Create'{'正在创建'}'Preflight'{'正在预检'}'PreviewMigration'{'正在检查迁移'}'Migrate'{'正在迁移'}'RollbackMigration'{'正在回迁'}'Verify'{'正在校验'}'BackupSave'{'正在备份'}'Launch'{'正在启动'}default{'正在执行'}}
    Set-Busy $true $busyText
    $script:ActionStart=Get-Date;$script:CurrentAction=$Action;$script:LastErrorReason=$null
    $label=Get-ActionLabel $Action
    Set-Step "准备$label" '读取配置并开始执行'
    Add-Log ("[{0}] 开始：{1}" -f (Get-Date -Format 'HH:mm:ss'),$label)
    $manager=$script:Manager;$root=$script:AppRoot;$game=$GamePathBox.Text;$workshop=$WorkshopPathBox.Text;$cache=$CachePathBox.Text
    $selectedSave=if($SaveProfileBox.SelectedItem){$SaveProfileBox.SelectedItem.Path}else{''};$backupDestination=$BackupDestinationBox.Text;$targetRoot=$TargetProfileBox.Text
    $script:Job=Start-Job -ScriptBlock {
        param($Manager,$ActionName,$Root,$Game,$Workshop,$Cache,$SelectedSave,$BackupDestination,$TargetRoot)
        $args=@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$Manager,'-Action',$ActionName,'-ManagerRoot',$Root)
        if($ActionName -in @('Create','Preflight','PreviewMigration','Migrate')){$args+=@('-SourceGame',$Game,'-SourceWorkshop',$Workshop,'-SourceCache',$Cache)}
        if($ActionName -in @('Create','Preflight')){$args+=@('-TargetRoot',$TargetRoot)}
        if($ActionName -eq 'Migrate'){$args+='-ConfirmedExistingTarget'}
        if($ActionName -eq 'BackupSave'){$args+=@('-SavePath',$SelectedSave,'-BackupDestination',$BackupDestination)}
        & powershell.exe @args 2>&1|ForEach-Object{$_.ToString()}
        if($LASTEXITCODE -ne 0){throw "核心进程退出码：$LASTEXITCODE"}
    } -ArgumentList $manager,$Action,$root,$game,$workshop,$cache,$selectedSave,$backupDestination,$targetRoot
    $JobTimer.Start()
}

$JobTimer=New-Object Windows.Threading.DispatcherTimer
$JobTimer.Interval=[TimeSpan]::FromMilliseconds(600)
$JobTimer.Add_Tick({
    if(-not $script:Job){return}
    foreach($line in @(Receive-Job -Job $script:Job -ErrorAction SilentlyContinue)){Handle-JobLine $line.ToString()}
    if($script:Job.State -in @('Completed','Failed','Stopped')){
        $state=$script:Job.State
        foreach($line in @(Receive-Job -Job $script:Job -ErrorAction SilentlyContinue)){Handle-JobLine $line.ToString()}
        $elapsed=[Math]::Round(((Get-Date)-$script:ActionStart).TotalSeconds,1)
        $label=Get-ActionLabel $script:CurrentAction
        if($state -eq 'Completed'){
            Add-Log ("[完成] {0}成功，用时 {1} 秒。" -f $label,$elapsed)
            Set-Step "$label 已完成（$elapsed 秒）" '可以继续选择其它操作'
            Set-Busy $false '操作成功'
        }else{
            $reason=if($script:LastErrorReason){$script:LastErrorReason}else{if($script:Job.JobStateInfo.Reason){$script:Job.JobStateInfo.Reason.Message}else{"后台任务状态：$state"}}
            Add-Log ("[失败] {0}未完成，用时 {1} 秒。原因：{2}" -f $label,$elapsed,$reason)
            Set-Step "$label 失败" '根据下方原因处理后重试'
            Set-Busy $false '操作失败'
        }
        Remove-Job -Job $script:Job -Force -ErrorAction SilentlyContinue
        $script:Job=$null
        $JobTimer.Stop()
        Refresh-Profiles
        Refresh-Saves
    }
})

$DetectButton.Add_Click({Invoke-Detection})
$BrowseGameButton.Add_Click({Select-Folder $GamePathBox '选择 Project Zomboid 游戏本体目录'})
$BrowseWorkshopButton.Add_Click({Select-Folder $WorkshopPathBox '选择 Steam Workshop 的 108600 目录'})
$BrowseCacheButton.Add_Click({Select-Folder $CachePathBox '选择 Zomboid 缓存/存档目录'})
$OperationModeBox.Add_SelectionChanged({Update-OperationMode})
$MigrationPreviewButton.Add_Click({Start-AutoPreview})
$MigrateButton.Add_Click({Start-AutoMigration})
$RollbackMigrationButton.Add_Click({Start-ManagerAction 'RollbackMigration'})
$BrowseTargetProfileButton.Add_Click({Select-ExternalFrozenProfile})
$InspectTargetButton.Add_Click({[void](Inspect-MigrationTarget)})
$LaunchButton.Add_Click({Launch-SelectedProfile})
$VerifyButton.Add_Click({Verify-SelectedProfile})
$OpenSelectedProfileButton.Add_Click({Open-SelectedProfile})
$AddLibraryRootButton.Add_Click({Add-VersionLibraryRoot})
$BackupButton.Add_Click({Start-ManagerAction 'BackupSave'})
$RefreshSavesButton.Add_Click({Refresh-Saves})
$BrowseBackupDestinationButton.Add_Click({Select-Folder $BackupDestinationBox '选择存档 ZIP 的外部保存位置'})
$RefreshButton.Add_Click({Refresh-Profiles})
$UseProfileButton.Add_Click({Use-SelectedProfile})
$ProfilesBox.Add_SelectionChanged({Update-SelectedProfileDetails})
$OpenButton.Add_Click({Start-Process explorer.exe -ArgumentList $script:AppRoot})
$OpenDocsButton.Add_Click({
    Show-HelpWindow
})
$window.Add_Closing({param($sender,$e)
    if($script:Job -and $script:Job.State -in @('Running','NotStarted')){
        [System.Windows.MessageBox]::Show('创建或校验仍在进行，请等待操作完成后再关闭。','PZ Freezer','OK','Warning')|Out-Null
        $e.Cancel=$true
    }
})

Refresh-Profiles
Update-OperationMode
if($SelfTest){
    if(-not $window -or -not $MigrateButton -or -not $LogBox -or -not $ProfilesBox -or -not $ProfileDetailsText -or -not $OperationModeBox -or -not $BackupModePanel){throw 'GUI 控件初始化失败。'}
    if($SelfTestExpectedProfileCount -ge 0){if($ProfilesBox.Items.Count -ne $SelfTestExpectedProfileCount){throw "Expected $SelfTestExpectedProfileCount profiles but found $($ProfilesBox.Items.Count)."};"LIBRARY_COUNT_PASS=$($ProfilesBox.Items.Count)"}
    if($SelfTestSelectFirstProfile){$testIndex=0;for($i=0;$i-lt$ProfilesBox.Items.Count;$i++){if($ProfilesBox.Items[$i].Healthy){$testIndex=$i;break}};$ProfilesBox.SelectedIndex=$testIndex;$expectedRoot=$ProfilesBox.SelectedItem.FreezeRoot;if(-not(Use-SelectedProfile)){throw 'Library selection self-test failed.'};$selectedConfig=Get-Content -LiteralPath (Join-Path $script:AppRoot 'current-freeze.json') -Raw|ConvertFrom-Json;if($selectedConfig.FreezeRoot -ine $expectedRoot){throw 'Selected profile was not written as current.'};"LIBRARY_SELECTION_PASS=$expectedRoot"}
    if($SelfTestProfilePath){
        $testConfig=Get-FrozenConfigFromFolder $SelfTestProfilePath
        if(-not $testConfig.FreezeRoot -or -not $testConfig.GamePath -or -not $testConfig.CachePath){throw '冻结位置解析自检失败。'}
        "PROFILE_RESOLVE_PASS=$($testConfig.FreezeRoot)"
    }
    if($SelfTestTargetPath){
        $TargetProfileBox.Text=$SelfTestTargetPath
        $targetResult=Inspect-MigrationTarget
        if($SelfTestExpectedTargetMode){if($script:TargetMode -ne $SelfTestExpectedTargetMode){throw "Expected target mode $SelfTestExpectedTargetMode but got $script:TargetMode."}}
        elseif(-not $targetResult){throw 'Target inspection self-test failed.'}
        "TARGET_MODE_PASS=$script:TargetMode"
    }
    if($SelfTestScreenshotPath){
        $OperationModeBox.SelectedIndex=@{Migration=0;Backup=1}[$SelfTestMode];Update-OperationMode
        $window.Width=1080;$window.Height=1040;$window.Show();$window.UpdateLayout()
        $bitmap=New-Object Windows.Media.Imaging.RenderTargetBitmap(1080,1040,96,96,[Windows.Media.PixelFormats]::Pbgra32)
        $bitmap.Render($window);$encoder=New-Object Windows.Media.Imaging.PngBitmapEncoder;$encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
        $stream=[IO.File]::Create([IO.Path]::GetFullPath($SelfTestScreenshotPath));try{$encoder.Save($stream)}finally{$stream.Dispose()};$window.Close()
        "GUI_SCREENSHOT=$([IO.Path]::GetFullPath($SelfTestScreenshotPath))"
    }
    'GUI_SELF_TEST_PASS'
    return
}

$window.Add_ContentRendered({if(-not $GamePathBox.Text){Invoke-Detection}})
[void]$window.ShowDialog()
