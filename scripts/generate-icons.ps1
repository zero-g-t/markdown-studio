# 从源 PNG 生成 Chrome 扩展所需的各尺寸图标。
# 用法: powershell -NoProfile -File scripts/generate-icons.ps1 -Source "D:\path\to\icon.png"
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$OutDir = (Join-Path $PSScriptRoot '..\public\icons'),
  [int[]]$Sizes = @(16, 32, 48, 128)
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $Source)) {
  throw "source image not found: $Source"
}

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$src = [System.Drawing.Image]::FromFile($Source)
try {
  Write-Output ("source: {0} ({1}x{2}, {3})" -f $Source, $src.Width, $src.Height, $src.PixelFormat)

  foreach ($size in $Sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
      }
      finally { $g.Dispose() }

      $target = Join-Path $OutDir ("icon{0}.png" -f $size)
      $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output ("wrote: {0} ({1} bytes)" -f $target, (Get-Item -LiteralPath $target).Length)
    }
    finally { $bmp.Dispose() }
  }
}
finally { $src.Dispose() }
