[CmdletBinding()]
param([switch]$SelfTest)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase,System.Windows.Forms

$script:AppRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSCommandPath)).TrimEnd('\')
$script:Manager = Join-Path $script:AppRoot 'tools\PZ-Freeze-Manager.ps1'
$script:Job = $null

if(-not(Test-Path -LiteralPath $script:Manager -PathType Leaf)){
    [System.Windows.MessageBox]::Show("缺少核心文件：$script:Manager",'PZ Version & Mod Freezer','OK','Error')|Out-Null
    exit 1
}

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="PZ Version &amp; Mod Freezer" Width="1040" Height="760"
        MinWidth="900" MinHeight="680" WindowStartupLocation="CenterScreen"
        Background="#F4F6F8" FontFamily="Microsoft YaHei UI">
  <Window.Resources>
    <Style TargetType="Button">
      <Setter Property="Padding" Value="14,8"/><Setter Property="Margin" Value="4"/>
      <Setter Property="MinHeight" Value="36"/><Setter Property="Cursor" Value="Hand"/>
    </Style>
    <Style TargetType="TextBox">
      <Setter Property="Padding" Value="8,6"/><Setter Property="Margin" Value="4"/>
    </Style>
    <Style TargetType="GroupBox">
      <Setter Property="Margin" Value="8"/><Setter Property="Padding" Value="10"/>
    </Style>
  </Window.Resources>
  <Grid Margin="14">
    <Grid.RowDefinitions>
      <RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/>
      <RowDefinition Height="*"/><RowDefinition Height="Auto"/>
    </Grid.RowDefinitions>

    <Border Grid.Row="0" Background="#243447" CornerRadius="8" Padding="18" Margin="8,4,8,8">
      <Grid>
        <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
        <StackPanel>
          <TextBlock Text="PZ Version &amp; Mod Freezer" Foreground="White" FontSize="24" FontWeight="SemiBold"/>
          <TextBlock Text="保存可独立运行的游戏版本、MOD、配置与存档" Foreground="#D7E2EC" Margin="0,6,0,0"/>
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
        <TextBlock Grid.Row="0" VerticalAlignment="Center" Text="游戏本体"/>
        <TextBox Grid.Row="0" Grid.Column="1" x:Name="GamePathBox"/>
        <Button Grid.Row="0" Grid.Column="2" x:Name="BrowseGameButton" Content="选择"/>
        <TextBlock Grid.Row="1" VerticalAlignment="Center" Text="Workshop"/>
        <TextBox Grid.Row="1" Grid.Column="1" x:Name="WorkshopPathBox"/>
        <Button Grid.Row="1" Grid.Column="2" x:Name="BrowseWorkshopButton" Content="选择"/>
        <TextBlock Grid.Row="2" VerticalAlignment="Center" Text="缓存/存档"/>
        <TextBox Grid.Row="2" Grid.Column="1" x:Name="CachePathBox"/>
        <Button Grid.Row="2" Grid.Column="2" x:Name="BrowseCacheButton" Content="选择"/>
        <TextBlock Grid.Row="3" VerticalAlignment="Center" Text="工具目录"/>
        <TextBox Grid.Row="3" Grid.Column="1" x:Name="RootPathBox" IsReadOnly="True" Background="#EEF1F4"/>
        <Button Grid.Row="3" Grid.Column="2" x:Name="DetectButton" Content="自动检测"/>
      </Grid>
    </GroupBox>

    <GroupBox Grid.Row="2" Header="2. 创建与管理冻结版本">
      <Grid>
        <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
        <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
        <StackPanel Grid.Row="0" Orientation="Horizontal">
          <Button x:Name="CreateButton" Content="一键创建冻结版本" Background="#2F9E72" Foreground="White" FontWeight="SemiBold"/>
          <Button x:Name="PreflightButton" Content="只做预检"/>
          <Button x:Name="LaunchButton" Content="启动当前冻结版"/>
          <Button x:Name="VerifyButton" Content="完整校验"/>
          <Button x:Name="BackupButton" Content="备份存档"/>
        </StackPanel>
        <StackPanel Grid.Row="0" Grid.Column="1" Orientation="Horizontal" VerticalAlignment="Center">
          <ComboBox x:Name="ProfilesBox" Width="260" Margin="4" DisplayMemberPath="Display"/>
          <Button x:Name="UseProfileButton" Content="设为当前"/>
          <Button x:Name="RefreshButton" Content="刷新"/>
        </StackPanel>
        <StackPanel Grid.Row="1" Grid.ColumnSpan="2" Orientation="Horizontal">
          <Button x:Name="MigrationPreviewButton" Content="检查可迁移内容"/>
          <Button x:Name="MigrateButton" Content="增量迁移到当前版本" Background="#D9892B" Foreground="White" FontWeight="SemiBold"/>
          <Button x:Name="RollbackMigrationButton" Content="回迁最近一次"/>
          <TextBlock Text="只补齐缺失文件与缺失 Mod ID；已有文件不覆盖" VerticalAlignment="Center" Foreground="#596773" Margin="12,0,0,0"/>
        </StackPanel>
      </Grid>
    </GroupBox>

    <GroupBox Grid.Row="3" Header="运行日志">
      <Grid>
        <TextBox x:Name="LogBox" IsReadOnly="True" AcceptsReturn="True" TextWrapping="NoWrap"
                 VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"
                 FontFamily="Consolas, Microsoft YaHei UI" FontSize="13" Background="#101820" Foreground="#D8E3EA"/>
      </Grid>
    </GroupBox>

    <Grid Grid.Row="4" Margin="8,2">
      <Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
      <ProgressBar x:Name="BusyBar" Height="7" IsIndeterminate="False" Visibility="Hidden"/>
      <StackPanel Grid.Column="1" Orientation="Horizontal">
        <Button x:Name="OpenButton" Content="打开工具目录"/>
        <Button x:Name="OpenDocsButton" Content="使用说明"/>
      </StackPanel>
    </Grid>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)
