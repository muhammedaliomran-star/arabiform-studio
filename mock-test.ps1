$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$script:fail = 0
function Check([string]$name, [bool]$cond, [string]$detail = '') {
    if ($cond) { Write-Host ('PASS  ' + $name) }
    else { Write-Host ('FAIL  ' + $name + '   |  ' + $detail); $script:fail++ }
}
function U([int[]]$codes) { return (-join ($codes | ForEach-Object { [char]$_ })) }

# Arabic option letters (mirrors AR_OPTION_LETTER in doc-parser.ts)
$arCodes = 0x0623, 0x0625, 0x0622, 0x0627, 0x0628, 0x062C, 0x062F, 0x0647, 0x0632, 0x062D, 0x0637, 0x064A
$AR = '[' + (($arCodes | ForEach-Object { '\u{0:x4}' -f $_ }) -join '') + ']'

# passage/intro block markers (mirrors PASSAGE_MARK_RE / PASSAGE_TITLE_RE in doc-parser.ts)
$PASSAGE_MARK = '^[\u25A0\u25AA\u25CF\u2605\u25A1\u2B1B\u258C]\s*\S'
$PASSAGE_TITLE = '^(?:\u0646\u0635|\u0627\u0644\u0646\u0635|\u0627\u0644\u0642\u0631\u0627\u0621\u0629|\u0627\u0644\u0642\u0635\u0629|\u0627\u0644\u0627\u0633\u062A\u0645\u0627\u0639|\u0627\u0644\u0645\u0642\u0631\u0648\u0621|\u0627\u0644\u0646\u0635 \u0627\u0644\u062A\u0645\u0647\u0649\u062F\u064A)\s*[\(\uFF08]\s*\S'
$PROSE_SOFT = 100
$PROSE_HARD = 150
$BLANK_RE = '_{2,}|\.{4,}|\u2026{1,}'

function Test-AnswerBlank([string]$s) { return ($s -cmatch $BLANK_RE) }
function Test-PassageStart([string]$s) { return ($s -cmatch $PASSAGE_MARK -or $s -cmatch $PASSAGE_TITLE) }

# ---------------------------------------------------------------- extraction
# exact port of readDocxFile() paragraph/run extraction (fixed runRe + yellow shading)
function Test-YellowFill([string]$hex) {
    $n = 0
    if (-not [int]::TryParse($hex, [System.Globalization.NumberStyles]::HexNumber, $null, [ref]$n)) { return $false }
    $r = ($n -shr 16) -band 0xFF
    $g = ($n -shr 8) -band 0xFF
    $b = $n -band 0xFF
    return ($r -ge 200 -and $g -ge 180 -and $b -lt 200 -and ($r - $b) -ge 40)
}

function Test-YellowShading([string]$frag) {
    $m = [regex]::Match($frag, '<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"', 'IgnoreCase')
    if (-not $m.Success) { return $false }
    return Test-YellowFill $m.Groups[1].Value
}

