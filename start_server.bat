@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo HTTPサーバーを起動しています...
echo ブラウザで http://localhost:8000/index.html を開いてください
echo サーバーを停止するには Ctrl+C を押してください
echo.
python -m http.server 8000
if errorlevel 1 (
    echo Pythonが見つかりません。Python3を試します...
    python3 -m http.server 8000
    if errorlevel 1 (
        echo Pythonが見つかりませんでした。
        echo Pythonをインストールするか、Node.jsのhttp-serverを使用してください。
        pause
    )
)
