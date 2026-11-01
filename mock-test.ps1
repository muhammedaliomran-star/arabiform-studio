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

# true/false words + answer-key regexes (mirrors TS TF_WORD_RE/TF_MARKER_RE/ANSWER_*_RE)
$TF_SAH = U 0x0635, 0x062D                                     # sah   (correct-true)
$TF_KHATA = U 0x062E, 0x0637, 0x0623                            # khata (false)
$TF_SAWAB = U 0x0635, 0x0648, 0x0627, 0x0628                    # sawab (variant of sah)
$TF_ALT = '(?:\u0635\u062D|\u0635\u0648\u0627\u0628|\u062E\u0637\u0623)'
$TF_WORD = '^[\uFF08(]?\s*' + $TF_ALT + '\s*[\uFF09)]?$'
$TF_MARKER = '[\uFF08(]?\s*(?:\u0635\u062D|\u0635\u0648\u0627\u0628)\s*(?:/|\u2013|\u2014|-|\u060C|,|\u0648|\u0623\u0645|\u0623\u0648)\s*\u062E\u0637\u0623\s*[\uFF09)]?'
$TF_TITLE_DEFAULT = U 0x0635, 0x062D, 0x20, 0x0623, 0x0645, 0x20, 0x062E, 0x0637, 0x0623  # sah am khata
$ANS_INLINE = '^(?:\u0627\u0644\u0625\u062C\u0627\u0628\u0629|\u0627\u0644\u0627\u062C\u0627\u0628\u0629|\u0627\u0644\u062C\u0627\u0628\u0629)(?:\s*\u0627\u0644\u0635\u062D\u064A\u062D\u0629)?(?:\s*\u0647\u064A)?\s*[:\uFF1A]\s*(?:\u0627\u0644\u062E\u064A\u0627\u0631\s+)?(' + $TF_ALT + '|[A-Za-z]|[\u0623-\u064A])\.?\s*$'
$ANS_EN = '^(?:answer|correct(?:\s*answer)?|the\s*answer)\s*(?:is)?\s*[:\uFF1A]\s*(?:option\s*)?(' + $TF_ALT + '|[A-Za-z])\.?\s*$'
$ANS_KEY = '^(?:[\u0660-\u0669]{1,3}|\d{1,3})\s*[\-\.\)\u2013\uFF1D\uFF1A:]\s*(?:\u0625\u062C\u0627\u0628\u0629\s*)?(' + $TF_ALT + '|[A-Za-z]|[\u0623-\u064A])\.?\s*$'
$OPT_LETTER_LINE = '^[\[\u0660-\u0669]*\s*(?:\[\[HL\]\]\s*)?([\u0623\u0625\u0622\u0627\u0628\u0647\u0640\u062F\u062C\u0632\u062D\u0637\u064A\u0643\u0644\u0645\u0646\u0633\u0639\u0641\u0635\u0642\u0631\u0634\u062A\u062B\u062E\u0630\u0636\u0638\u063A]|[A-Da-d])(?:\s*[\)\.\-–—\uFF1A:؟]])?(?:\s*\[\[/HL\]\])?$'
$OPT_LETTERS = U 0x0623, 0x0628, 0x062C, 0x062F, 0x0647, 0x0648, 0x0632, 0x062D, 0x0637, 0x064A, 0x0643, 0x0644, 0x0645, 0x0646, 0x0633, 0x0639, 0x0641, 0x0635, 0x0642, 0x0631, 0x0634, 0x062A, 0x062B, 0x062E, 0x0630, 0x0636, 0x0638, 0x063A

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
    # mc:Fallback is a duplicate copy of mc:Choice (old-Word compatibility);
    # removing it prevents duplicated letters/text that break option grouping.
    $xml = [regex]::Replace($xml, '<mc:Fallback\b[^>]*>[\s\S]*?</mc:Fallback>', '')
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
            # full run text: every <w:t> in order, <w:tab/> as space, <w:br/> as line break
            $runSb = New-Object System.Text.StringBuilder
            foreach ($rt in [regex]::Matches($run, '<w:t(?:\s[^>]*)?>[\s\S]*?</w:t>|<w:tab\b[^>]*\s*/>|<w:br\b[^>]*\s*/>|<w:cr\b[^>]*\s*/>')) {
                $tv = $rt.Value
                if ($tv.StartsWith('<w:t')) {
                    $inner = [regex]::Match($tv, '^<w:t(?:\s[^>]*)?>([\s\S]*)</w:t>$')
                    if ($inner.Success) { [void]$runSb.Append($inner.Groups[1].Value) }
                } elseif ($tv.StartsWith('<w:tab')) {
                    [void]$runSb.Append(' ')
                } else {
                    [void]$runSb.Append([string][char]10)
                }
            }
            $text = $runSb.ToString()
            if ($text.Length -eq 0) { continue }
            # نص الرنز يُحفظ حرفياً (بما فيه المسافات بين الرنز)؛ فاصل الأسطر
            # <w:br/> فقط يبدأ مقطعاً جديداً بتظليله المستقل.
            if ($hl) {
                $piece = New-Object System.Text.StringBuilder
                $firstSeg = $true
                foreach ($seg in ($text -split [char]10)) {
                    if (-not $firstSeg) { [void]$piece.Append([string][char]10) }
                    $firstSeg = $false
                    [void]$piece.Append('[[HL]]' + $seg + '[[/HL]]')
                }
                [void]$parts.Add($piece.ToString())
            }
            else {
                [void]$parts.Add($text)
            }
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
        if ($line.Length -eq 0) { continue }
        foreach ($seg in ($line -split [char]10)) {
            $s2 = $seg.Trim()
            if ($s2.Length -eq 0) { continue }
            if ($paraShaded -or $cellHL) { [void]$out.Add('[[HL]]' + $s2 + '[[/HL]]') }
            else { [void]$out.Add($s2) }
        }
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
    $t = $t -creplace '^\d{1,3}[\-\)\u2013\uFF1D]\s*', ''
    $t = $t -creplace '^[\u0660-\u0669]{1,3}[\-\)\u2013\uFF1D]\s*', ''
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
    # "1- ?" / "3) ...?" / "2- ... (sah / khata)" -- digit+separator and (? at end OR tf marker)
    if ($s -cmatch '^(?:[\u0660-\u0669]{1,3}|\d{1,3})[\-\)\u2013\uFF1D]\s*\S') {
        if ($s -cmatch '[\u061F?]\s*$') { return $true }
        if ($s -cmatch $TF_MARKER) { return $true }
    }
    return $false
}

# mirrors isAnswerLine in doc-parser.ts (inline/en/key answer formats)
function Test-AnswerLine([string]$s) {
    return ($s -cmatch $ANS_INLINE -or $s -cmatch $ANS_EN -or $s -cmatch $ANS_KEY)
}

# mirrors toWesternNum: arabic-indic -> western digits
function Convert-WesternNum([string]$s) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $s.ToCharArray()) {
        $c = [int]$ch
        if ($c -ge 0x0660 -and $c -le 0x0669) { [void]$sb.Append([string][char](0x30 + ($c - 0x0660))) }
        else { [void]$sb.Append($ch) }
    }
    $n = 0
    if ([int]::TryParse($sb.ToString(), [ref]$n)) { return $n }
    return 0
}

# mirrors extractLeadingNum
function Get-LeadingNum([string]$s) {
    $m = [regex]::Match($s, '^(?:[A-Za-z]{1,4}[\.\-])?([\u0660-\u0669]{1,3}|\d{1,3})')
    if (-not $m.Success) { return 0 }
    return Convert-WesternNum $m.Groups[1].Value
}

# mirrors normalizeTFWord: sawab -> sah, strip parens/space
function Get-NormalizeTF([string]$s) {
    $t = $s -replace '[\uFF08()\uFF09\s]', ''
    if ($t -ceq $TF_SAWAB) { return $TF_SAH }
    return $t
}