function Get-XmlLines([string]$xml) {
    $out = New-Object System.Collections.ArrayList
    $stack = New-Object System.Collections.Stack
    # نجمع التوكنات أولاً حتى تكون حدود كل فقرة معلومة (الفقرات ذاتية الإغلاق
    # <w:p .../> لا تحوي </w:p> ولا يجوز أن يمتد البحث خلفها إلى فقرة تالية).
    $tokens = [regex]::Matches($xml, '<w:tc[\s>]|</w:tc[\s>]|<w:p[\s>]')
    for ($ti = 0; $ti -lt $tokens.Count; $ti++) {
        $t = $tokens[$ti]
        $tok = $t.Value
        if ($tok.StartsWith('</w:tc')) { if ($stack.Count -gt 0) { [void]$stack.Pop() }; continue }
        if ($tok.StartsWith('<w:tc')) {
            $prEnd = $xml.IndexOf('</w:tcPr>', $t.Index)
            $firstP = $xml.IndexOf('<w:p', $t.Index)
            $headEnd = if ($prEnd -ge 0) { $prEnd + 9 } else { $t.Index + 1500 }
            if ($firstP -ge 0 -and $firstP -lt $headEnd) { $headEnd = $firstP }
            $len = [Math]::Min($headEnd, $xml.Length) - $t.Index
            [void]$stack.Push((Test-YellowShading $xml.Substring($t.Index, $len)))
            continue
        }
        $paraStart = $t.Index + $tok.Length
        $nextIdx = if (($ti + 1) -lt $tokens.Count) { $tokens[$ti + 1].Index } else { $xml.Length }
        $paraEnd = $xml.IndexOf('</w:p>', $paraStart)
        if ($paraEnd -lt 0 -or $nextIdx -lt $paraEnd) { $paraEnd = $nextIdx }
        $content = $xml.Substring($paraStart, $paraEnd - $paraStart)
        $parts = New-Object System.Collections.ArrayList
        foreach ($m in [regex]::Matches($content, '<w:r[\s>]([\s\S]*?)</w:r>')) {
            $run = $m.Groups[1].Value
            $hl = ($run -cmatch '<w:highlight[^>]*w:val="yellow"') -or (Test-YellowShading $run)
            $tm = [regex]::Match($run, '<w:t[^>]*>([^<]*)</w:t>')
            if (-not $tm.Success) { continue }
            $text = $tm.Groups[1].Value
            if ($text.Length -eq 0) { continue }
            if ($hl) { [void]$parts.Add('[[HL]]' + $text + '[[/HL]]') } else { [void]$parts.Add($text) }
        }
        $pPrIdx = $content.IndexOf('<w:pPr')
        $pPrEnd = $content.IndexOf('</w:pPr>')
        $paraShaded = $false
        if ($pPrIdx -ge 0 -and $pPrEnd -gt $pPrIdx) {
            $pPrStop = [Math]::Min($pPrEnd + 9, $content.Length)
            $paraShaded = Test-YellowShading $content.Substring($pPrIdx, $pPrStop - $pPrIdx)
        }
        $cellHL = $false
        foreach ($v in $stack) { if ($v) { $cellHL = $true; break } }
        $line = (($parts -join '').Trim())
        if (($paraShaded -or $cellHL) -and $line.Length -gt 0) { $line = '[[HL]]' + $line + '[[/HL]]' }
        [void]$out.Add($line)
    }
    return $out
}

# ---------------------------------------------------------------- parser port
function Strip-HL([string]$s) { return $s.Replace('[[HL]]', '').Replace('[[/HL]]', '').Trim() }

function Strip-SourceNumber([string]$s) {
    $t = $s
    $t = $t -replace '^[A-Za-z]{1,4}[\.\-]\d{1,3}[\)\.\-\:\s]\s*', ''      # /i in TS
    $t = $t -creplace '^[\u0621-\u064A]{1,3}[\.\-]\s*[\u0660-\u0669]{1,3}[\)\.\-\uFF1D\s]\s*', ''
    $t = $t -creplace '^[\u0660-\u0669]{1,3}[\.\uFF1E\u066B\u06D4]\s*', ''
    $t = $t -creplace '^\d{1,3}[\.\uFF1E]\s*', ''
    $t = $t -creplace '^[\u0660-\u0669]{1,3}\s+', ''
    $t = $t -creplace '^\d{1,3}\s+', ''
    $t = $t -creplace '^[\u0621-\u064A]{1,3}[\.\-]\s+', ''
    return $t.Trim()
}

function Test-QuestionNumberLine([string]$s) {
    if ($s -match '^[A-Za-z]{1,4}[\.\-]\d{1,3}[\)\.\-\:\s]') { return $true }   # /i in TS
    if ($s -cmatch '^[\u0621-\u064A]{1,3}[\.\-]\s*[\u0660-\u0669]{1,3}[\)\.\-\uFF1D\s]') { return $true }
    if ($s -cmatch '^[\u0660-\u0669]{1,3}[\.\uFF1E\u066B\u06D4]') { return $true }
    if ($s -cmatch '^\d{1,3}[\.\uFF1E]') { return $true }
    if ($s -cmatch '^(?:[\u0660-\u0669]{1,3}|\d{1,3})\s+[\u0621-\u064A]') { return $true }
    return $false
}

function Test-SectionHeader([string]$s) {
    return ($s -cmatch '^(?:\u0642\u0633\u0645|\u0627\u0644\u0641\u0635\u0644|\u0627\u0644\u0648\u062d\u062f\u0629|\u0627\u0644\u062f\u0631\u0633|\u0627\u0644\u0628\u0627\u0628)[\s(\u0600-\u06FF]')
}

