using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("PZ Version & Mod Freezer")]
[assembly: AssemblyDescription("Portable Project Zomboid version and mod snapshot manager")]
[assembly: AssemblyProduct("PZ Version & Mod Freezer")]
[assembly: AssemblyCompany("xyjo23")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

internal static class PZFreezerLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string script = Path.Combine(root, "PZ-Freezer.ps1");
            if (!File.Exists(script))
                throw new FileNotFoundException("缺少主程序文件 PZ-Freezer.ps1。请完整解压发布包后再运行。", script);

            string windows = Environment.GetEnvironmentVariable("WINDIR") ?? @"C:\Windows";
            string powershell = Path.Combine(windows, @"System32\WindowsPowerShell\v1.0\powershell.exe");
            var start = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Quote(script),
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(start);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "PZ Version & Mod Freezer 无法启动",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
