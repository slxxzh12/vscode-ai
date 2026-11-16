param([Parameter(Mandatory=$true)][string]$Job)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$job = Get-Content -LiteralPath $Job -Raw -Encoding UTF8 | ConvertFrom-Json
$jobDir = Split-Path -Parent $Job
$resultFile = Join-Path $jobDir 'result.json'

$script:removed = 0
$script:bytes = [long]0
$script:skipped = 0
$script:failed = New-Object System.Collections.ArrayList

function Get-Reason($err) {
  if ($err -is [System.UnauthorizedAccessException]) { return 'denied' }
  if ($err -is [System.IO.IOException]) { return 'locked' }
  return 'other'
}

function Test-Allowed([string]$candidate, $target) {
  $full = [IO.Path]::GetFullPath($candidate)
  $root = [IO.Path]::GetFullPath([string]$target.path)
  if ($target.mode -eq 'file') {
    return $full.Equals($root, [StringComparison]::OrdinalIgnoreCase)
  }
  if ($target.removeRoot -and $full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  $prefix = $root.TrimEnd('\') + '\'
  return $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Test-Excluded([string]$candidate) {
  $full = [IO.Path]::GetFullPath($candidate)
  foreach ($d in @($job.exclusions.dirs)) {
    if (-not $d) { continue }
    $root = [IO.Path]::GetFullPath([string]$d).TrimEnd('\')
    if ($full.Equals($root, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  $name = [IO.Path]::GetFileName($full)
  foreach ($pat in @($job.exclusions.patterns)) {
    if ($pat -and ($name -like [string]$pat)) { return $true }
  }
  return $false
}

function Measure-Path([string]$p) {
  try {
    $item = Get-Item -LiteralPath $p -Force -ErrorAction Stop
    if ($item.PSIsContainer) {
      $sum = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
      if ($null -eq $sum) { return 0 }
      return [long]$sum
    }
    return [long]$item.Length
  } catch { return 0 }
}

function Remove-One([string]$p, [bool]$isDir, $target) {
  if (Test-Excluded $p) { $script:skipped += 1; return }
  if (-not (Test-Allowed $p $target)) { $script:skipped += 1; return }
  $size = Measure-Path $p
  try {
    if ($job.mode -eq 'permanent') {
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop
    } elseif ($isDir) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
    } else {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
    }
    $script:removed += 1
    $script:bytes += $size
  } catch {
    [void]$script:failed.Add(@{ path = $p; reason = (Get-Reason $_.Exception) })
  }
}

function Remove-Tree([string]$dir, $target) {
  $items = Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue
  foreach ($it in $items) {
    if (($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $script:skipped += 1; continue }
    if (Test-Excluded $it.FullName) { $script:skipped += 1; continue }
    if ($it.PSIsContainer) {
      Remove-Tree $it.FullName $target
      try {
        if ((Get-ChildItem -LiteralPath $it.FullName -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
          Remove-One $it.FullName $true $target
        }
      } catch { }
    } else {
      Remove-One $it.FullName $false $target
    }
  }
}

try {
  foreach ($cat in $job.categories) {
    $minAge = 0
    if ($null -ne $cat.minAgeDays) { $minAge = [double]$cat.minAgeDays }
    $cutoff = (Get-Date).AddDays(-$minAge)
    foreach ($target in $cat.targets) {
      $root = [string]$target.path
      if ($target.mode -eq 'recycle-bin') {
        try {
          $letter = $root.TrimEnd('\').TrimEnd(':')
          Clear-RecycleBin -DriveLetter $letter -Force -ErrorAction Stop
          $script:removed += 1
        } catch {
          [void]$script:failed.Add(@{ path = $root; reason = (Get-Reason $_.Exception) })
        }
        continue
      }
      if ($target.mode -eq 'file') {
        if (Test-Path -LiteralPath $root) { Remove-One $root $false $target }
        continue
      }
      if (-not (Test-Path -LiteralPath $root)) { continue }
      $items = Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue
      foreach ($item in $items) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { $script:skipped += 1; continue }
        if (Test-Excluded $item.FullName) { $script:skipped += 1; continue }
        if ($minAge -gt 0 -and $item.LastWriteTime -gt $cutoff) { $script:skipped += 1; continue }
        if ($target.mode -eq 'entry') {
          if ($item.PSIsContainer) { continue }
          $patterns = @($target.patterns)
          if ($patterns.Count -gt 0) {
            $hit = $false
            foreach ($pat in $patterns) { if ($item.Name -like [string]$pat) { $hit = $true; break } }
            if (-not $hit) { continue }
          }
          Remove-One $item.FullName $false $target
        } elseif ($item.PSIsContainer) {
          Remove-Tree $item.FullName $target
          try {
            if ((Get-ChildItem -LiteralPath $item.FullName -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
              Remove-One $item.FullName $true $target
            }
          } catch { }
        } else {
          Remove-One $item.FullName $false $target
        }
      }
      if ($target.removeRoot -and $target.mode -eq 'contents') {
        if ((Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
          Remove-One $root $true $target
        }
      }
    }
  }
  $result = @{
    status = 'done'; removed = $script:removed; bytes = $script:bytes; skipped = $script:skipped;
    failed = @($script:failed); mode = $job.mode; elevated = [bool]$job.elevated;
  }
} catch {
  $result = @{
    status = 'error'; removed = $script:removed; bytes = $script:bytes; skipped = $script:skipped;
    failed = @($script:failed); mode = $job.mode; elevated = [bool]$job.elevated; error = [string]$_.Exception.Message
  }
}

$json = $result | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($resultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