function Get-OptionText([string]$s) {
    $t = $s
    $t = $t -creplace '^[\u0660-\u0669]{1,2}[\-\.\)\uFF1D\uFF1A:]\s*', ''
    $t = $t -creplace '^[\u0660-\u0669]{1,2}\s+', ''
    $t = $t -creplace '^[\u0660-\u0669]{1,2}(?=[\u0621-\u064A])', ''
    $t = $t -creplace '^\d{1,2}[\-\.\)\uFF1D\uFF1A:]\s*', ''
    $t = $t -creplace '^\d{1,2}\s+', ''
    $t = $t -creplace '^\d{1,2}(?=[\u0621-\u064A])', ''
    $t = $t -creplace '^[\u0621-\u064A][\)\.\uFF1A:]\s*', ''
    $t = $t -creplace ('^' + $AR + '\s+'), ''
    $t = $t -creplace '^[A-Za-z]{1,2}[\)\.\uFF1A:]\s*', ''
    $t = $t -creplace '^[A-Da-d]\s+', ''
    return $t.Trim()
}

function Test-OptionPrefix([string]$s) {
    if ($s -cmatch '^(?:[\u0660-\u0669]{1,2}|\d{1,2})[\-\.\)\uFF1D\uFF1A:]\s*\S') { return $true }
    if ($s -cmatch '^(?:[\u0660-\u0669]{1,2}|\d{1,2})(?=[\u0621-\u064A])') { return $true }
    if ($s -cmatch '^[\u0621-\u064A][\)\.\uFF1A:]\s*\S') { return $true }
    if ($s -cmatch ('^' + $AR + '\s+(?=\S)')) { return $true }
    if ($s -cmatch '^(?:[\u0621-\u064A]{1,2}|[A-Za-z]{1,2})[\)\uFF1A:]\s*\S') { return $true }
    if ($s -cmatch '^[A-Da-d]\s+(?=\S)') { return $true }
    return $false
}

function Split-TitleOption([string]$s) {
    $re = '(?:^|\s)(?:\[\[HL\]\])? ?(' + $AR + '|[A-Da-d])(?:\[\[/HL\]\])?(?:[\)\.\uFF1A:]?\s+(?:\[\[HL\]\])? ?)([^:]{1,60})$'
    $m = [regex]::Match($s, $re)
    $none = [pscustomobject]@{ before = $s; option = $null; highlighted = $false }
    if (-not $m.Success) { return $none }
    $before = Strip-HL $s.Substring(0, $m.Index)
    $tail = Strip-HL $m.Groups[2].Value
    if ($before.Length -lt 5 -or $tail.Length -eq 0) { return $none }
    if ($tail -cnotmatch '^[\u0621-\u064A0-9A-Za-z]') { return $none }
    $hl = $s.Substring($m.Index).Contains('[[HL]]')
    return [pscustomobject]@{ before = $before; option = $tail; highlighted = $hl }
}

