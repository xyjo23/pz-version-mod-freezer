param(
  [Parameter(Mandatory = $true)]
  [string]$LiteralPath
)

$stream = [System.IO.File]::Open($LiteralPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  [Console]::Out.WriteLine('LOCKED')
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
}
finally {
  $stream.Dispose()
}
