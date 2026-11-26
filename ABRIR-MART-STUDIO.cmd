@echo off
title Mart Studio - laboratorio multimodal
cd /d "%~dp0"

set "PY=%~dp0python\python.exe"

rem 1) Runtime portable: si falta la carpeta python, se descarga (solo la primera vez)
if not exist "%PY%" (
  echo Primera vez: preparando Python portable dentro de esta carpeta...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-python.ps1"
  if errorlevel 1 (
    echo.
    echo No se pudo descargar Python. Revisa tu conexion e intenta de nuevo.
    pause
    exit /b 1
  )
)

rem 2) .env: si no existe, se crea desde la plantilla y se abre para poner la clave
if not exist "%~dp0.env" (
  copy /y "%~dp0.env.example" "%~dp0.env" >nul
  echo.
  echo Se creo el archivo .env. Pega tu clave de MartLLM en "martllm-key", guarda y cierra el Bloc de notas.
  start /wait notepad "%~dp0.env"
)

echo Abriendo Mart Studio...
echo.
"%PY%" studio.py

if errorlevel 1 (
  echo.
  echo No se pudo iniciar. Borra la carpeta "python" y vuelve a abrir para reinstalarla.
  pause
)
