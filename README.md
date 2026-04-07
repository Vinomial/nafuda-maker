# nafuda-maker

`nafuda.png` と `names.csv` から、A4 印刷用の名札 PDF をまとめて生成するスクリプトです。

背景は `nafuda.png` から行ごとに少しずつ違う位置を切り出して作るので、全員分が完全に同じ見た目にはなりません。各行の名札は左右に同じ名前を並べて出力されます。

## できること

- `nafuda.png` から名札背景を直接生成
- 行ごとに違う背景を自動で割り当て
- `names.csv` から名前一覧を読み込み
- 長い名前は自動で縮小して配置
- `--seed` で背景配置を再現
- A4 PDF としてまとめて出力

## セットアップ

### 1. 依存関係を入れる

このリポジトリでは `Pillow` と `reportlab` を使います。`requirements.txt` を使って次の 1 コマンドで入れられます。

```bash
python3 -m pip install -r requirements.txt
```

### 2. 背景画像を用意する

背景画像には任意の PNG を使えます。白地が多く、中央に名前を置く余白を取りやすい画像だと使いやすいです。

一例として、次の素材は名札用の背景として合わせやすく、おすすめです。

- イラストAC「抽象模様の背景」: https://www.ac-illust.com/main/detail.php?id=1576410&word=%E6%8A%BD%E8%B1%A1%E6%A8%A1%E6%A7%98%E3%81%AE%E8%83%8C%E6%99%AF

この素材を使う場合は、各自で素材ページからダウンロードし、このリポジトリの同じディレクトリに `nafuda.png` という名前で置いてください。  
つまり、`generate_name_tags.py` と同じ場所に `nafuda.png` を置く想定です。

ほかの PNG 画像を使う場合も、同様に `nafuda.png` という名前で置けばそのまま動きます。

### 3. 名前一覧を用意する

`names.csv` に、名札に入れたい名前を 1 行ずつ書きます。

最小構成は `name` 列だけで動きます。`#` で始まる行は説明コメントとして無視されます。

```csv
# 名札に入れたい名前を1行ずつ書きます
# 基本は name 列だけでOKです
name
近本 光司
中野 拓夢
森下 翔太
```

### 4. PDF を生成する

```bash
python3 generate_name_tags.py
```

実行後、同じディレクトリに `name_tags.pdf` が生成されます。

## よく使う例

```bash
python3 generate_name_tags.py
python3 generate_name_tags.py --seed spring-camp-2026
python3 generate_name_tags.py --output build/name-tags.pdf
python3 generate_name_tags.py --rows 4 --columns 2
python3 generate_name_tags.py --font /path/to/font.ttf
```

- `--seed`: 同じ見た目を再現したいときに使います
- `--output`: 出力先 PDF を変えます
- `--rows`, `--columns`: 1 ページあたりの面付けを調整します
- `--font`: 名前用フォントを明示指定します

## `names.csv` について

`names.csv` は、名札に入れる名前の一覧ファイルです。

- UTF-8 で保存
- 最小構成は `name` 1 列
- 推奨列名は `name`, `氏名`, `名前`, `fullname`, `full_name`
- それ以外の列は無視
- `#` で始まる行はコメントとして無視

## カスタマイズ

普段調整する値は `generate_name_tags.py` の先頭付近にまとめています。

- `TITLE_TEXT`: 固定で入れる肩書きや団体名
- `TITLE_X`, `TITLE_Y`: 固定文言の位置
- `TITLE_FONT_SIZE`: 固定文言の文字サイズ
- `NAME_CENTER_X`, `NAME_CENTER_Y`: 名前の中心位置
- `NAME_FONT_SIZE`: 名前の初期文字サイズ
- `ROWS_PER_PAGE`, `COLUMNS_PER_ROW`: デフォルトの面付け
- `RANDOM_*`: 背景の切り出し位置や色味の揺れ幅

背景の差を強くしたいときは `RANDOM_SOURCE_WIDTH_MIN_RATIO` を下げると調整しやすいです。逆に、差を穏やかにしたいときは `RANDOM_*_JITTER` を小さくすると扱いやすいです。

## 含まれているファイル

- `generate_name_tags.py`: 名札 PDF 生成スクリプト
- `requirements.txt`: Python 依存関係
- `names.csv`: サンプル入力

## 注意

- `nafuda.png` はリポジトリに含めず、各利用者が自分で取得して配置する前提です
- `name_tags.pdf` は生成物なので Git 管理に含めません
- 素材を使う前に、配布元の利用規約と素材ページの注意事項を確認してください
