param(
    [string]$RuntimeRoot = 'D:\CanvasStudioRuntime',
    [string]$DataDir = "$env:APPDATA\CanvasStudio\projects",
    [switch]$IncludeCutout,
    [switch]$IncludeDetailCutout
)
$ErrorActionPreference = 'Stop'
if ($IncludeDetailCutout) { $IncludeCutout = $true }
function Get-VerifiedDownload([string]$Url, [string]$Destination, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Destination)) {
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            # Recalculate the resume offset on each attempt; curl's built-in retry can discard newly received bytes.
            & curl.exe --fail --location --continue-at - --connect-timeout 20 --max-time 600 --speed-limit 1024 --speed-time 30 --silent --show-error --output "$Destination.partial" $Url
            if ($LASTEXITCODE -eq 0) { break }
            if ($attempt -eq 3) { throw "下载未完成，已保留断点；重新运行安装可继续：$Destination.partial" }
        }
        if ((Get-FileHash -LiteralPath "$Destination.partial" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw '下载校验失败，未安装；请移除损坏的 partial 文件后重试' }
        Move-Item -LiteralPath "$Destination.partial" -Destination $Destination
    }
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw '组件文件校验失败，请重新下载' }
}
$root = [IO.Path]::GetFullPath($RuntimeRoot)
$install = Join-Path $root 'realesrgan-20220424'
New-Item -ItemType Directory -Force -Path $install | Out-Null
$archive = Join-Path $install 'download.zip'
$url = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip'
$expected = 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d'
Get-VerifiedDownload $url $archive $expected
Expand-Archive -LiteralPath $archive -DestinationPath $install -Force
Invoke-WebRequest 'https://raw.githubusercontent.com/xinntao/Real-ESRGAN-ncnn-vulkan/master/LICENSE' -OutFile (Join-Path $install 'LICENSE-ncnn-wrapper.txt') -UseBasicParsing
Invoke-WebRequest 'https://raw.githubusercontent.com/xinntao/Real-ESRGAN/v0.2.5.0/LICENSE' -OutFile (Join-Path $install 'LICENSE-Real-ESRGAN.txt') -UseBasicParsing
if ($IncludeCutout) {
    $venv = Join-Path $root 'segment-python'
    $pythonExe = Join-Path $venv 'Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $pythonExe)) {
        & python -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw '创建独立 Python 环境失败（需要 Python 3.10+）' }
    }
    & $pythonExe -m pip install --disable-pip-version-check --no-cache-dir onnxruntime-directml==1.22.0 pillow==11.3.0 numpy==2.2.6
    if ($LASTEXITCODE -ne 0) { throw '安装本地抠图依赖失败' }
    $segment = Join-Path $root 'segmentation'
    New-Item -ItemType Directory -Force -Path $segment | Out-Null
    $model = Join-Path $segment 'isnet-general-use.onnx'
    $modelHash = '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a'
    Get-VerifiedDownload 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx' $model $modelHash
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'tool-runtime/segment.py') -Destination (Join-Path $segment 'segment.py') -Force
    Invoke-WebRequest 'https://raw.githubusercontent.com/danielgatis/rembg/main/LICENSE.txt' -OutFile (Join-Path $segment 'LICENSE-rembg.txt') -UseBasicParsing
    Invoke-WebRequest 'https://raw.githubusercontent.com/xuebinqin/DIS/main/LICENSE.md' -OutFile (Join-Path $segment 'LICENSE-DIS.txt') -UseBasicParsing
    if ($IncludeDetailCutout) {
        Get-VerifiedDownload 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67/onnx/model_fp16.onnx' (Join-Path $segment 'birefnet-general-fp16.onnx') '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09'
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'tool-runtime/segment-birefnet.py') -Destination (Join-Path $segment 'segment-birefnet.py') -Force
        Invoke-WebRequest 'https://huggingface.co/onnx-community/BiRefNet-ONNX/raw/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67/README.md' -OutFile (Join-Path $segment 'MODEL-BiRefNet.md') -UseBasicParsing
        Invoke-WebRequest 'https://raw.githubusercontent.com/ZhengPeng7/BiRefNet/main/LICENSE' -OutFile (Join-Path $segment 'LICENSE-BiRefNet.txt') -UseBasicParsing
    }
}
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$config = @{ realesrgan = $install; jobsDir = (Join-Path $root 'jobs'); release = '20220424'; sha256 = $expected }
$file = Join-Path $DataDir 'tool-runtime.json'
[IO.File]::WriteAllText("$file.tmp", ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath "$file.tmp" -Destination $file -Force
Write-Output "本地超分已安装：$install"
Write-Output "配置已保存：$file"