function Parse-DocText([string]$raw) {
    # tatweel removal happens on the raw text (mirrors TS)
    $raw = $raw.Replace([string][char]0x0640, '')
    $raw = $raw.Replace("`r`n", "`n").Replace("`r", "`n").Replace([string][char]11, "`n")

    $lines = New-Object System.Collections.ArrayList
    foreach ($l in ($raw -split "`n")) {
        $t = $l.Trim()
        if ($t.Length -gt 0) { [void]$lines.Add($t) }
    }

    $blocks = New-Object System.Collections.ArrayList
    $n = $lines.Count
    $qnum = 0
    $i = 0
    $inPassage = $false

    while ($i -lt $n) {
        $cur = $lines[$i]
        $curClean = Strip-HL $cur
        if ($curClean.Length -eq 0) { $i++; continue }

        # start of an intro/passage block ("■ نص (العنوان)")
        if (Test-PassageStart $curClean) { $inPassage = $true; $i++; continue }

        $cleanTitle = Strip-SourceNumber $curClean
        $numberedLine = Test-QuestionNumberLine $curClean
        if ((Test-SectionHeader $curClean) -or (Test-SectionHeader $cleanTitle)) { $inPassage = $false; $i++; continue }

        # inside a passage block: skip prose paragraphs until the next numbered question
        if ($inPassage) {
            if ($numberedLine) { $inPassage = $false }
            else { $i++; continue }
        }

        $options = New-Object System.Collections.ArrayList
        $correct = New-Object System.Collections.ArrayList
        $prefixedCount = 0
        $j = $i + 1

        while ($j -lt $n) {
            $optRaw = $lines[$j]
            $optClean = Strip-HL $optRaw
            if ($optClean.Length -eq 0) { $j++; continue }
            if ((Test-QuestionNumberLine $optClean) -or (Test-SectionHeader $optClean)) { break }
            if (Test-PassageStart $optClean) { break }
            if ($optClean.Length -gt 80) { break }
            if ($optClean -cmatch '[?\u061F]\s*$') { break }

            $prefixed = Test-OptionPrefix $optClean
            $hasColon = $optClean -cmatch '^[^:]{1,60}[:\uFF1A]\s*[^:]{1,60}$'
            $isOpt = $prefixed -or ($hasColon -and $prefixedCount -eq 0)
            if (-not $isOpt) { break }

            $optText = Get-OptionText $optClean
            if ($optText.Length -gt 0) {
                [void]$options.Add($optText)
                if ($optRaw.Contains('[[HL]]')) { [void]$correct.Add($optText) }
                if ($prefixed) { $prefixedCount++ }
            }
            $j++
            if ($options.Count -ge 4) { break }
        }

        if ($options.Count -ge 2) {
            $qnum++
            $split = Split-TitleOption $cur
            $title = $cleanTitle
            if ($null -ne $split.option) {
                $title = Strip-SourceNumber $split.before
                $options.Insert(0, $split.option)
                if ($split.highlighted) { $correct.Insert(0, $split.option) }
            }
            [void]$blocks.Add([pscustomobject]@{
                kind    = 'radio'
                title   = ($qnum.ToString() + '. ' + $title)
                options = @($options.ToArray())
                correct = @($correct.ToArray())
            })
            $i = $j
            continue
        }

        if (Test-OptionPrefix $curClean) { $i++; continue }

        # unnumbered long prose (intro/reading text) is never a question
        if ((-not $numberedLine) -and (-not (Test-AnswerBlank $cleanTitle))) {
            if ($cleanTitle.Length -ge $PROSE_HARD) { $i++; continue }
            if (($cleanTitle.Length -ge $PROSE_SOFT) -and ($cleanTitle -cnotmatch '[\u061F?]\s*[!.]?\s*$')) { $i++; continue }
        }

        if (($cleanTitle.Length -lt 40) -and ($cleanTitle -cnotmatch '[\u061F?]')) { $i++; continue }

        $qnum++
        [void]$blocks.Add([pscustomobject]@{
            kind    = 'short'
            title   = ($qnum.ToString() + '. ' + $cleanTitle)
            options = @()
            correct = @()
        })
        $i++
    }
    return @($blocks.ToArray())
}

function Show-Blocks([string]$label, $blocks) {
    Write-Host ('--- ' + $label + ' : ' + $blocks.Count + ' questions ---')
    foreach ($b in $blocks) {
        Write-Host ('  [' + $b.kind + '] ' + $b.title + '  (' + $b.options.Count + ' opts)')
        foreach ($o in $b.options) {
            $mark = ''
            foreach ($c in $b.correct) { if ($c -eq $o) { $mark = '   <== CORRECT' } }
            Write-Host ('      - ' + $o + $mark)
        }
    }
    Write-Host ''
}

