@echo off
title Mart Studio - laboratorio multimodal
cd /d "%~dp0"

set "PY=%~dp0python\python.exe"
if not exist "%PY%" set "PY=python"

echo Abriendo Mart Studio...
echo.
"%PY%" studio.py

if errorlevel 1 (
  echo.
  echo No se pudo iniciar. Revisa que la carpeta "python" este completa.
  pause
)
