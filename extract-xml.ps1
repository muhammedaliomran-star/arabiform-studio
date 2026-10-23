$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.IO.Compression.FileSystem

$desktop = Join-Path $env:USERPROFILE 'Desktop'
$files = Get-ChildItem -Path $desktop -Filter '*.docx' -File -ErrorAction SilentlyContinue
$temp = Join-Path $env:TEMP 'opencode'
if (-not (Test-Path $temp)) { New-Item -ItemType Directory -Path $temp | Out-Null }

foreach ($f in $files) {
    $dest = Join-Path $temp ($f.BaseName + '.docx')
    try {
        Copy-Item -Path $f.FullName -Destination $dest -Force -ErrorAction Stop
    } catch {
        Write-Host ('SKIP (locked): ' + $f.Name)
        continue
    }

    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($dest)
    } catch {
        Write-Host ('SKIP (not a zip): ' + $f.Name)
        continue
    }

    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' } | Select-Object -First 1
    if (-not $entry) { $zip.Dispose(); Write-Host ('SKIP (no document.xml): ' + $f.Name); continue }

    $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
    $xml = $reader.ReadToEnd()
    $reader.Close()
    $zip.Dispose()

    $rows = ([regex]::Matches($xml, '<w:tr[\s>]')).Count
    $hl = ([regex]::Matches($xml, '<w:highlight[^>]*w:val="yellow"')).Count
    Write-Host ('FILE: ' + $f.Name + '   rows=' + $rows + '   yellowHL=' + $hl + '   xmlLen=' + $xml.Length)

    if ($rows -eq 9) {
        $out = 'D:\stararabiform\raw-xml.txt'
        [System.IO.File]::WriteAllText($out, $xml, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host ('     -> written to ' + $out)
    }
}
