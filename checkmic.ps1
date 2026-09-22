$ErrorActionPreference = 'SilentlyContinue'
Write-Host "=== App mic permission (ffmpeg) ==="
$paths = @(
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged'
)
foreach ($p in $paths) {
  if (Test-Path $p) {
    Get-ChildItem $p | ForEach-Object {
      $val = (Get-ItemProperty $_.PSPath).Value
      if ($val -ne 'Allow' -or $true) { Write-Host "$($_.PSChildName.Substring(0, [Math]::Min(60, $_.PSChildName.Length))) = $val" }
    }
  } else { Write-Host "path not found: $p" }
}
