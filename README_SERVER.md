# HTTPサーバーの起動方法

## 方法1: バッチファイルを使用（推奨）

1. `start_server.bat` をダブルクリック
2. ブラウザで `http://localhost:8000/index.html` を開く

## 方法2: コマンドプロンプトから起動

1. コマンドプロンプトを開く
2. このフォルダに移動
3. 以下のコマンドを実行:
   ```
   python -m http.server 8000
   ```
   または
   ```
   python3 -m http.server 8000
   ```
4. ブラウザで `http://localhost:8000/index.html` を開く

## 方法3: Node.jsを使用

Node.jsがインストールされている場合:

1. ターミナルで以下を実行:
   ```
   npx http-server -p 8000
   ```
2. ブラウザで `http://localhost:8000/index.html` を開く

## 方法4: VS CodeのLive Server拡張機能

1. VS Codeで「Live Server」拡張機能をインストール
2. `index.html`を右クリック → 「Open with Live Server」を選択

## 注意事項

- サーバーを起動した後、ブラウザで `http://localhost:8000/index.html` を開いてください
- `file://`から直接開くとCORSエラーが発生します
- サーバーを停止するには、ターミナルで `Ctrl+C` を押してください