function Test-TFWord([string]$s) { return ($s -cmatch $TF_WORD) }
function Test-OptionLetterLine([string]$s) { return ($s -cmatch $OPT_LETTER_LINE) }

# mirrors letterToIndex: letter (ar/en) -> option index, $null when unknown
function Get-LetterIndex([string]$raw) {
    $t = $raw.Trim()
    if ($t -cmatch '^[A-Za-z]$') {
        $idx = 'ABCDEFGHIJ'.IndexOf($t.ToUpper())
        if ($idx -ge 0) { return $idx }
        return $null
    }
    $n = $t -replace '[\u064B-\u0652\u0640\u0670]', ''
    $c = $n
    if ($n -cmatch '^[\u0623\u0625\u0622\u0627]$') { $c = [string][char]0x0623 }
    $idx = $OPT_LETTERS.IndexOf($c)
    if ($idx -ge 0) { return $idx }
    return $null
}

# mirrors resolveAnswerToken: token -> option text, $null when it cannot match (never guess)
function Resolve-AnswerToken([string]$token, [string[]]$options) {
    $t = $token.Trim()
    if ($t -ceq $TF_SAH -or $t -ceq $TF_SAWAB -or $t -ceq $TF_KHATA) {
        $w = Get-NormalizeTF $t
        foreach ($o in $options) { if ((Get-NormalizeTF $o.Trim()) -ceq $w) { return $o } }
        return $null
    }
    $idx = Get-LetterIndex $t
    if ($null -eq $idx) { return $null }
    if ($idx -ge $options.Length) { return $null }
    return $options[$idx]
}

# mirrors extractSourceNo
function Get-SourceNo([string]$s) {
    $v = Get-LeadingNum ((Strip-HL $s).Trim())
    if ($v -gt 0) { return $v }
    return $null
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
    $t = $t -creplace '^[\u0621-\u064A][\)\.\-–—\uFF1A:؟]\s*', ''
    $t = $t -creplace ('^' + $AR + '\s+'), ''
    $t = $t -creplace '^[A-Za-z]{1,2}[\)\.\-–—\uFF1A:]\s*', ''
    $t = $t -creplace '^[A-Da-d]\s+', ''
    return $t.Trim()
}

function Test-OptionText([string]$s) {
    # mirrors isOptionTextLine in doc-parser.ts
    $t = (Strip-HL $s).Trim()
    if ($t.Length -eq 0 -or $t.Length -gt 80) { return $false }
    if (Test-OptionLetterLine $t) { return $false }
    if ($t -cmatch '[?\u061F]\s*$') { return $false }
    $colonRe = '^[^:：]{1,60}[:：]\s*[^:：]{1,60}$'
    if ($t -cmatch $colonRe) { return $true }
    # short word/phrase without a question mark (fill-in-the-blank options)
    if ($t.Length -gt 40) { return $false }
    if (Test-QuestionNumberLine $t) { return $false }
    if (Test-SectionHeader $t) { return $false }
    return $true
}

