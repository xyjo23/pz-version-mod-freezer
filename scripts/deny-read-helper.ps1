param(
  [Parameter(Mandatory = $true)]
  [string]$LiteralPath
)

$ErrorActionPreference = 'Stop'
$fileInfo = [System.IO.FileInfo]::new($LiteralPath)
$originalAcl = $fileInfo.GetAccessControl()
$originalSddl = $originalAcl.GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access)
$identity = [System.Security.Principal.SecurityIdentifier]::new([System.Security.Principal.WellKnownSidType]::AuthenticatedUserSid, $null)
$denyRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $identity,
  [System.Security.AccessControl.FileSystemRights]::Read,
  [System.Security.AccessControl.AccessControlType]::Deny
)
$restrictedAcl = $fileInfo.GetAccessControl()
$restrictedAcl.AddAccessRule($denyRule)
$fileInfo.SetAccessControl($restrictedAcl)
try {
  [Console]::Out.WriteLine('DENIED')
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
}
finally {
  $restoredAcl = [System.Security.AccessControl.FileSecurity]::new()
  $restoredAcl.SetSecurityDescriptorSddlForm($originalSddl, [System.Security.AccessControl.AccessControlSections]::Access)
  $fileInfo.SetAccessControl($restoredAcl)
}