# =================================================================== TEST 1
Write-Host '===== TEST 1 : real docx (word/document.xml, 9-row file) ====='
if (-not (Test-Path 'D:\stararabiform\raw-xml.txt')) {
    Write-Host 'SKIP: raw-xml.txt missing'
    $script:fail++
}
else {
    $xml = Get-Content 'D:\stararabiform\raw-xml.txt' -Raw -Encoding UTF8
    $b1 = Parse-DocText ((Get-XmlLines $xml) -join "`n")
    Show-Blocks 'real docx' $b1

    Check 'real file -> 9 questions' ($b1.Count -eq 9) ('got ' + $b1.Count)
    $allRadio = $true; $allFour = $true
    foreach ($b in $b1) {
        if ($b.kind -ne 'radio') { $allRadio = $false }
        if ($b.options.Count -ne 4) { $allFour = $false }
    }
    Check 'all questions are "radio" (multiple choice)' $allRadio
    Check 'every question has exactly 4 options' $allFour

    if ($b1.Count -ge 9) {
        $q5 = $b1[4]
        Check 'Q5 title is the real analogy text' ($q5.title -cnotmatch '^5\.\s*[\u0623]') $q5.title
        Check 'Q5 has 4 options' ($q5.options.Count -eq 4) (($q5.options -join ' | '))
        $hasPlateau = $false
        foreach ($o in $q5.options) { if ($o -cmatch '^\u0647\u0636\u0628\u0629') { $hasPlateau = $true } }
        Check 'Q5 option (A) is an option, not swallowed by the title' $hasPlateau ($q5.options -join ' | ')

        Check 'Q8 has 4 options' ($b1[7].options.Count -eq 4) (($b1[7].options -join ' | '))
        Check 'Q9 has 4 options' ($b1[8].options.Count -eq 4) (($b1[8].options -join ' | '))
    }

    $cleanPrefix = $true
    foreach ($b in $b1) { foreach ($o in $b.options) { if ($o -cmatch '^[\u0623\u0625\u0627\u0628\u062C\u062F][\s\u00A0]') { $cleanPrefix = $false } } }
    Check 'no option still carries a lone letter prefix' $cleanPrefix

    # splitTitleOption must not damage normal analogy titles
    $exact = $true
    if ($b1.Count -ge 9) {
        if ($b1[0].title -ne '1. ' + (U 0x633,0x64A,0x644,0x627,0x646,0x20,0x3A,0x20,0x62F,0x645)) { $exact = $false }
    }
    Check 'Q1 title unchanged (no bogus split)' $exact ($b1[0].title)
}

# =================================================================== TEST 2
Write-Host '===== TEST 2 : synthetic docx xml (highlight + attribute runs) ====='
$xml2 = Get-Content 'D:\stararabiform\test-sample.xml' -Raw -Encoding UTF8
$b2 = Parse-DocText ((Get-XmlLines $xml2) -join "`n")
Show-Blocks 'synthetic' $b2

Check 'synthetic -> 2 questions' ($b2.Count -eq 2) ('got ' + $b2.Count)
if ($b2.Count -ge 2) {
    Check 'S1 has 4 options' ($b2[0].options.Count -eq 4) ($b2[0].options -join ' | ')
    Check 'S1 captured yellow highlight as correct' ($b2[0].correct.Count -eq 1) ($b2[0].correct -join ' | ')
    Check 'S2 recovered the run with attributes (question text)' ($b2[1].title -match '^2\. ') $b2[1].title
    $s2first = ''
    if ($b2[1].options.Count -gt 0) { $s2first = $b2[1].options[0] }
    Check 'S2 first option is the (A) text' ($s2first -cmatch '^\u0647\u0636\u0628\u0629') $s2first
}

# =================================================================== TEST 3
Write-Host '===== TEST 3 : regression scenarios ====='
$sc = Get-Content 'D:\stararabiform\test-scenarios.txt' -Raw -Encoding UTF8
$b3 = Parse-DocText $sc
Show-Blocks 'scenarios' $b3

