# Descarga un Python portable (embebible oficial de python.org) + Pillow en .\python
# No toca el sistema: todo queda dentro de la carpeta de Mart Studio.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$PyVer = '3.13.13'
$Root  = Split-Path -Parent $PSScriptRoot
$Py    = Join-Path $Root 'python'
$Site  = Join-Path $Py 'Lib\site-packages'
$Tmp   = Join-Path $env:TEMP ("mart-setup-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

try {
  if (-not (Test-Path (Join-Path $Py 'python.exe'))) {
    Write-Host "Descargando Python $PyVer portable..."
    $zip = Join-Path $Tmp 'python.zip'
    Invoke-WebRequest "https://www.python.org/ftp/python/$PyVer/python-$PyVer-embed-amd64.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath $Py -Force
    # habilitar site-packages en el runtime embebible
    $pth = Get-ChildItem $Py -Filter 'python*._pth' | Select-Object -First 1
    $zipName = (Get-ChildItem $Py -Filter 'python3*.zip' | Select-Object -First 1).Name
    Set-Content -Path $pth.FullName -Encoding ASCII -Value @($zipName, '.', 'Lib\site-packages', 'import site')
  }

  New-Item -ItemType Directory -Force -Path $Site | Out-Null
  if (-not (Test-Path (Join-Path $Site 'PIL'))) {
    Write-Host 'Descargando Pillow...'
    $meta = Invoke-RestMethod 'https://pypi.org/pypi/pillow/json'
    $whl = $meta.urls | Where-Object { $_.filename -like '*-cp313-cp313-win_amd64.whl' } | Select-Object -First 1
    if (-not $whl) { throw 'No encontré una rueda de Pillow para cp313 win_amd64.' }
    $file = Join-Path $Tmp 'pillow.zip'
    Invoke-WebRequest $whl.url -OutFile $file
    Expand-Archive $file -DestinationPath $Site -Force
  }

  & (Join-Path $Py 'python.exe') -c "import PIL, sys; print('Listo: Python', sys.version.split()[0], '+ Pillow', PIL.__version__)"
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
