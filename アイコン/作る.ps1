<#
  ホーム画面のアイコンを写真から作る（2026-10-03）。
  使い方（PowerShell）:
    .\アイコン\作る.ps1 -写真 C:\Users\minuu\Pictures\馬.jpg
    .\アイコン\作る.ps1 -写真 馬.jpg -横 0.3 -縦 0.4 -大きさ 0.7
  写真から正方形を切り抜いて、このフォルダに PNG を5つ置く。そのあと node build.js → git push。
    -横 / -縦   切り抜く正方形の中心（写真の左上が 0、右下が 1。省略すると真ん中）
    -大きさ     正方形の一辺を、写真の短い辺の何割にするか（省略すると 1 = いっぱい）
  -写真 を付けないと、青地に白で「馬」の仮のアイコンを作る。
  Android は角を丸めたり円に切ったりするので、大事なもの（馬の顔など）は真ん中の8割に入れる。
#>
param(
  [string]$写真 = '',
  [double]$横 = 0.5,
  [double]$縦 = 0.5,
  [double]$大きさ = 1.0
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$置く先 = $PSScriptRoot

function 正方形を作る {
  if ($写真 -eq '') {
    # 仮のアイコン：サイトの帯の青（--accent）に白で「馬」
    $bmp = New-Object System.Drawing.Bitmap 1024, 1024
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#2b58b1'))
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $font = New-Object System.Drawing.Font 'Yu Gothic UI', 520, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
    $g.DrawString('馬', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 40, 1024, 1024), $fmt)
    $g.Dispose()
    return $bmp
  }
  $元 = [System.Drawing.Image]::FromFile((Resolve-Path $写真).Path)
  # スマホの写真は向きを EXIF に持っていることがあるので、先に起こす
  if ($元.PropertyIdList -contains 0x0112) {
    switch ([int]$元.GetPropertyItem(0x0112).Value[0]) {
      3 { $元.RotateFlip('Rotate180FlipNone') }
      6 { $元.RotateFlip('Rotate90FlipNone') }
      8 { $元.RotateFlip('Rotate270FlipNone') }
    }
  }
  $辺 = [int]([Math]::Min($元.Width, $元.Height) * [Math]::Min(1.0, $大きさ))
  $x = [int]([Math]::Max(0, [Math]::Min($元.Width - $辺, $元.Width * $横 - $辺 / 2)))
  $y = [int]([Math]::Max(0, [Math]::Min($元.Height - $辺, $元.Height * $縦 - $辺 / 2)))
  $bmp = New-Object System.Drawing.Bitmap 1024, 1024
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.DrawImage($元, (New-Object System.Drawing.Rectangle 0, 0, 1024, 1024), (New-Object System.Drawing.Rectangle $x, $y, $辺, $辺), 'Pixel')
  $g.Dispose(); $元.Dispose()
  return $bmp
}

$正方形 = 正方形を作る
# 名前は build.js と manifest が読む。変えるときは両方直す
$大きさたち = [ordered]@{ 'icon-512.png' = 512; 'icon-192.png' = 192; 'apple-touch-icon.png' = 180; 'favicon-32.png' = 32 }
foreach ($名前 in $大きさたち.Keys) {
  $n = $大きさたち[$名前]
  $小 = New-Object System.Drawing.Bitmap $n, $n
  $g = [System.Drawing.Graphics]::FromImage($小)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.DrawImage($正方形, 0, 0, $n, $n)
  $g.Dispose()
  $小.Save((Join-Path $置く先 $名前), [System.Drawing.Imaging.ImageFormat]::Png)
  $小.Dispose()
  Write-Host "  $名前 ($n x $n)"
}
$正方形.Dispose()
Write-Host 'できました。node build.js → git push で配られます。'