Check 'scenarios -> 9 questions' ($b3.Count -eq 9) ('got ' + $b3.Count)
if ($b3.Count -ge 9) {
    Check 'S-A digit+space question + 4 options' (($b3[0].title -match '^1\. ') -and ($b3[0].options.Count -eq 4)) $b3[0].title
    Check 'S-B "V.1" question, number stripped' (($b3[1].title -match '^2\. ') -and ($b3[1].options.Count -eq 4)) $b3[1].title
    $c1 = ''
    if ($b3[2].options.Count -gt 0) { $c1 = $b3[2].options[0] }
    Check 'S-C digit+tight options accepted, prefix stripped' (($b3[2].options.Count -eq 4) -and ($c1 -cmatch '^\u0646\u0635')) $c1
    Check 'S-D digit+separator options accepted' ($b3[3].options.Count -eq 4) ($b3[3].options -join ' | ')
    $wind = U 0x627,0x644,0x631,0x64A,0x627,0x62D
    $e1 = ''
    if ($b3[4].options.Count -gt 0) { $e1 = $b3[4].options[0] }
    Check 'S-E lone-letter options accepted, prefix stripped' (($b3[4].options.Count -eq 4) -and ($e1 -eq $wind)) ($e1 + ' / ' + ($b3[4].options -join ' | '))
}
if ($b3.Count -ge 6) {
    $pen = U 0x627,0x644,0x642,0x644,0x645,0x20,0x3A,0x20,0x643,0x62A,0x627,0x628,0x629
    $paper = U 0x627,0x644,0x648,0x631,0x642
    $firstOpt = ''
    if ($b3[5].options.Count -gt 0) { $firstOpt = $b3[5].options[0] }
    Check 'S-F glued (A) split: title keeps the analogy' ($b3[5].title -eq ('6. ' + $pen)) $b3[5].title
    Check 'S-F glued (A) split: becomes the first option' ($firstOpt -eq $paper) ($firstOpt + ' / ' + ($b3[5].options -join ' | '))
    Check 'S-F has 4 options total' ($b3[5].options.Count -eq 4) ($b3[5].options -join ' | ')
}
if ($b3.Count -ge 9) {
    # P-A: passage block "■ نص (...)" -> its prose is NOT a question
    Check 'P-A passage block yields the numbered question only' (($b3[6].kind -eq 'radio') -and ($b3[6].options.Count -eq 4)) ($b3[6].kind + ' / ' + ($b3[6].options -join ' | '))
    Check 'P-A passage question title has no marker and is short' (($b3[6].title.Length -lt 60) -and ($b3[6].title -cnotmatch '[\u25A0\u25AA\u25CF]')) $b3[6].title
    $twelve = U 0x0661,0x0662,0x20,0x0645,0x0631,0x0629
    $pfirst = ''
    if ($b3[6].options.Count -gt 0) { $pfirst = $b3[6].options[0] }
    Check 'P-A first option is the (A) text' ($pfirst -eq $twelve) ($pfirst + ' / ' + ($b3[6].options -join ' | '))

    # unmarked long prose paragraph is dropped
    # numbered long short-answer question is kept
    Check 'P-B long numbered short-answer question kept' (($b3[7].kind -eq 'short') -and ($b3[7].title -cmatch '^8\. ') -and ($b3[7].title.Length -gt 90)) ($b3[7].kind + ' len=' + $b3[7].title.Length + ' / ' + $b3[7].title)

    # short unnumbered question ending with ? is kept
    Check 'P-C short question with ? kept' (($b3[8].kind -eq 'short') -and ($b3[8].title -cmatch '^9\. ')) ($b3[8].title)
}
$noPassage = $true
foreach ($b in $b3) { if ($b.title -cmatch '[\u25A0\u25AA\u25CF\u2605]') { $noPassage = $false } }
Check 'no passage marker leaked into a question title' $noPassage

# =================================================================== TEST 4
# real exam file with 23 passage blocks (extracted lines, optional)
$exam = 'D:\stararabiform\lines-5.txt'
if ($env:EXAM_FILE) { $exam = $env:EXAM_FILE }
if (Test-Path $exam) {
    Write-Host '===== TEST 4 : real exam with 23 passage blocks ====='
    $rawExam = [System.IO.File]::ReadAllText($exam, [System.Text.Encoding]::UTF8)
    $b4 = Parse-DocText $rawExam
    Write-Host ('--- real exam : ' + $b4.Count + ' questions ---')
    $maxLen = 0
    $markerLeak = $false
    foreach ($b in $b4) {
        if ($b.title.Length -gt $maxLen) { $maxLen = $b.title.Length }
        if ($b.title -cmatch '[\u25A0\u25AA\u25CF\u2605]') { $markerLeak = $true }
    }
    Check 'exam: no passage marker in any title' (-not $markerLeak)
    Check 'exam: no passage paragraph imported (titles < 200 chars)' ($maxLen -lt 200) ('max title len=' + $maxLen)
    Check 'exam: questions recovered' ($b4.Count -ge 5) ('got ' + $b4.Count)
    # only print titles when explicitly asked (they are long)
    if ($env:EXAM_TITLES) {
        Write-Host '--- titles ---'
        foreach ($b in $b4) { Write-Host ('  [' + $b.kind + '] (' + $b.options.Count + ') ' + $b.title) }
    }
}
else {
    Write-Host '===== TEST 4 skipped (lines-5.txt not present) ====='
}
$noHeader = $true
foreach ($b in $b3) { if ($b.title -cmatch '\u0642\u0633\u0645') { $noHeader = $false } }
Check 'section header never became a question' $noHeader

