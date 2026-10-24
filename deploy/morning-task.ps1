# Run by Windows Task Scheduler at logon (task "lecture-gate morning"): the laptop's morning routine without
# anyone at the keyboard. Waits for Ollama (it starts from the Startup folder), then pulls from Atlas and merges.
# Output goes to data/morning_log.txt.
$root = Split-Path $PSScriptRoot -Parent
$log = Join-Path $root 'data\morning_log.txt'
Set-Location $root
"`n=== $(Get-Date -Format s) morning task" | Out-File $log -Append -Encoding utf8
$ollamaUp = { try { Invoke-RestMethod http://127.0.0.1:11434/api/version -TimeoutSec 5 | Out-Null; $true } catch { $false } }
# The Startup-folder entry can be turned off in Windows settings (it was, 2026-10-21), so start Ollama ourselves.
if (-not (& $ollamaUp)) {
  Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe')
  "started Ollama" | Out-File $log -Append -Encoding utf8
  for ($i = 0; $i -lt 48 -and -not (& $ollamaUp); $i++) { Start-Sleep 5 }
}
if (-not (& $ollamaUp)) {
  "Ollama not reachable after 4 minutes; nothing merged" | Out-File $log -Append -Encoding utf8
  "=== $(Get-Date -Format s) exit 1" | Out-File $log -Append -Encoding utf8
  exit 1
}
npx tsx src/cli/morning.ts *>&1 | Out-File $log -Append -Encoding utf8
$code = $LASTEXITCODE
"=== $(Get-Date -Format s) exit $code" | Out-File $log -Append -Encoding utf8
exit $code # so Task Scheduler shows a failed run
