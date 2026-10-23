$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem

$desktop = Join-Path $env:USERPROFILE 'Desktop'
$files = Get-ChildItem -Path $desktop -Filter '*.docx' -File -ErrorAction SilentlyContinue | Sort-Object Name
$temp = Join-Path $env:TEMP 'opencode'
if (-not (Test-Path $temp)) { New-Item -ItemType Directory -Path $temp | Out-Null }

$i = 0
foreach ($f in $files) {
    $i++
    $dest = Join-Path $temp ('d' + $i + '.docx')
    try { Copy-Item -Path $f.FullName -Destination $dest -Force -ErrorAction Stop }
    catch { Write-Host ('SKIP locked: ' + $f.Name); continue }

    try { $zip = [System.IO.Compression.ZipFile]::OpenRead($dest) }
    catch { Write-Host ('SKIP not zip: ' + $f.Name); continue }

    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' } | Select-Object -First 1
    if (-not $entry) { $zip.Dispose(); continue }

    $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    $xml = $reader.ReadToEnd()
    $reader.Close()
    $zip.Dispose()

    $out = 'D:\stararabiform\raw-xml-' + $i + '.txt'
    [System.IO.File]::WriteAllText($out, $xml, (New-Object System.Text.UTF8Encoding($false)))

    $rows = ([regex]::Matches($xml, '<w:tr[\s>]')).Count
    $tbls = ([regex]::Matches($xml, '<w:tbl[\s>]')).Count
    $hl = ([regex]::Matches($xml, '<w:highlight[^>]*w:val="yellow"')).Count
    $shd = ([regex]::Matches($xml, '<w:shd[\s>]')).Count
    Write-Host ('#' + $i + '  ' + $f.Name + '   size=' + $f.Length + '  tables=' + $tbls + '  rows=' + $rows + '  yellowHL=' + $hl + '  shd=' + $shd + '  -> ' + (Split-Path $out -Leaf))
}
