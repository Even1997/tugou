param(
  [Parameter(Mandatory=$true)][string]$Python,
  [Parameter(Mandatory=$true)][string]$PotraceDirectory,
  [Parameter(Mandatory=$true)][string]$RuntimeDirectory,
  [string]$WorkspaceDirectory
)
$ErrorActionPreference = 'Stop'
$fontRuntime = [IO.Path]::GetFullPath($RuntimeDirectory)
$fontPython = Join-Path $fontRuntime 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $fontPython)) {
  & $Python -m venv $fontRuntime
  if ($LASTEXITCODE -ne 0) { throw '创建字体环境失败' }
}
& $fontPython -m pip install -r (Join-Path $PSScriptRoot '../runtime/font-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw '字体依赖安装失败' }
& $fontPython -m pip install --no-deps -r (Join-Path $PSScriptRoot '../runtime/font-ocr-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw '本地 OCR 依赖安装失败' }
& $fontPython -I -c 'from rapidocr_onnxruntime import RapidOCR; RapidOCR(intra_op_num_threads=2,inter_op_num_threads=1); print("本地 OCR 模型检查通过")'
if ($LASTEXITCODE -ne 0) { throw '本地 OCR 模型验证失败' }
$fontTools = Join-Path $fontRuntime 'potrace'
New-Item -ItemType Directory -Force -Path $fontTools | Out-Null
foreach ($fontFile in @('potrace.exe','COPYING','README','AUTHORS')) {
  Copy-Item -LiteralPath (Join-Path $PotraceDirectory $fontFile) -Destination (Join-Path $fontTools $fontFile)
}
& $fontPython -I -c 'import cv2, fontTools, PIL, brotli; assert hasattr(cv2,"aruco"); print("字体依赖检查通过")'
if ($LASTEXITCODE -ne 0) { throw '字体环境验证失败' }
$fontVersions = & $fontPython -I -c 'import json,platform,importlib.metadata as m; print(json.dumps({"python":platform.python_version(),**{k:m.version(k) for k in ["numpy","opencv-python-headless","Pillow","fonttools","brotli"]}}))'
if ($LASTEXITCODE -ne 0) { throw '读取字体依赖版本失败' }
$fontManifest = @{ python='Scripts/python.exe'; potrace='potrace/potrace.exe'; versions=($fontVersions | ConvertFrom-Json) }
[IO.File]::WriteAllText((Join-Path $fontRuntime 'runtime.json'), ($fontManifest | ConvertTo-Json -Depth 4))
if ($WorkspaceDirectory) {
  New-Item -ItemType Directory -Force -Path $WorkspaceDirectory | Out-Null
  [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetFullPath($WorkspaceDirectory)) 'font-runtime.json'), (@{directory=$fontRuntime} | ConvertTo-Json))
}
Write-Output "字体环境已配置：$fontRuntime"