function Test-OptionPrefix([string]$s) {
    if ($s -cmatch '^(?:[\u0660-\u0669]{1,2}|\d{1,2})[\-\.\)\uFF1D\uFF1A:]\s*\S') { return $true }
    if ($s -cmatch '^(?:[\u0660-\u0669]{1,2}|\d{1,2})(?=[\u0621-\u064A])') { return $true }
    if ($s -cmatch '^[\u0621-\u064A][\)\.\-–—\uFF1A:؟]\s*\S') { return $true }
    if ($s -cmatch ('^' + $AR + '\s+(?=\S)')) { return $true }
    if ($s -cmatch '^(?:[\u0621-\u064A]{1,2}|[A-Za-z]{1,2})[\)\.\-–—\uFF1A:]\s*\S') { return $true }
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

function Test-PassageBody([string]$s) {
    # mirrors isPassageBody in doc-parser.ts (normalize: tatweel/harakat removed, spaces collapsed)
    $t = $s -replace '[\u064B-\u0652\u0610-\u061A]', '' -replace '\s+', ' '
    $t = $t.Trim()
    if ($t.Length -lt 35) { return $false }
    if ($t -cmatch '^[?\u061F]') { return $false }
    if ($t -cmatch '[?\u061F]\s*$') { return $false }
    if ($t -cmatch '^(?:[\u0660-\u0669]{1,2}|[0-9]{1,2})[\-\.\)\uFF1D\uFF1A:]') { return $false }
    if ($t -cmatch '^[\u0660-\u06690-9]{1,2}\s*[\u0621-\u064A]') { return $false }
    return $true
}

# mirrors INLINE_MARKER_RE in doc-parser.ts: option markers (letter + dot/paren/colon)
# inside one line; digit numbering ("1.") is NOT an option marker.
$INLINE_MARKER = '(?:^|[\s\u00A0\t])(?:\[\[HL\]\])?\s*([\u0621-\u064A]|[A-Da-d])[\)\.\-–—\uFF1A:؟](?=[\s\u00A0\t]*(?:\[\[HL\]\])?[\u0621-\u064A A-Za-z])'

# mirrors inlineMarkerMarks: positions of option markers inside the line
function Get-InlineMarks([string]$s) {
    $marks = New-Object System.Collections.ArrayList
    $re = [regex]::new($INLINE_MARKER)
    foreach ($m in $re.Matches($s)) {
        [void]$marks.Add([pscustomobject]@{
            markStart = $m.Index
            textStart = ($m.Index + $m.Length)
            hlMarker  = $m.Value.Contains('[[HL]]')
        })
    }
    return $marks
}

# mirrors segmentsFromMarks: option segments after the first marker
function Get-SegmentsFromMarks([string]$raw, $marks) {
    $segs = New-Object System.Collections.ArrayList
    for ($mi = 0; $mi -lt $marks.Count; $mi++) {
        $end = $raw.Length
        if (($mi + 1) -lt $marks.Count) { $end = $marks[$mi + 1].markStart }
        $len = [Math]::Max(0, $end - $marks[$mi].textStart)
        $segRaw = $raw.Substring($marks[$mi].textStart, $len)
        $segText = Get-OptionText ((Strip-HL $segRaw).Trim())
        if ($segText.Length -eq 0) { continue }
        $hl = $marks[$mi].hlMarker -or $segRaw.Contains('[[HL]]')
        [void]$segs.Add([pscustomobject]@{ text = $segText; hl = $hl })
    }
    return $segs
}

# mirrors splitInlineQuestionLine: stem + all options in one line (horizontal shape)
function Split-InlineQuestionLine([string]$raw) {
    $marks = Get-InlineMarks $raw
    if ($marks.Count -lt 2) { return $null }
    $title = (Strip-SourceNumber (Strip-HL $raw.Substring(0, $marks[0].markStart))).Trim()
    if ($title.Length -lt 2 -or $title.Length -gt 200) { return $null }
    $segs = @(Get-SegmentsFromMarks $raw $marks)
    if ($segs.Count -lt 2) { return $null }
    return [pscustomobject]@{ title = $title; segs = $segs }
}

function Get-TableQuestion([System.Collections.ArrayList]$lines, [int]$start, [int]$n) {
    # Mirrors TS tryParseTableQuestion: groups one table-row question whose options
    # sit on separate lines under standalone letters. Handles duplicated letters
    # (mc:Fallback copies) and unnumbered stems (Word auto-numbering).
    $colonRe = '^[^:：]{1,60}[:：]\s*[^:：]{1,60}$'

    $stemRaw = $lines[$start]
    $stemClean = (Strip-HL $stemRaw).Trim()
    if ($stemClean.Length -eq 0 -or $stemClean.Length -gt 200) { return $null }
    if (Test-OptionLetterLine $stemClean) { return $null }

    $options = New-Object System.Collections.ArrayList
    $correct = New-Object System.Collections.ArrayList
    $labeledCount = 0
    $firstLetterIdx = -1
    $j = $start + 1

    while ($j -lt $n) {
        $raw = $lines[$j]
        $clean = (Strip-HL $raw).Trim()
        if ($clean.Length -eq 0) { $j++; continue }

        if (Test-OptionLetterLine $clean) {
            # skip duplicated consecutive letters (mc:Fallback) and blanks until
            # the real option text line
            $k = $j + 1
            while ($k -lt $n) {
                $t = (Strip-HL $lines[$k]).Trim()
                if ($t.Length -eq 0 -or (Test-OptionLetterLine $t)) { $k++; continue }
                break
            }
            if ($k -ge $n) { break }
            $textRaw = $lines[$k]
            $textClean = (Strip-HL $textRaw).Trim()
            if (-not (Test-OptionText $textClean)) { break }

            if ($firstLetterIdx -lt 0) {
                $lm = [regex]::Match($clean, $OPT_LETTER_LINE)
                $li = $null
                if ($lm.Success) { $li = Get-LetterIndex $lm.Groups[1].Value }
                if ($null -eq $li) { $firstLetterIdx = 0 } else { $firstLetterIdx = $li }
            }

            # option text line carries extra merged options ("opt3 d) opt4") -- split all
            $pieces = $null
            $textMarks = Get-InlineMarks $textRaw
            if ($textMarks.Count -ge 1) {
                $pieces = New-Object System.Collections.ArrayList
                $head = Get-OptionText ((Strip-HL $textRaw.Substring(0, $textMarks[0].markStart)).Trim())
                if ($head.Length -gt 0) { [void]$pieces.Add([pscustomobject]@{ text = $head; hl = $textRaw.Contains('[[HL]]') }) }
                foreach ($seg in (Get-SegmentsFromMarks $textRaw $textMarks)) {
                    $hl2 = $seg.hl -or $textRaw.Contains('[[HL]]')
                    [void]$pieces.Add([pscustomobject]@{ text = $seg.text; hl = $hl2 })
                }
                if ($pieces.Count -eq 0) { $pieces = $null }
            }
            if ($null -eq $pieces) {
                $pieces = @([pscustomobject]@{ text = (Get-OptionText $textClean); hl = $textRaw.Contains('[[HL]]') })
            }

            foreach ($piece in $pieces) {
                if ($piece.text.Length -eq 0) { continue }
                [void]$options.Add($piece.text)
                $labeledCount++
                if ($piece.hl -or $raw.Contains('[[HL]]')) { [void]$correct.Add($piece.text) }
            }
            $j = $k + 1
            if ($options.Count -ge 4) { break }
            continue
        }

        break
    }

    # Only treat as a table question if it has >=2 separately-labeled options
    # (a real table layout); otherwise leave it to the generic parser.
    if ($labeledCount -lt 2) { return $null }

    # The stem itself is option (A) only when letters start from (B) onward --
    # the question column then holds the highlighted option. When letters start
    # from (A), the stem is the question text.
    $stemClean0 = (Strip-HL $stemRaw).Trim()
    $stemIsAnalogy = $stemClean0 -cmatch $colonRe
    $stemHL = $stemRaw.Contains('[[HL]]')
    $stemIsOption = ($firstLetterIdx -ge 1) -and ($stemIsAnalogy -or $stemHL)
    if ($stemIsOption) {
        $stemText = Get-OptionText $stemClean0
        if ($stemText.Length -gt 0) {
            [void]$options.Insert(0, $stemText)
            if ($stemHL) { [void]$correct.Insert(0, $stemText) }
        }
    }

    if ($options.Count -lt 2) { return $null }
    return [pscustomobject]@{
        stemIndex   = $start
        stemIsOption = $stemIsOption
        options     = @($options.ToArray())
        correct     = @($correct.ToArray())
        end         = $j
    }
}

# mirrors collectTrailingOptions in doc-parser.ts: keep consuming option lines
# after a partially-filled question (mixed layout: some options inline, the rest
# stacked on following lines) until MaxTotal options or a stop condition.
# AllowLoneLetter=true also accepts "letter-only line + its text on the next line".
function Get-TrailingOptions([int]$StartJ, $Lines, [int]$N, [string[]]$SeedOptions, [string[]]$SeedCorrect, [int]$SeedPrefixed, [bool]$AllowLoneLetter, [int]$MaxTotal) {
    $options = New-Object System.Collections.ArrayList
    $correct = New-Object System.Collections.ArrayList
    foreach ($o in $SeedOptions) { [void]$options.Add($o) }
    foreach ($c in $SeedCorrect) { [void]$correct.Add($c) }
    $prefixedCount = $SeedPrefixed
    $j = $StartJ

    while ($j -lt $N -and $options.Count -lt $MaxTotal) {
        $optRaw = $Lines[$j]
        $optClean = Strip-HL $optRaw
        if ($optClean.Length -eq 0) { $j++; continue }
        # answer-key line after options -- never swallowed as an option
        if (Test-AnswerLine $optClean) { break }
        if ((Test-QuestionNumberLine $optClean) -or (Test-SectionHeader $optClean)) { break }
        if (Test-PassageStart $optClean) { break }
        if ($optClean.Length -gt 80) { break }
        if ($optClean -cmatch '[?\u061F]\s*$') { break }

        # standalone true/false option ("sah" / "(khata)")
        if (Test-TFWord $optClean) {
            $w = Get-NormalizeTF $optClean
            [void]$options.Add($w)
            if ($optRaw.Contains('[[HL]]')) { [void]$correct.Add($w) }
            $j++
            $prefixedCount++
            continue
        }

        # option letter on its own line followed by a true/false word
        if (Test-OptionLetterLine $optClean) {
            $k = $j + 1
            while ($k -lt $n -and ((Strip-HL $lines[$k]).Trim().Length -eq 0)) { $k++ }
            if ($k -lt $n -and (Test-TFWord ((Strip-HL $lines[$k]).Trim()))) {
                $w = Get-NormalizeTF ((Strip-HL $lines[$k]).Trim())
                [void]$options.Add($w)
                if ($optRaw.Contains('[[HL]]') -or $lines[$k].Contains('[[HL]]')) { [void]$correct.Add($w) }
                $j = $k + 1
                $prefixedCount++
                continue
            }
            # mixed layout: a lone option letter, its text on the next line
            if ($AllowLoneLetter -and $k -lt $n) {
                $textRaw = $lines[$k]
                $textClean = (Strip-HL $textRaw).Trim()
                if (Test-OptionText $textClean) {
                    $loneText = Get-OptionText $textClean
                    if ($loneText.Length -gt 0) {
                        [void]$options.Add($loneText)
                        if ($optRaw.Contains('[[HL]]') -or $textRaw.Contains('[[HL]]')) { [void]$correct.Add($loneText) }
                        $j = $k + 1
                        $prefixedCount++
                        continue
                    }
                }
            }
            break
        }

        # multi options merged into one line (mixed layout): "opt3 d) opt4"
        # a line starting with stem text then options = a new inline question
        $optMarks = Get-InlineMarks $optRaw
        if ($optMarks.Count -ge 1) {
            $headText = (Strip-HL $optRaw.Substring(0, $optMarks[0].markStart)).Trim()
            $multiSegs = Get-SegmentsFromMarks $optRaw $optMarks
            if ($headText.Length -ge 2 -and $multiSegs.Count -ge 1) { break }
            if ($multiSegs.Count -ge 2) {
                foreach ($sg in $multiSegs) {
                    [void]$options.Add($sg.text)
                    if ($sg.hl -or $optRaw.Contains('[[HL]]')) { [void]$correct.Add($sg.text) }
                }
                $prefixedCount += $multiSegs.Count
                $j++
                if ($options.Count -ge $MaxTotal) { break }
                continue
            }
        }

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
        if ($options.Count -ge $MaxTotal) { break }
    }

    return [pscustomobject]@{ end = $j; options = $options; correct = $correct }
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

    # ---- first pass: answer key (inline "الإجابة: ب" / end-of-file "1- ب") ----
    $answerKey = @{}
    $lastSrcNo = 0
    foreach ($rawLine in $lines) {
        $s = (Strip-HL $rawLine).Trim()
        if ($s.Length -eq 0) { continue }
        if (Test-QuestionNumberLine $s) {
            $v = Get-LeadingNum $s
            if ($v -gt 0) { $lastSrcNo = $v }
        }
        $inline = [regex]::Match($s, $ANS_INLINE)
        if (-not $inline.Success) { $inline = [regex]::Match($s, $ANS_EN) }
        if ($inline.Success) {
            if ($lastSrcNo -gt 0) { $answerKey[$lastSrcNo] = $inline.Groups[1].Value }
            continue
        }
        $key = [regex]::Match($s, $ANS_KEY)
        if ($key.Success) {
            $v = Get-LeadingNum $s
            $target = if ($v -gt 0) { $v } else { $lastSrcNo }
            if ($target -gt 0) { $answerKey[$target] = $key.Groups[1].Value }
        }
    }

    while ($i -lt $n) {
        $cur = $lines[$i]
        $curClean = Strip-HL $cur
        if ($curClean.Length -eq 0) { $i++; continue }

        # answer-key lines were consumed in the first pass
        if (Test-AnswerLine $curClean) { $i++; continue }

        # start of an intro/passage block ("■ نص (العنوان)") -> kept as descriptive text (no answer)
        if (Test-PassageStart $curClean) {
            $passageTitle = $curClean -replace '^[\u25A0\u25AA\u25CF\u2605\u2610\u25FC]\s*', ''
            $passageTitle = $passageTitle.Trim()
            $i++
            $paragraphs = New-Object System.Collections.ArrayList
            while ($i -lt $n) {
                $pClean = Strip-HL $lines[$i]
                if ($pClean.Length -eq 0) { $i++; continue }
                if ((Test-QuestionNumberLine $pClean) -or (Test-PassageStart $pClean) -or (Test-SectionHeader $pClean)) { break }
                $pContent = (Strip-SourceNumber $pClean).Trim()
                if (Test-PassageBody $pContent) { [void]$paragraphs.Add($pContent) }
                $i++
            }
            if ($paragraphs.Count -gt 0) {
                [void]$blocks.Add([pscustomobject]@{
                    kind    = 'text'
                    title   = $passageTitle
                    options = @()
                    correct = @()
                    text    = ($paragraphs -join "`n")
                })
            }
            continue
        }

        $cleanTitle = Strip-SourceNumber $curClean
        $numberedLine = Test-QuestionNumberLine $curClean
        if ((Test-SectionHeader $curClean) -or (Test-SectionHeader $cleanTitle)) { $i++; continue }

        # ===== true/false question: stem carries the "(sah / khata)" marker =====
        if ($curClean -cmatch $TF_MARKER) {
            $qnum++
            $tfTitle = Strip-SourceNumber (Strip-HL $cur)
            $tfTitle = (([regex]::new($TF_MARKER)).Replace($tfTitle, ' ', 1)) -replace '\s*[:\uFF1A]\s*$', '' -replace '\s{2,}', ' '
            $tfTitle = $tfTitle.Trim()
            if ($tfTitle.Length -eq 0) { $tfTitle = $TF_TITLE_DEFAULT }
            $correctTf = New-Object System.Collections.ArrayList
            $j = $i + 1
            while ($j -lt $n -and ($j -le ($i + 6))) {
                $rawL = $lines[$j]
                $c = (Strip-HL $rawL).Trim()
                if ($c.Length -eq 0) { $j++; continue }
                if (Test-TFWord $c) {
                    $w = Get-NormalizeTF $c
                    if ($rawL.Contains('[[HL]]')) { [void]$correctTf.Add($w) }
                    $j++
                    continue
                }
                if (Test-OptionLetterLine $c) {
                    $k = $j + 1
                    while ($k -lt $n -and ((Strip-HL $lines[$k]).Trim().Length -eq 0)) { $k++ }
                    if ($k -lt $n -and (Test-TFWord ((Strip-HL $lines[$k]).Trim()))) {
                        $w = Get-NormalizeTF ((Strip-HL $lines[$k]).Trim())
                        if ($rawL.Contains('[[HL]]') -or $lines[$k].Contains('[[HL]]')) { [void]$correctTf.Add($w) }
                        $j = $k + 1
                        continue
                    }
                }
                break
            }
            $tfCorrect = @()
            if ($correctTf.Count -eq 1) { $tfCorrect = @($correctTf[0]) }
            [void]$blocks.Add([pscustomobject]@{
                kind     = 'truefalse'
                title    = ($qnum.ToString() + '. ' + $tfTitle)
                options  = @($TF_SAH, $TF_KHATA)
                correct  = $tfCorrect
                sourceNo = (Get-SourceNo $cur)
            })
            $i = $j
            continue
        }
        # =====================================================================

        # ===== inline question line: stem + all options merged in one line =====
        $inlineQ = Split-InlineQuestionLine $cur
        if ($null -ne $inlineQ) {
            $qnum++
            $hOptions = New-Object System.Collections.ArrayList
            $hCorrect = New-Object System.Collections.ArrayList
            foreach ($sg in $inlineQ.segs) {
                [void]$hOptions.Add($sg.text)
                if ($sg.hl) { [void]$hCorrect.Add($sg.text) }
            }
            # mixed layout: if this line carries fewer than 4 options, keep
            # consuming the option lines that follow (stacked letters/text)
            $inlineEnd = $i + 1
            if ($hOptions.Count -lt 4) {
                $more = Get-TrailingOptions ($i + 1) $lines $n @($hOptions.ToArray()) @($hCorrect.ToArray()) $hOptions.Count $true 4
                $hOptions = $more.options
                $hCorrect = $more.correct
                $inlineEnd = $more.end
            }
            $tfU = New-Object System.Collections.ArrayList
            $allTFh = $true
            foreach ($o in $hOptions) {
                $w = Get-NormalizeTF $o
                if (-not (Test-TFWord $w)) { $allTFh = $false; break }
                if (-not $tfU.Contains($w)) { [void]$tfU.Add($w) }
            }
            $isTFh = ($allTFh -and ($tfU.Count -ge 2))
            $finalH = @($hOptions.ToArray())
            $finalHC = @($hCorrect.ToArray())
            if ($isTFh) {
                $finalH = @($tfU.ToArray())
                $tfCh = New-Object System.Collections.ArrayList
                foreach ($c in $hCorrect) {
                    $w = Get-NormalizeTF $c
                    if ((Test-TFWord $w) -and (-not $tfCh.Contains($w))) { [void]$tfCh.Add($w) }
                }
                $finalHC = @($tfCh.ToArray())
            }
            [void]$blocks.Add([pscustomobject]@{
                kind     = $(if ($isTFh) { 'truefalse' } else { 'radio' })
                title    = ($qnum.ToString() + '. ' + $inlineQ.title)
                options  = $finalH
                correct  = $finalHC
                sourceNo = (Get-SourceNo $cur)
            })
            $i = $inlineEnd
            continue
        }

        # ===== table-row question grouping (4 columns) — priority over generic pass =====
        $tq = Get-TableQuestion $lines $i $n
        if ($null -ne $tq) {
            $qnum++
            $tTitle = (Strip-SourceNumber (Strip-HL $lines[$tq.stemIndex])).Trim()
            [void]$blocks.Add([pscustomobject]@{
                kind     = 'radio'
                title    = ($qnum.ToString() + '. ' + $tTitle)
                options  = @($tq.options)
                correct  = @($tq.correct)
                sourceNo = (Get-SourceNo $lines[$tq.stemIndex])
            })
            $i = $tq.end
            continue
        }
        # ====================================================================

        # lookahead: collect option lines following this line
        $collected = Get-TrailingOptions ($i + 1) $lines $n @() @() 0 $false 4
        $options = $collected.options
        $correct = $collected.correct
        $j = $collected.end

        if ($options.Count -ge 2) {
            $qnum++
            $split = Split-TitleOption $cur
            $title = $cleanTitle
            if ($null -ne $split.option) {
                $title = Strip-SourceNumber $split.before
                $options.Insert(0, $split.option)
                if ($split.highlighted) { $correct.Insert(0, $split.option) }
            }
            # all options are true/false words -> a true/false question with unified options
            $allTF = $true
            $tfUnique = New-Object System.Collections.ArrayList
            foreach ($o in $options) {
                $w = Get-NormalizeTF $o
                if (-not (Test-TFWord $w)) { $allTF = $false; break }
                if (-not $tfUnique.Contains($w)) { [void]$tfUnique.Add($w) }
            }
            $isTF = ($allTF -and ($tfUnique.Count -ge 2))
            $finalOptions = @($options.ToArray())
            $finalCorrect = @($correct.ToArray())
            if ($isTF) {
                $finalOptions = @($tfUnique.ToArray())
                $tfCorr = New-Object System.Collections.ArrayList
                foreach ($c in $correct) {
                    $w = Get-NormalizeTF $c
                    if ((Test-TFWord $w) -and (-not $tfCorr.Contains($w))) { [void]$tfCorr.Add($w) }
                }
                $finalCorrect = @($tfCorr.ToArray())
            }
            [void]$blocks.Add([pscustomobject]@{
                kind     = $(if ($isTF) { 'truefalse' } else { 'radio' })
                title    = ($qnum.ToString() + '. ' + $title)
                options  = $finalOptions
                correct  = $finalCorrect
                sourceNo = (Get-SourceNo $cur)
            })
            $i = $j
            continue
        }

        # orphaned prefixed option line (no parent question) - skip
        # (unless a long numbered "3- ..." line, which may be an essay question)
        $longNumberedEssay = ($curClean -cmatch '^(?:[\u0660-\u0669]{1,3}|\d{1,3})[\-\)\u2013\uFF1D]\s*\S') -and ($curClean.Length -gt 60)
        if ((Test-OptionPrefix $curClean) -and (-not $numberedLine) -and (-not $longNumberedEssay)) { $i++; continue }

        # unnumbered long prose (intro/reading text): kept as descriptive text block
        if ((-not $numberedLine) -and (-not (Test-AnswerBlank $cleanTitle))) {
            if (Test-PassageBody $cleanTitle) {
                [void]$blocks.Add([pscustomobject]@{ kind = 'text'; title = ''; options = @(); correct = @(); text = $cleanTitle })
                $i++
                continue
            }
            if ($cleanTitle.Length -ge $PROSE_HARD) { $i++; continue }
            if (($cleanTitle.Length -ge $PROSE_SOFT) -and ($cleanTitle -cnotmatch '[\u061F?]\s*[!.]?\s*$')) { $i++; continue }
        }

        if (($cleanTitle.Length -lt 40) -and ($cleanTitle -cnotmatch '[\u061F?]')) { $i++; continue }

        $qnum++
        [void]$blocks.Add([pscustomobject]@{
            kind     = 'short'
            title    = ($qnum.ToString() + '. ' + $cleanTitle)
            options  = @()
            correct  = @()
            sourceNo = (Get-SourceNo $cur)
        })
        $i++
    }

    # ---- apply the answer key (highlight wins; NEVER guess a missing answer) ----
    if ($answerKey.Count -gt 0) {
        foreach ($b in $blocks) {
            if ($b.kind -ne 'radio' -and $b.kind -ne 'checkbox' -and $b.kind -ne 'truefalse') { continue }
            if ($b.correct -and @($b.correct).Count -gt 0) { continue }
            if ($null -eq $b.sourceNo) { continue }
            if (-not $answerKey.ContainsKey([int]$b.sourceNo)) { continue }
            $hit = Resolve-AnswerToken $answerKey[[int]$b.sourceNo] @($b.options)
            if ($null -ne $hit) { $b.correct = @($hit) }
        }
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

Check 'scenarios -> 11 blocks (9 questions + 2 descriptive texts)' ($b3.Count -eq 11) ('got ' + $b3.Count)
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
if ($b3.Count -ge 11) {
    # P-A: passage block "■ نص (...)" -> kept as a descriptive text block (no answer)
    Check 'P-A passage became a text block' (($b3[6].kind -eq 'text') -and ($b3[6].options.Count -eq 0)) ($b3[6].kind + ' / ' + ($b3[6].options -join ' | '))
    Check 'P-A passage title has no marker' ($b3[6].title -cnotmatch '[\u25A0\u25AA\u25CF]') $b3[6].title
    Check 'P-A passage text keeps both paragraphs' (($b3[6].text -split "`n").Count -eq 2 -and $b3[6].text.Length -gt 300) ('len=' + $b3[6].text.Length)
    Check 'P-A passage text keeps its content' ($b3[6].text -cmatch '\u0627\u0644\u0642\u0645\u0631') ''

    # the numbered question after the passage is still parsed normally
    Check 'P-A passage question kept (radio + 4 options)' (($b3[7].kind -eq 'radio') -and ($b3[7].options.Count -eq 4)) ($b3[7].kind + ' / ' + ($b3[7].options -join ' | '))
    Check 'P-A passage question title has no marker and is short' (($b3[7].title.Length -lt 60) -and ($b3[7].title -cnotmatch '[\u25A0\u25AA\u25CF]')) $b3[7].title
    $twelve = U 0x0661,0x0662,0x20,0x0645,0x0631,0x0629
    $pfirst = ''
    if ($b3[7].options.Count -gt 0) { $pfirst = $b3[7].options[0] }
    Check 'P-A first option is the (A) text' ($pfirst -eq $twelve) ($pfirst + ' / ' + ($b3[7].options -join ' | '))

    # unmarked long prose paragraph is preserved as a descriptive text block
    Check 'P-B unmarked prose kept as text block' (($b3[8].kind -eq 'text') -and ($b3[8].text.Length -gt 100)) ($b3[8].kind + ' len=' + $b3[8].text.Length)

    # numbered long short-answer question is kept
    Check 'P-C long numbered short-answer question kept' (($b3[9].kind -eq 'short') -and ($b3[9].title -cmatch '^8\. ') -and ($b3[9].title.Length -gt 90)) ($b3[9].kind + ' len=' + $b3[9].title.Length + ' / ' + $b3[9].title)

    # short unnumbered question ending with ? is kept
    Check 'P-D short question with ? kept' (($b3[10].kind -eq 'short') -and ($b3[10].title -cmatch '^9\. ')) ($b3[10].title)
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

# =================================================================== TEST 6
# reading passages ("■ نص (...)") must be kept as descriptive text blocks
$passageDocx = $env:PASSAGE_DOCX
if (-not $passageDocx) {
    # ابحث في التنزيلات عن ملف وورد يحوي علامة مقروءة (■) — تخطي إن لم يوجد
    $dl = Join-Path $env:USERPROFILE 'Downloads'
    if (Test-Path $dl) {
        foreach ($f in (Get-ChildItem $dl -Filter '*.docx' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            try {
                $fsT = [System.IO.File]::Open($f.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                $zipT = New-Object System.IO.Compression.ZipArchive($fsT, [System.IO.Compression.ZipArchiveMode]::Read)
                $eT = $zipT.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
                if ($eT) {
                    $sr = New-Object System.IO.StreamReader($eT.Open(), [System.Text.Encoding]::UTF8)
                    $head = $sr.ReadToEnd(); $sr.Close()
                    if ($head.IndexOf([string][char]0x25A0) -ge 0) { $passageDocx = $f.FullName; $zipT.Dispose(); $fsT.Close(); break }
                }
                $zipT.Dispose(); $fsT.Close()
            } catch { }
        }
    }
}
if ($passageDocx -and (Test-Path $passageDocx)) {
    Write-Host '===== TEST 6 : reading passages kept as descriptive text ====='
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # الملف قد يكون مفتوحاً في Word الآن — اقرأه بمشاركة القراءة
    $fs6 = [System.IO.File]::Open($passageDocx, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $zip6 = New-Object System.IO.Compression.ZipArchive($fs6, [System.IO.Compression.ZipArchiveMode]::Read)
    $entry6 = $zip6.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
    $ms6 = New-Object System.IO.MemoryStream
    $st6 = $entry6.Open(); $st6.CopyTo($ms6); $st6.Close()
    $xml6 = [System.Text.Encoding]::UTF8.GetString($ms6.ToArray())
    $zip6.Dispose(); $fs6.Close()

    $markerCount = ([regex]::Matches($xml6, '[\u25A0\u25AA\u25CF\u2605]')).Count
    $hl6 = ([regex]::Matches($xml6, '\[\[HL\]\]')).Count
    $b6 = Parse-DocText ((Get-XmlLines $xml6) -join "`n")
    $texts6 = @($b6 | Where-Object { $_.kind -eq 'text' })
    $qs6 = @($b6 | Where-Object { $_.kind -ne 'text' })
    $ok6 = @($qs6 | Where-Object { $_.correct -and $_.correct.Count -gt 0 })
    Write-Host ('--- passages file: ' + $markerCount + ' markers, ' + $hl6 + ' highlights -> ' + $texts6.Count + ' text blocks, ' + $qs6.Count + ' questions, ' + $ok6.Count + ' with correct ---')
    Check 'P6: file contains passage markers' ($markerCount -ge 1) ('got ' + $markerCount)
    Check 'P6: passages became descriptive text blocks' ($texts6.Count -ge 1) ('got ' + $texts6.Count)
    # نصوص وصفية حقيقية: فقرة واحدة على الأقل طويلة، ولا نص وصفي يحمل خيارات
    $longProse = 0
    $anyTitle = $false
    $noOptions = $true
    foreach ($t in $texts6) {
        if ($t.text.Length -ge 80) { $longProse++ }
        if ($t.title.Length -gt 0) { $anyTitle = $true }
        if ($t.options.Count -ne 0) { $noOptions = $false }
    }
    Check 'P6: passage blocks carry real prose (at least one >=80 chars)' ($longProse -ge 1) ('got ' + $longProse)
    Check 'P6: passage blocks never carry options' $noOptions ''
    Check 'P6: passage titles captured (heading without marker)' $anyTitle ''
    Check 'P6: questions still parsed normally' ($qs6.Count -ge 5) ('got ' + $qs6.Count)
    if ($hl6 -ge 1) {
        Check 'P6: highlighted answers still detected on questions' ($ok6.Count -ge 1) ($ok6.Count + ' of ' + $qs6.Count)
    }
    else {
        Write-Host 'P6: no highlights in this file (answer-key check skipped)'
    }
    $textsWithKey = @($texts6 | Where-Object { $_.correct -and $_.correct.Count -gt 0 }).Count
    Check 'P6: passage blocks never carry an answer key' ($textsWithKey -eq 0) ('got ' + $textsWithKey)
}
else {
    Write-Host '===== TEST 6 skipped (passage docx not present) ====='
}

# =================================================================== TEST 7
# answer-key formats (inline + end-of-file list) + true/false detection + no guessing
Write-Host '===== TEST 7 : answer key + true/false ====='
$t7lines = New-Object System.Collections.ArrayList
[void]$t7lines.Add((U 0x31,0x2D,0x20,0x645,0x627,0x20,0x647,0x64A,0x629,0x20,0x639,0x627,0x635,0x645,0x629,0x20,0x641,0x631,0x646,0x633,0x627,0x61F))
[void]$t7lines.Add('A) ' + (U 0x644,0x646,0x62F,0x646))
[void]$t7lines.Add('B) ' + (U 0x628,0x627,0x631,0x64A,0x633))
[void]$t7lines.Add('C) ' + (U 0x628,0x631,0x644,0x64A,0x646))
[void]$t7lines.Add('D) ' + (U 0x631,0x648,0x645,0x627))
[void]$t7lines.Add((U 0x32,0x2D,0x20,0x627,0x644,0x625,0x633,0x644,0x627,0x645,0x20,0x62F,0x64A,0x646,0x20,0x627,0x644,0x62A,0x648,0x62D,0x64A,0x62F,0x20,0x28,0x635,0x62D,0x20,0x2F,0x20,0x62E,0x637,0x623,0x29))
[void]$t7lines.Add($TF_SAH)
[void]$t7lines.Add($TF_KHATA)
[void]$t7lines.Add((U 0x627,0x644,0x625,0x62C,0x627,0x628,0x629,0x3A,0x20) + $TF_SAWAB)
[void]$t7lines.Add((U 0x33,0x2E,0x20,0x645,0x627,0x20,0x623,0x643,0x628,0x631,0x20,0x643,0x648,0x627,0x643,0x628,0x20,0x627,0x644,0x645,0x62C,0x645,0x648,0x629,0x20,0x627,0x644,0x634,0x645,0x633,0x64A,0x629,0x61F))
[void]$t7lines.Add((U 0x623,0x29,0x20,0x627,0x644,0x623,0x631,0x636))
[void]$t7lines.Add((U 0x628,0x29,0x20,0x627,0x644,0x645,0x631,0x64A,0x62E))
[void]$t7lines.Add((U 0x62C,0x29,0x20,0x627,0x644,0x645,0x634,0x62A,0x631,0x64A))
[void]$t7lines.Add((U 0x62F,0x29,0x20,0x632,0x62D,0x644))
[void]$t7lines.Add((U 0x627,0x644,0x625,0x62C,0x627,0x628,0x629,0x3A,0x20,0x62C))
[void]$t7lines.Add((U 0x34,0x2E,0x20,0x627,0x643,0x62A,0x628,0x20,0x641,0x642,0x631,0x629,0x20,0x645,0x646,0x20,0x62B,0x644,0x627,0x62B,0x20,0x62C,0x645,0x644,0x20,0x62A,0x634,0x631,0x62D,0x20,0x641,0x64A,0x647,0x627,0x20,0x623,0x647,0x645,0x64A,0x629,0x20,0x627,0x644,0x639,0x644,0x645,0x20,0x641,0x64A,0x20,0x62D,0x64A,0x627,0x629,0x20,0x627,0x644,0x625,0x646,0x633,0x627,0x646))
[void]$t7lines.Add('1- B')
$b7 = Parse-DocText ($t7lines -join "`n")
Show-Blocks 'answer-key doc' $b7

Check 'T7: 4 blocks parsed' ($b7.Count -eq 4) ('got ' + $b7.Count)
if ($b7.Count -ge 4) {
    $paris = U 0x628,0x627,0x631,0x64A,0x633
    $jupiter = U 0x627,0x644,0x645,0x634,0x62A,0x631,0x64A
    Check 'T7: Q1 is radio with 4 options' (($b7[0].kind -eq 'radio') -and ($b7[0].options.Count -eq 4)) ($b7[0].kind + ' / ' + $b7[0].options.Count)
    Check 'T7: Q1 got answer from end-of-file key list (B -> paris)' ((@($b7[0].correct).Count -eq 1) -and ($b7[0].correct[0] -eq $paris)) (@($b7[0].correct) -join ' | ')
    Check 'T7: Q2 detected as true/false' ($b7[1].kind -eq 'truefalse') $b7[1].kind
    Check 'T7: Q2 has unified [sah, khata] options' ((@($b7[1].options).Count -eq 2) -and ($b7[1].options[0] -ceq $TF_SAH) -and ($b7[1].options[1] -ceq $TF_KHATA)) ((@($b7[1].options)) -join ' | ')
    Check 'T7: Q2 got inline answer (sawab -> sah)' ((@($b7[1].correct).Count -eq 1) -and ($b7[1].correct[0] -ceq $TF_SAH)) ((@($b7[1].correct)) -join ' | ')
    Check 'T7: Q2 title has the TF marker removed' (-not ($b7[1].title -cmatch $TF_MARKER)) $b7[1].title
    Check 'T7: Q3 got inline arabic-letter key (j -> 3rd option)' ((@($b7[2].correct).Count -eq 1) -and ($b7[2].correct[0] -eq $jupiter)) (@($b7[2].correct) -join ' | ')
    Check 'T7: Q4 essay question kept (short, no options)' (($b7[3].kind -eq 'short') -and (@($b7[3].options).Count -eq 0)) ($b7[3].kind + ' / ' + $b7[3].title)
    Check 'T7: Q4 has NO guessed answer (no key in file)' (@($b7[3].correct).Count -eq 0) (@($b7[3].correct) -join ' | ')
    $noLeak7 = $true
    foreach ($b in $b7) { if (Test-AnswerLine $b.title) { $noLeak7 = $false } }
    Check 'T7: no answer-key line leaked into a title' $noLeak7 ''
}

# =================================================================== TEST 8
# الأشكال الخمسة لتنسيق أسئلة الاختيارات + أشكال الحروف العربية والإنجليزية
# 1) رأسية: حرف على سطر مستقل ثم نصه على السطر التالي
# 2) أفقية: كل الخيارات في السطر نفسه بعد نص السؤال
# 3) مختلطة: خياران في سطر والباقي على أسطر منفصلة
# 4) أرقام عربية ١. / ١- كترقيم للأسئلة
# 5) حروف عربية بنقاط/قوس/شرطة + إنجليزية A) B. C- ونظائرها
Write-Host '===== TEST 8 : five layout shapes + Arabic/English option letters ====='

# ---- الشكل 1 (رأسية): "أ" سطر مستقل ثم نص الخيار، مع رقم عربي ١. ----
$qa = U 0x627,0x644,0x633,0x645,0x627,0x621           # السماق
$qb = U 0x627,0x644,0x62C,0x628,0x644                  # الجبل
$qstem1 = (U 0x661,0x660,0x66B,0x20) + (U 0x645,0x627,0x20,0x639,0x627,0x62F,0x629,0x20) + $qa + (U 0x61F)  # ١٠. ما عاصمة السماق؟
$optA = (U 0x623,0x29,0x20) + $qa                      # أ) السماق
$optB = (U 0x628,0x2E,0x20) + $qb                      # ب. الجبل
$optC = (U 0x62C,0x2D,0x20) + (U 0x627,0x644,0x645,0x62F,0x64A,0x6E2,0x629)   # ج- المدينة
$optD = 'D. ' + (U 0x627,0x644,0x646,0x647,0x631)      # D. النهر
$shape1 = @(
    $qstem1
    (U 0x623)                 # أ (حرف منفصل على سطر)
    $optA
    (U 0x628)                 # ب
    $optB
    (U 0x62C)                 # ج
    $optC
    (U 0x62F)                 # د
    $optD
) -join "`n"
$b8a = Parse-DocText $shape1
Write-Host ('--- shape1 (vertical, arabic-indic numbering): ' + $b8a.Count + ' blocks ---')
Check 'T8-1: vertical shape -> exactly 1 question' ($b8a.Count -eq 1) ('got ' + $b8a.Count)
if ($b8a.Count -ge 1) {
    Check 'T8-1: is radio multiple-choice' ($b8a[0].kind -eq 'radio') $b8a[0].kind
    Check 'T8-1: has 4 options' ($b8a[0].options.Count -eq 4) ($b8a[0].options -join ' | ')
    Check 'T8-1: question number prefix stripped from title' (-not ($b8a[0].title -cmatch '^[\u0660-\u0669]{1,3}[\.\-]')) $b8a[0].title
    Check 'T8-1: no lone letter left as an option' (-not ($b8a[0].options -cmatch '^[\u0621-\u064A]$')) ($b8a[0].options -join ' | ')
    Check 'T8-1: A) B. C- D. prefixes all stripped' (($b8a[0].options[0] -ceq $qa) -and ($b8a[0].options[1] -ceq $qb)) ($b8a[0].options -join ' | ')
}

# ---- الشكل 2 (أفقية): كل الخيارات في السطر نفسه ----
$optA2 = (U 0x623,0x29,0x20) + (U 0x639,0x645,0x644,0x3A,0x20,0x623,0x62C,0x631,0x629)          # أ) عمل : أجرة
$optB2 = (U 0x628,0x2E,0x20) + (U 0x62D,0x631,0x627,0x62D,0x3A,0x20,0x645,0x646,0x627,0x629)   # ب. حراس : مناعة
$optC2 = (U 0x62C,0x2D,0x20) + (U 0x639,0x644,0x645,0x3A,0x20,0x62A,0x639,0x644,0x645)          # ج- علم : تعلم
$optD2 = 'D) ' + (U 0x642,0x644,0x645,0x3A,0x20,0x643,0x62A,0x627,0x628)                        # D) قلم : كتاب
$qstem2 = (U 0x31,0x31,0x2E,0x20) + (U 0x633,0x64A,0x644,0x627,0x646,0x3A,0x20,0x62F,0x645,0x20,0x20,0x20)  # 11. سيلان : دم
$shape2 = $qstem2 + $optA2 + '   ' + $optB2 + '   ' + $optC2 + '   ' + $optD2
$b8b = Parse-DocText $shape2
Write-Host ('--- shape2 (horizontal, all in one line): ' + $b8b.Count + ' blocks ---')
Check 'T8-2: horizontal shape -> exactly 1 question' ($b8b.Count -eq 1) ('got ' + $b8b.Count)
if ($b8b.Count -ge 1) {
    $silan = U 0x633,0x64A,0x644,0x627,0x646,0x3A,0x20,0x62F,0x645
    Check 'T8-2: title is the stem before first marker' ($b8b[0].title -cmatch $silan) $b8b[0].title
    Check 'T8-2: has 4 options' ($b8b[0].options.Count -eq 4) ($b8b[0].options -join ' | ')
    Check 'T8-2: first option is the text after أ)' ($b8b[0].options[0] -cmatch (U 0x639,0x645,0x644)) ($b8b[0].options -join ' | ')
    Check 'T8-2: D) english marker stripped (no D left)' (-not ($b8b[0].options -cmatch '^D\)')) ($b8b[0].options -join ' | ')
    Check 'T8-2: number 11. stripped from title' (-not ($b8b[0].title -cmatch '^11\.')) $b8b[0].title
}

# ---- الشكل 3 (مختلطة): خياران في سطر ثم букوتان على سطرين ----
$qstem3 = (U 0x31,0x32,0x2E,0x20) + (U 0x645,0x627,0x20,0x62D,0x64A,0x648,0x627,0x6E2,0x20,0x645,0x646,0x20,0x627,0x644,0x645,0x646,0x627,0x62C,0x638,0x61F)  # 12. ما حيوان من المناجز؟
$p1 = (U 0x623,0x29,0x20) + (U 0x627,0x644,0x623,0x631,0x646,0x628)      # أ) الأرنب
$p2 = (U 0x628,0x29,0x20) + (U 0x627,0x644,0x623,0x633,0x62F)              # ب) الأسد
$rest3 = @(
    (U 0x62C) + '. ' + (U 0x627,0x644,0x62C,0x645,0x644)                  # ج. الجمل
    (U 0x62F) + '- ' + (U 0x627,0x644,0x645,0x627,0x631,0x62F)             # د- المارد
) -join "`n"
$shape3 = ($qstem3 + '   ' + $p1 + '   ' + $p2) + "`n" + $rest3
$b8c = Parse-DocText $shape3
Write-Host ('--- shape3 (mixed: two inline + two stacked): ' + $b8c.Count + ' blocks ---')
Check 'T8-3: mixed shape -> exactly 1 question' ($b8c.Count -eq 1) ('got ' + $b8c.Count)
if ($b8c.Count -ge 1) {
    Check 'T8-3: has 4 options total' ($b8c[0].options.Count -eq 4) ($b8c[0].options -join ' | ')
    Check 'T8-3: inline + stacked options merged in order' (($b8c[0].options[2] -cmatch (U 0x627,0x644,0x62C,0x645,0x644)) -and ($b8c[0].options[3] -cmatch (U 0x627,0x644,0x645,0x627,0x631,0x62F))) ($b8c[0].options -join ' | ')
}

# ---- الشكل 4: ترقيم أرقام عربية ١- / ١. مع حروف خيارات بنقاط وقوس وشرطة ----
$qstem4 = (U 0x661,0x663,0x2D,0x20) + (U 0x627,0x644,0x62A,0x641,0x627,0x635,0x64A,0x644,0x20,0x627,0x644,0x635,0x62D,0x64A,0x62D,0x629,0x3A,0x20,0x645,0x627,0x20,0x645,0x62F,0x649,0x20,0x62A,0x646,0x627,0x648,0x639,0x61F)  # ١٣- التفاصيل الصحيحة: ما مدى تناوع؟
$o4a = (U 0x661,0x29,0x20) + (U 0x642,0x644,0x64A,0x644,0x627,0x64B)     # ١) قليلاً
$o4b = (U 0x662,0x29,0x20) + (U 0x643,0x62B,0x64A,0x631,0x627,0x64B)      # ٢) كثيراً
$o4c = (U 0x663,0x2D,0x20) + (U 0x62F,0x627,0x626,0x645,0x627,0x64B)      # ٣- دائماً
$o4d = (U 0x664,0x29,0x20) + (U 0x623,0x62D,0x64A,0x627,0x646,0x627,0x64B)  # ٤) أحياناً
$shape4 = @($qstem4, $o4a, $o4b, $o4c, $o4d) -join "`n"
$b8d = Parse-DocText $shape4
Write-Host ('--- shape4 (arabic-indic 1- numbering): ' + $b8d.Count + ' blocks ---')
Check 'T8-4: arabic-indic numbered question -> 1 block' ($b8d.Count -eq 1) ('got ' + $b8d.Count)
if ($b8d.Count -ge 1) {
    Check 'T8-4: has 4 options' ($b8d[0].options.Count -eq 4) ($b8d[0].options -join ' | ')
    Check 'T8-4: arabic-indic digit prefixes ١) ٢. ٣- ٤? stripped' (($b8d[0].options[0] -ceq (U 0x642,0x644,0x64A,0x644,0x627,0x64B)) -and ($b8d[0].options[3] -cmatch (U 0x623,0x62D,0x64A,0x627,0x646))) ($b8d[0].options -join ' | ')
    Check 'T8-4: title number ١٣- stripped' (-not ($b8d[0].title -cmatch '^[\u0660-\u0669]{1,3}[\.\-]')) $b8d[0].title
}

# ---- الشكل 5: عناوين طويلة + أشكال حروف متنوعة عربي/إنجليزي في سطر واحد ----
$longTitle = (U 0x627,0x644) + (U 0x62A,0x6CC,0x627,0x631,0x20) + (U 0x627,0x644,0x635,0x646,0x627,0x639,0x691,0x64A,0x20) + (U 0x627,0x644,0x630,0x64A,0x20,0x64A,0x648,0x631,0x62B,0x64A,0x20,0x645,0x646,0x20,0x627,0x644,0x628,0x64A,0x639,0x20,0x648,0x627,0x644,0x62A,0x639,0x644,0x645,0x20,0x648,0x627,0x644,0x62A,0x631,0x62C,0x645,0x627,0x646,0x20,0x627,0x644,0x645,0x62D,0x62A,0x645,0x644,0x64A,0x646,0x20,0x639,0x646,0x20,0x62A,0x639,0x62F,0x64A,0x644,0x20,0x627,0x644,0x645,0x639,0x644,0x648,0x645,0x627,0x62A,0x20,0x648,0x627,0x644,0x645,0x639,0x631,0x641,0x627,0x62A,0x20,0x627,0x644,0x62A,0x6CC,0x627,0x631,0x64A,0x629,0x20,0x641,0x64A,0x20,0x639,0x627,0x644,0x645,0x20,0x627,0x644,0x62A,0x639,0x644,0x651,0x645,0x20,0x627,0x644,0x639,0x631,0x642,0x64A,0x3F)  # عنوان طويل >150
$qstem5 = '14. ' + $longTitle
$h1 = (U 0x623,0x61F,0x20) + (U 0x627,0x644,0x639,0x631,0x642,0x64A)      # أ? العربي
$h2 = (U 0x628,0x2D,0x20) + (U 0x627,0x644,0x62B,0x642,0x627,0x626,0x64A)  # ب- الثقائي
$h3 = 'C) ' + (U 0x627,0x644,0x639,0x644,0x645,0x64A)                     # C) العلمي
$h4 = 'D. ' + (U 0x627,0x644,0x628,0x634,0x631,0x64A)                     # D. البحري
$shape5 = $qstem5 + '   ' + $h1 + '   ' + $h2 + '   ' + $h3 + '   ' + $h4
$b8e = Parse-DocText $shape5
Write-Host ('--- shape5 (long title + mixed ar/en letters): ' + $b8e.Count + ' blocks ---')
Check 'T8-5: long-title question -> 1 block' ($b8e.Count -eq 1) ('got ' + $b8e.Count)
if ($b8e.Count -ge 1) {
    Check 'T8-5: long title preserved (>100 chars)' ($b8e[0].title.Length -gt 100) ('len=' + $b8e[0].title.Length)
    Check 'T8-5: has 4 options' ($b8e[0].options.Count -eq 4) ($b8e[0].options -join ' | ')
    Check 'T8-5: arabic ?-dash and english C) D. markers stripped' (($b8e[0].options[0] -cmatch (U 0x627,0x644,0x639,0x631,0x642,0x64A)) -and ($b8e[0].options[2] -cmatch (U 0x627,0x644,0x639,0x644,0x645,0x64A))) ($b8e[0].options -join ' | ')
    Check 'T8-5: no option is a bare letter' (-not ($b8e[0].options -cmatch '^[\u0621-\u064A]$|^[\x41-\x44]$')) ($b8e[0].options -join ' | ')
}

# ---- تركيبة الأشكال الخمسة كلها في ملف واحد ----
$shapeAll = @($shape1, $shape2, $shape3, $shape4, $shape5) -join "`n`n"
$b8all = Parse-DocText $shapeAll
Write-Host ('--- all five shapes combined: ' + $b8all.Count + ' blocks ---')
Check 'T8-ALL: five shapes -> 5 questions' ($b8all.Count -eq 5) ('got ' + $b8all.Count)
Check 'T8-ALL: every question is radio with 4 options' (@($b8all | Where-Object { ($_.kind -ne 'radio') -or ($_.options.Count -ne 4) }).Count -eq 0) ((@($b8all | ForEach-Object { $_.kind + ':' + $_.options.Count }) -join ' '))
$bareLetterLeak = $false
foreach ($b in $b8all) {
    foreach ($o in $b.options) {
        if ($o -cmatch '^[\u0621-\u064A]$' -or $o -cmatch '^[A-Da-d]$') { $bareLetterLeak = $true }
        if ($o -cmatch '^\d{1,2}[\.\-\)]') { $bareLetterLeak = $true }
    }
    if (($b.title -replace '^\d{1,3}[\.\-\)]\s*','') -cmatch '^\d') { $bareLetterLeak = $true }
}
Check 'T8-ALL: no bare letter/number prefix leaked into text' (-not $bareLetterLeak) ''

Write-Host ''
if ($script:fail -eq 0) { Write-Host 'ALL TESTS PASSED' }
else { Write-Host ('FAILURES: ' + $script:fail) }
exit $script:fail