# =================================================================== TEST 5
# تمييز الإجابة الصحيحة: تعبئة خلية صفراء في جدول Word + ملف حقيقي اختياري
Write-Host '===== TEST 5 : yellow-shaded table cells = correct answer ====='
$tbl = -join @(
    '<w:tbl><w:tr>'
    '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFF3A6"/></w:tcPr>'
    '<w:p><w:r><w:t>' + (U 0x627,0x644,0x62E,0x64A,0x627,0x631,0x3A,0x20,0x627,0x644,0x62A,0x631,0x641) + '</w:t></w:r></w:p>'
    '</w:tc>'
    '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="B8501A"/></w:tcPr>'
    '<w:p><w:r><w:t>' + (U 0x647,0x62F,0x631,0x3A,0x20,0x635,0x631,0x641) + '</w:t></w:r></w:p>'
    '</w:tc>'
    '<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFFAF5"/></w:tcPr>'
    '<w:p><w:r><w:t>' + (U 0x62C,0x645,0x639,0x3A,0x20,0x642,0x62A,0x644) + '</w:t></w:r></w:p>'
    '</w:tc>'
    '</w:tr></w:tbl>'
)
# رقم سؤال بصيغة "7." (كما في الملفات الحقيقية) حتى تُبنى كتلة أسئلة تستقبل الخيارات
$qLine = (U 0x37,0x2E,0x20,0x627,0x644,0x62C,0x627,0x628,0x629,0x20,0x645,0x646,0x20,0x627,0x644,0x62A,0x631,0x641,0x61F)
$lines5 = Get-XmlLines $tbl
$b5 = Parse-DocText ($qLine + "`n" + ($lines5 -join "`n"))
Write-Host ('--- shaded-table doc: ' + $b5.Count + ' blocks ---')
Check 'T5: one question block' ($b5.Count -eq 1) ('got ' + $b5.Count)
if ($b5.Count -ge 1) {
    Check 'T5: three options extracted' ($b5[0].options.Count -eq 3) ($b5[0].options -join ' | ')
    $trf = U 0x627,0x644,0x62E,0x64A,0x627,0x631,0x3A,0x20,0x627,0x644,0x62A,0x631,0x641
    Check 'T5: shaded cell became the correct answer' (($b5[0].correct.Count -eq 1) -and ($b5[0].correct[0] -eq $trf)) ($b5[0].correct -join ' | ')
    $optRaw = $false
    foreach ($o in $b5[0].options) { if ($o -cmatch '\[\[') { $optRaw = $true } }
    Check 'T5: no [[HL]] marker leaked into option labels' (-not $optRaw) ($b5[0].options -join ' | ')
}

# ملف وورد حقيقي على الجهاز (تنسيق خلايا مظللة) — يُتخطى إن لم يوجد
$realDocx = "C:\Users\OMRAN\Desktop\الأقسام_الجديدة (1).docx"
if ($env:REAL_DOCX) { $realDocx = $env:REAL_DOCX }
if (Test-Path $realDocx) {
    Write-Host '===== TEST 5b : real docx with shaded cells ====='
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($realDocx)
    $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
    $ms = New-Object System.IO.MemoryStream
    $st = $entry.Open(); $st.CopyTo($ms); $st.Close()
    $realXml = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
    $zip.Dispose()
    $lines5 = Get-XmlLines $realXml
    $hlLines = @($lines5 | Where-Object { $_ -cmatch '\[\[HL\]\]' })
    Write-Host ('--- real docx: ' + $lines5.Count + ' lines, ' + $hlLines.Count + ' highlighted ---')
    Check 'real: at least one highlighted option detected' ($hlLines.Count -ge 1) ('got ' + $hlLines.Count)
    $raw5 = ($lines5 -join "`n")
    $b5r = Parse-DocText $raw5
    $withCorrect = @($b5r | Where-Object { $_.correct -and $_.correct.Count -gt 0 })
    Write-Host ('--- real docx: ' + $b5r.Count + ' questions, ' + $withCorrect.Count + ' with correct answer ---')
    Check 'real: highlighted cells became correct answers' ($withCorrect.Count -ge 1) ('got ' + $withCorrect.Count)
    foreach ($b in $b5r) {
        if (-not $b.correct) { continue }
        foreach ($c in $b.correct) {
            Check ('real: correct "' + $c.Substring(0, [Math]::Min(18, $c.Length)) + '" is one of the options') ($b.options -contains $c) ($b.options -join ' | ')
        }
    }
}
else {
    Write-Host '===== TEST 5b skipped (real docx not present) ====='
}

Write-Host ''
if ($script:fail -eq 0) { Write-Host 'ALL TESTS PASSED' }
else { Write-Host ('FAILURES: ' + $script:fail) }
exit $script:fail
