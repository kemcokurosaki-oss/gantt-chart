@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ========================================
echo HTTPサーバーを起動しています...
echo ========================================
echo.
echo ブラウザで以下のURLを開いてください:
echo   http://localhost:8000/index.html
echo.
echo サーバーを停止するには Ctrl+C を押してください
echo.
echo ========================================
echo.

python -m http.server 8000

pause
