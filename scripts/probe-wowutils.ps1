$dir = "$env:TEMP\wowutils-js"
$content = Get-Content "$dir\3whrly0u4_u86.js" -Raw
$idx = $content.IndexOf("Nymrissa Wavecaller")
Write-Output "nym idx $idx"
if ($idx -ge 0) {
  Write-Output $content.Substring($idx, [Math]::Min(500, $content.Length - $idx))
}

Write-Output "==== files with timer keys ===="
Get-ChildItem $dir -Filter *.js | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $hits = @()
  foreach ($pat in @("dynamicTimer", "bossSpellsUsed", "phaseTimer", "fightEnd", "Raid AOE")) {
    if ($c.Contains($pat)) { $hits += $pat }
  }
  if ($hits.Count -gt 0) {
    Write-Output ("{0}: {1}" -f $_.Name, ($hits -join ", "))
  }
}

Write-Output "==== sample urls ===="
Get-ChildItem $dir -Filter *.js | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  $m = [regex]::Matches($c, "https://[a-zA-Z0-9._/-]+")
  $m | ForEach-Object { $_.Value } | Where-Object { $_ -match "api|cdn|storage|firebase|supabase|boss" } | Select-Object -Unique
} | Select-Object -Unique | Select-Object -First 40
