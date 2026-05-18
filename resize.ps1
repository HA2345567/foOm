Add-Type -AssemblyName System.Drawing
$source = "public\wallpapers"
$target = "public\thumbnails"
if (!(Test-Path $target)) { New-Item -ItemType Directory -Path $target | Out-Null }

$files = Get-ChildItem -Path $source -Filter "*.jpg"
foreach ($file in $files) {
    $outPath = Join-Path $target $file.Name
    if (Test-Path $outPath) { continue }
    
    $img = [System.Drawing.Image]::FromFile($file.FullName)
    $ratio = $img.Width / $img.Height
    $newWidth = 320
    $newHeight = [math]::Round($newWidth / $ratio)
    
    $bmp = New-Object System.Drawing.Bitmap $newWidth, $newHeight
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.DrawImage($img, 0, 0, $newWidth, $newHeight)
    
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    
    $graph.Dispose()
    $bmp.Dispose()
    $img.Dispose()
    Write-Host "Resized $($file.Name)"
}
Write-Host "Done!"
