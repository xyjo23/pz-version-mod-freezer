using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("PZ Version & Mod Freezer")]
[assembly: AssemblyDescription("Portable Project Zomboid version and mod snapshot manager")]
[assembly: AssemblyProduct("PZ Version & Mod Freezer")]
[assembly: AssemblyCompany("xyjo23")]
[assembly: AssemblyVersion("0.5.4.0")]
[assembly: AssemblyFileVersion("0.5.4.0")]

internal static class PZFreezerLauncher
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string script = FindScript(root);
            if (!File.Exists(script))
                throw new FileNotFoundException("没有找到程序文件夹中的 PZ-Freezer.ps1。请完整解压 ZIP，并保持 EXE 与程序文件夹在同一位置。", script);
            string appRoot = Path.GetDirectoryName(script);

            string windows = Environment.GetEnvironmentVariable("WINDIR") ?? @"C:\Windows";
            string powershell = Path.Combine(windows, @"System32\WindowsPowerShell\v1.0\powershell.exe");
            string arguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File " + Quote(script);
            foreach (string argument in args) arguments += " " + Quote(argument);
            var start = new ProcessStartInfo
            {
                FileName = powershell,
                Arguments = arguments,
                WorkingDirectory = appRoot,
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

    private static string FindScript(string root)
    {
        string besideExe = Path.Combine(root, "PZ-Freezer.ps1");
        if (File.Exists(besideExe)) return besideExe;
        string[] folders = Directory.GetDirectories(root);
        Array.Sort(folders, StringComparer.OrdinalIgnoreCase);
        Array.Reverse(folders);
        foreach (string folder in folders)
        {
            string candidate = Path.Combine(folder, "PZ-Freezer.ps1");
            if (File.Exists(candidate)) return candidate;
        }
        return besideExe;
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