$names = @('StatusText','GamePathBox','WorkshopPathBox','CachePathBox','RootPathBox','DetectButton',
    'BrowseGameButton','BrowseWorkshopButton','BrowseCacheButton','CreateButton','PreflightButton','LaunchButton','VerifyButton',
    'BackupButton','MigrationPreviewButton','MigrateButton','RollbackMigrationButton','ProfilesBox','UseProfileButton','RefreshButton','LogBox','BusyBar','OpenButton','OpenDocsButton')
foreach($name in $names){Set-Variable -Name $name -Value $window.FindName($name) -Scope Script}
$RootPathBox.Text = $script:AppRoot

function Add-Log([string]$Text){
    if([string]::IsNullOrWhiteSpace($Text)){return}
    $LogBox.AppendText("$Text`r`n")
    $LogBox.ScrollToEnd()
}

function Set-Busy([bool]$Busy,[string]$Text){
    $BusyBar.IsIndeterminate=$Busy
    $BusyBar.Visibility=if($Busy){'Visible'}else{'Hidden'}
    $StatusText.Text=$Text
    foreach($control in @($DetectButton,$CreateButton,$PreflightButton,$LaunchButton,$VerifyButton,$BackupButton,$MigrationPreviewButton,$MigrateButton,$RollbackMigrationButton,$UseProfileButton,$RefreshButton)){
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

function Refresh-Profiles {
    $ProfilesBox.Items.Clear()
    $profileRoot=Join-Path $script:AppRoot 'profiles'
    if(-not(Test-Path -LiteralPath $profileRoot)){return}
    $currentPath=Join-Path $script:AppRoot 'current-freeze.json'
    $current=if(Test-Path -LiteralPath $currentPath){Get-Content -LiteralPath $currentPath -Raw|ConvertFrom-Json}else{$null}
    $selected=-1
    foreach($file in @(Get-ChildItem -LiteralPath $profileRoot -Filter freeze.json -File -Recurse -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending)){
        try{
            $cfg=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
            $item=[pscustomobject]@{Display=("{0} · build {1} · {2}" -f $cfg.Version,$cfg.BuildID,([datetime]$cfg.Created).ToString('yyyy-MM-dd HH:mm'));ConfigPath=$file.FullName;FreezeRoot=$cfg.FreezeRoot}
            [void]$ProfilesBox.Items.Add($item)
            if($current -and $current.FreezeRoot -ieq $cfg.FreezeRoot){$selected=$ProfilesBox.Items.Count-1}
        }catch{Add-Log "[警告] 无法读取配置：$($file.FullName)"}
    }
    if($ProfilesBox.Items.Count -gt 0){$ProfilesBox.SelectedIndex=if($selected -ge 0){$selected}else{0}}
}

function Use-SelectedProfile {
    $item=$ProfilesBox.SelectedItem
    if(-not $item){[System.Windows.MessageBox]::Show('请先选择一个冻结版本。','PZ Freezer')|Out-Null;return}
    $cfg=Get-Content -LiteralPath $item.ConfigPath -Raw|ConvertFrom-Json
    $cfg.ManagerRoot=$script:AppRoot
    $cfg|ConvertTo-Json -Depth 15|Set-Content -LiteralPath (Join-Path $script:AppRoot 'current-freeze.json') -Encoding UTF8
    Add-Log "[通过] 当前冻结版本已切换为：$($item.Display)"
    $StatusText.Text='已切换版本'
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
        $answer=[System.Windows.MessageBox]::Show("将创建完整独立副本并计算 SHA-256。`n`n请先退出游戏；操作可能持续较长时间，并需要足够磁盘空间。`n不会修改 Steam 原版。`n`n是否继续？",'创建冻结版本','YesNo','Question')
        if($answer -ne 'Yes'){return}
    }
    if($Action -eq 'Migrate'){
        $answer=[System.Windows.MessageBox]::Show("当前目标通常已经包含游戏本体和 MOD。`n`n继续后只会补齐缺失文件和缺失 Mod ID，不覆盖已有文件；不会执行全量完整性哈希。工具会先备份存档并保存迁移事务，可用「回迁最近一次」撤回。`n`n确认继续？",'确认增量迁移','YesNo','Warning')
        if($answer -ne 'Yes'){return}
    }
    if($Action -eq 'RollbackMigration'){
        $answer=[System.Windows.MessageBox]::Show("将撤回最近一次增量迁移。若本次新增文件后来发生过修改，回迁会自动停止，不会强制删除。`n`n确认继续？",'确认回迁','YesNo','Warning')
        if($answer -ne 'Yes'){return}
    }
    $busyText=switch($Action){'Create'{'正在创建'}'Preflight'{'正在预检'}'PreviewMigration'{'正在检查迁移'}'Migrate'{'正在迁移'}'RollbackMigration'{'正在回迁'}'Verify'{'正在校验'}'BackupSave'{'正在备份'}'Launch'{'正在启动'}default{'正在执行'}}
    Set-Busy $true $busyText
    Add-Log ("[{0}] 开始执行：{1}" -f (Get-Date -Format 'HH:mm:ss'),$Action)
    $manager=$script:Manager;$root=$script:AppRoot;$game=$GamePathBox.Text;$workshop=$WorkshopPathBox.Text;$cache=$CachePathBox.Text
    $script:Job=Start-Job -ScriptBlock {
        param($Manager,$ActionName,$Root,$Game,$Workshop,$Cache)
        $args=@('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',$Manager,'-Action',$ActionName,'-ManagerRoot',$Root)
        if($ActionName -in @('Create','Preflight','PreviewMigration','Migrate')){$args+=@('-SourceGame',$Game,'-SourceWorkshop',$Workshop,'-SourceCache',$Cache)}
        if($ActionName -eq 'Migrate'){$args+='-ConfirmedExistingTarget'}
        & powershell.exe @args 2>&1|ForEach-Object{$_.ToString()}
        if($LASTEXITCODE -ne 0){throw "核心进程退出码：$LASTEXITCODE"}
    } -ArgumentList $manager,$Action,$root,$game,$workshop,$cache
    $JobTimer.Start()
}

$JobTimer=New-Object Windows.Threading.DispatcherTimer
$JobTimer.Interval=[TimeSpan]::FromMilliseconds(600)
$JobTimer.Add_Tick({
    if(-not $script:Job){return}
    foreach($line in @(Receive-Job -Job $script:Job -ErrorAction SilentlyContinue)){Add-Log $line.ToString()}
    if($script:Job.State -in @('Completed','Failed','Stopped')){
        $state=$script:Job.State
        foreach($line in @(Receive-Job -Job $script:Job -ErrorAction SilentlyContinue)){Add-Log $line.ToString()}
        if($state -eq 'Completed'){Add-Log '[完成] 操作已结束。';Set-Busy $false '操作完成'}
        else{Add-Log ("[失败] 后台任务状态：{0}" -f $state);Set-Busy $false '操作失败'}
        Remove-Job -Job $script:Job -Force -ErrorAction SilentlyContinue
        $script:Job=$null
        $JobTimer.Stop()
        Refresh-Profiles
    }
})

$DetectButton.Add_Click({Invoke-Detection})
$BrowseGameButton.Add_Click({Select-Folder $GamePathBox '选择 Project Zomboid 游戏本体目录'})
$BrowseWorkshopButton.Add_Click({Select-Folder $WorkshopPathBox '选择 Steam Workshop 的 108600 目录'})
$BrowseCacheButton.Add_Click({Select-Folder $CachePathBox '选择 Zomboid 缓存/存档目录'})
$CreateButton.Add_Click({Start-ManagerAction 'Create'})
$PreflightButton.Add_Click({Start-ManagerAction 'Preflight'})
$MigrationPreviewButton.Add_Click({Start-ManagerAction 'PreviewMigration'})
$MigrateButton.Add_Click({Start-ManagerAction 'Migrate'})
$RollbackMigrationButton.Add_Click({Start-ManagerAction 'RollbackMigration'})
$LaunchButton.Add_Click({Start-ManagerAction 'Launch'})
$VerifyButton.Add_Click({Start-ManagerAction 'Verify'})
$BackupButton.Add_Click({Start-ManagerAction 'BackupSave'})
$RefreshButton.Add_Click({Refresh-Profiles})
$UseProfileButton.Add_Click({Use-SelectedProfile})
$OpenButton.Add_Click({Start-Process explorer.exe -ArgumentList $script:AppRoot})
$OpenDocsButton.Add_Click({
    $doc=Join-Path $script:AppRoot 'README.md'
    if(Test-Path -LiteralPath $doc){Start-Process $doc}else{Start-Process explorer.exe -ArgumentList (Join-Path $script:AppRoot 'docs')}
})
$window.Add_Closing({param($sender,$e)
    if($script:Job -and $script:Job.State -in @('Running','NotStarted')){
        [System.Windows.MessageBox]::Show('创建或校验仍在进行，请等待操作完成后再关闭。','PZ Freezer','OK','Warning')|Out-Null
        $e.Cancel=$true
    }
})

Refresh-Profiles
if($SelfTest){
    if(-not $window -or -not $CreateButton -or -not $LogBox){throw 'GUI 控件初始化失败。'}
    'GUI_SELF_TEST_PASS'
    return
}

$window.Add_ContentRendered({if(-not $GamePathBox.Text){Invoke-Detection}})
[void]$window.ShowDialog()
