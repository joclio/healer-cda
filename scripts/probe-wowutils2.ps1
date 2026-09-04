$dir = "$env:TEMP\wowutils-js"
$content = Get-Content "$dir\3whrly0u4_u86.js" -Raw
$idx = $content.IndexOf('Nymrissa Wavecaller")]:')
if ($idx -lt 0) { $idx = $content.IndexOf("Nymrissa Wavecaller") }
Write-Output $content.Substring([Math]::Max(0,$idx-50), 250)

# Also search larger newly downloaded chunks
Get-ChildItem $dir -Filter *.js | Sort-Object Length -Descending | Select-Object -First 8 | ForEach-Object {
  $c = Get-Content $_.FullName -Raw
  if ($c -match "1285681|Soulcoil Ignition|bossSpellsUsed|dynamicTimer") {
    Write-Output ("HIT " + $_.Name + " len=" + $_.Length)
  }
}

# Try likely data endpoints
$urls = @(
  "https://wowutils.com/viserio-cooldowns/api/bosses/nekzali-the-soulcoiler",
  "https://wowutils.com/api/public/bosses/nekzali-the-soulcoiler",
  "https://wowutils.com/viserio-cooldowns/data/bosses/nekzali-the-soulcoiler.json",
  "https://wowutils.com/viserio-cooldowns/images/bosses/the-venomous-abyss/"
)
foreach ($u in $urls) {
  try {
    $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 10
    Write-Output ("OK " + $u + " " + $r.StatusCode + " " + $r.Content.Length)
  } catch {
    Write-Output ("FAIL " + $u + " " + $_.Exception.Message)
  }
}
