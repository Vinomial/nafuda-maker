from __future__ import annotations

import argparse
import csv
import hashlib
import io
import random
import secrets
import sys
from pathlib import Path

DEPENDENCY_ERROR: ModuleNotFoundError | None = None
MM = 72 / 25.4

try:
    from reportlab.lib.pagesizes import A4
except ModuleNotFoundError:
    A4 = (210 * MM, 297 * MM)

try:
    from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps
except ModuleNotFoundError as exc:
    DEPENDENCY_ERROR = exc

try:
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
except ModuleNotFoundError as exc:
    if DEPENDENCY_ERROR is None:
        DEPENDENCY_ERROR = exc

# ===== 普段触るところ =====
DEFAULT_NAMES_FILE = Path(__file__).with_name("names.csv")
OUTPUT_PDF = Path(__file__).with_name("name_tags.pdf")
DEFAULT_SOURCE_IMAGE = Path(__file__).with_name("nafuda.png")
DEFAULT_TEMPLATE_WIDTH = 537
DEFAULT_TEMPLATE_HEIGHT = 326

# None のままなら自動検出します。
NAME_FONT_PATH: Path | None = None
TITLE_FONT_PATH: Path | None = None

TITLE_TEXT = "阪神タイガース"
TITLE_X = 52
TITLE_Y = 94
TITLE_FONT_SIZE = 30

NAME_CENTER_X = 268
NAME_CENTER_Y = 182
NAME_FONT_SIZE = 64

QUIET_ZONE_LEFT = 52
QUIET_ZONE_TOP = 84
QUIET_ZONE_RIGHT = 486
QUIET_ZONE_BOTTOM = 236
QUIET_ZONE_RADIUS = 18
QUIET_ZONE_FILL = (255, 255, 255, 215)

ROWS_PER_PAGE = 5
COLUMNS_PER_ROW = 2

# ===== 以下は通常触らない =====
MIN_NAME_FONT_SIZE = 40
MAX_NAME_WIDTH = 390

TITLE_STROKE_WIDTH = 1
TITLE_STROKE_FILL = "white"

RANDOM_TOP_SOURCE_HEIGHT = 420
RANDOM_BOTTOM_SOURCE_START = 700
RANDOM_TOP_OUTPUT_HEIGHT = 108
RANDOM_BOTTOM_OUTPUT_HEIGHT = 124
RANDOM_COLOR_FACTOR = 1.42
RANDOM_CONTRAST_FACTOR = 1.14
RANDOM_SOURCE_WIDTH_MIN_RATIO = 0.58
RANDOM_SOURCE_WIDTH_MAX_RATIO = 0.92
RANDOM_TOP_SOURCE_TOP_MAX = 180
RANDOM_BOTTOM_SOURCE_END_MARGIN_MAX = 120
RANDOM_TOP_SOURCE_HEIGHT_JITTER = 50
RANDOM_BOTTOM_SOURCE_START_JITTER = 60
RANDOM_TOP_OUTPUT_HEIGHT_JITTER = 10
RANDOM_BOTTOM_OUTPUT_HEIGHT_JITTER = 12
RANDOM_COLOR_FACTOR_JITTER = 0.10
RANDOM_CONTRAST_FACTOR_JITTER = 0.04
RANDOM_MIRROR_CHANCE = 0.38

PAGE_MARGIN_MM = 6
PAGE_GAP_X_MM = 0
PAGE_GAP_Y_MM = 0
PAGE_MARGIN_X = PAGE_MARGIN_MM * MM
PAGE_MARGIN_Y = PAGE_MARGIN_MM * MM
PAGE_GAP_X = PAGE_GAP_X_MM * MM
PAGE_GAP_Y = PAGE_GAP_Y_MM * MM

DEFAULT_NAME_FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/ipaexfont-mincho/ipaexm.ttf",
    "/usr/share/fonts/truetype/fonts-japanese-mincho.ttf",
)
DEFAULT_TITLE_FONT_CANDIDATES = (
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/opentype/ipaexfont-gothic/ipaexg.ttf",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="元画像と名前一覧から、左右同一名の名札PDFを生成します。"
    )
    parser.add_argument(
        "--names",
        type=Path,
        default=DEFAULT_NAMES_FILE,
        help=f"名前一覧のCSV (default: {DEFAULT_NAMES_FILE.name})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=OUTPUT_PDF,
        help=f"出力PDF (default: {OUTPUT_PDF.name})",
    )
    parser.add_argument(
        "--source-image",
        type=Path,
        default=DEFAULT_SOURCE_IMAGE,
        help=(
            "背景生成に使う元画像 "
            f"(default: {DEFAULT_SOURCE_IMAGE.name})"
        ),
    )
    parser.add_argument(
        "--font",
        type=Path,
        default=NAME_FONT_PATH,
        help="名前用フォントのパス。未指定時は明朝系フォントを自動検出。",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=ROWS_PER_PAGE,
        help=f"1ページあたりの行数 (default: {ROWS_PER_PAGE})",
    )
    parser.add_argument(
        "--columns",
        type=int,
        default=COLUMNS_PER_ROW,
        help=f"1行あたりの複製数 (default: {COLUMNS_PER_ROW})",
    )
    parser.add_argument(
        "--seed",
        default="",
        help="ランダム背景の全体シード。未指定なら毎回自動生成します。",
    )
    return parser.parse_args()


def resolve_font_path(
    font_path: Path | None, candidates: tuple[str, ...], label: str
) -> Path:
    if font_path is not None:
        if not font_path.exists():
            raise FileNotFoundError(f"フォントが見つかりません: {font_path}")
        return font_path

    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return path

    joined = "\n".join(f"  - {candidate}" for candidate in candidates)
    raise FileNotFoundError(
        f"利用可能な{label}フォントを自動検出できませんでした。\n"
        "次のいずれかをインストールするか、--font で指定してください:\n"
        f"{joined}"
    )


def resolve_name_font_path(font_path: Path | None) -> Path:
    return resolve_font_path(font_path, DEFAULT_NAME_FONT_CANDIDATES, "名前用")


def resolve_title_font_path(font_path: Path | None) -> Path:
    return resolve_font_path(font_path, DEFAULT_TITLE_FONT_CANDIDATES, "固定文字用")


def load_names(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"名前一覧が見つかりません: {path}")
    if path.suffix.lower() != ".csv":
        raise ValueError("名前一覧は CSV で指定してください。")
    return load_names_from_csv(path)


def ensure_source_image_exists(source_image_path: Path) -> None:
    if source_image_path.exists():
        return

    raise FileNotFoundError(
        "ランダム背景生成用の元画像が見つかりません: "
        f"{source_image_path}"
    )


def load_names_from_csv(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        cleaned_lines = [
            line
            for line in handle
            if line.strip() and not line.lstrip().startswith("#")
        ]
        sample = "".join(cleaned_lines[:64])[:2048]
        cleaned_handle = io.StringIO("".join(cleaned_lines))
        try:
            has_header = csv.Sniffer().has_header(sample)
        except csv.Error:
            has_header = True
        if has_header:
            reader = csv.DictReader(cleaned_handle)
            field = pick_name_field(reader.fieldnames or [])
            names = [
                (row.get(field) or "").strip()
                for row in reader
                if row and (row.get(field) or "").strip()
            ]
        else:
            reader = csv.reader(cleaned_handle)
            names = [row[0].strip() for row in reader if row and row[0].strip()]

    if not names:
        raise ValueError(f"CSV に名前が見つかりませんでした: {path}")
    return names


def pick_name_field(fieldnames: list[str]) -> str:
    normalized = {field.strip().lower(): field for field in fieldnames if field}
    for candidate in ("name", "氏名", "名前", "fullname", "full_name"):
        key = candidate.lower()
        if key in normalized:
            return normalized[key]

    for field in fieldnames:
        if field:
            return field
    raise ValueError("CSV の列名を判定できませんでした。")


def fit_font(
    draw: ImageDraw.ImageDraw,
    text: str,
    font_path: Path,
    max_width: int,
    start_size: int,
    min_size: int,
) -> ImageFont.FreeTypeFont:
    size = start_size
    while size >= min_size:
        font = ImageFont.truetype(str(font_path), size=size)
        bbox = draw.textbbox((0, 0), text, font=font)
        width = bbox[2] - bbox[0]
        if width <= max_width:
            return font
        size -= 2

    return ImageFont.truetype(str(font_path), size=min_size)


def clamp_int(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(value, maximum))


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def make_variant_rng(variant_key: str, seed: str) -> random.Random:
    key = f"{seed}\0{variant_key}".encode("utf-8")
    digest = hashlib.blake2b(key, digest_size=16).digest()
    return random.Random(int.from_bytes(digest, "big"))


def resolve_seed(seed: str) -> tuple[str, bool]:
    if seed:
        return seed, False
    return secrets.token_hex(8), True


def build_resized_band(
    source: Image.Image,
    crop_box: tuple[int, int, int, int],
    width: int,
    height: int,
) -> Image.Image:
    left, top, right, bottom = crop_box
    return source.crop((left, top, right, bottom)).resize(
        (width, height),
        Image.Resampling.LANCZOS,
    )


def build_randomized_background(
    source: Image.Image,
    variant_key: str,
    seed: str,
) -> Image.Image:
    rng = make_variant_rng(variant_key, seed)
    width = DEFAULT_TEMPLATE_WIDTH
    height = DEFAULT_TEMPLATE_HEIGHT

    top_source_height = clamp_int(
        RANDOM_TOP_SOURCE_HEIGHT
        + rng.randint(
            -RANDOM_TOP_SOURCE_HEIGHT_JITTER,
            RANDOM_TOP_SOURCE_HEIGHT_JITTER,
        ),
        180,
        source.height - 120,
    )
    bottom_source_start = clamp_int(
        RANDOM_BOTTOM_SOURCE_START
        + rng.randint(
            -RANDOM_BOTTOM_SOURCE_START_JITTER,
            RANDOM_BOTTOM_SOURCE_START_JITTER,
        ),
        source.height // 2,
        source.height - 80,
    )
    top_output_height = clamp_int(
        RANDOM_TOP_OUTPUT_HEIGHT
        + rng.randint(
            -RANDOM_TOP_OUTPUT_HEIGHT_JITTER,
            RANDOM_TOP_OUTPUT_HEIGHT_JITTER,
        ),
        88,
        136,
    )
    bottom_output_height = clamp_int(
        RANDOM_BOTTOM_OUTPUT_HEIGHT
        + rng.randint(
            -RANDOM_BOTTOM_OUTPUT_HEIGHT_JITTER,
            RANDOM_BOTTOM_OUTPUT_HEIGHT_JITTER,
        ),
        96,
        144,
    )
    color_factor = clamp_float(
        RANDOM_COLOR_FACTOR
        + rng.uniform(
            -RANDOM_COLOR_FACTOR_JITTER,
            RANDOM_COLOR_FACTOR_JITTER,
        ),
        1.25,
        1.6,
    )
    contrast_factor = clamp_float(
        RANDOM_CONTRAST_FACTOR
        + rng.uniform(
            -RANDOM_CONTRAST_FACTOR_JITTER,
            RANDOM_CONTRAST_FACTOR_JITTER,
        ),
        1.08,
        1.22,
    )
    top_source_top = rng.randint(
        0,
        max(0, min(RANDOM_TOP_SOURCE_TOP_MAX, source.height - top_source_height - 1)),
    )
    bottom_source_end = source.height - rng.randint(
        0,
        min(
            RANDOM_BOTTOM_SOURCE_END_MARGIN_MAX,
            max(0, source.height - bottom_source_start - 80),
        ),
    )

    top_crop_width = clamp_int(
        round(
            source.width
            * rng.uniform(
                RANDOM_SOURCE_WIDTH_MIN_RATIO,
                RANDOM_SOURCE_WIDTH_MAX_RATIO,
            )
        ),
        1,
        source.width,
    )
    bottom_crop_width = clamp_int(
        round(
            source.width
            * rng.uniform(
                RANDOM_SOURCE_WIDTH_MIN_RATIO,
                RANDOM_SOURCE_WIDTH_MAX_RATIO,
            )
        ),
        1,
        source.width,
    )
    top_left = rng.randint(0, source.width - top_crop_width)
    bottom_left = rng.randint(0, source.width - bottom_crop_width)

    frame = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    top_band = build_resized_band(
        source=source,
        crop_box=(
            top_left,
            top_source_top,
            top_left + top_crop_width,
            top_source_top + top_source_height,
        ),
        width=width,
        height=top_output_height,
    )
    bottom_band = build_resized_band(
        source=source,
        crop_box=(
            bottom_left,
            bottom_source_start,
            bottom_left + bottom_crop_width,
            bottom_source_end,
        ),
        width=width,
        height=bottom_output_height,
    )
    if rng.random() < RANDOM_MIRROR_CHANCE:
        top_band = ImageOps.mirror(top_band)
    if rng.random() < RANDOM_MIRROR_CHANCE:
        bottom_band = ImageOps.mirror(bottom_band)
    frame.alpha_composite(top_band, (0, 0))
    frame.alpha_composite(bottom_band, (0, height - bottom_output_height))

    base = Image.new("RGBA", frame.size, "white")
    base.alpha_composite(frame)
    rgb = base.convert("RGB")
    rgb = ImageEnhance.Color(rgb).enhance(color_factor)
    rgb = ImageEnhance.Contrast(rgb).enhance(contrast_factor)
    return rgb.convert("RGBA")


def format_display_name(name: str) -> str:
    parts = name.split()
    if len(parts) >= 2:
        return " ".join(parts)
    return name.strip()


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    center_x: float,
    center_y: float,
    fill: str,
) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    x = center_x - (bbox[0] + bbox[2]) / 2
    y = center_y - (bbox[1] + bbox[3]) / 2
    draw.text((x, y), text, font=font, fill=fill)


def create_name_card(
    background: Image.Image,
    name: str,
    name_font_path: Path,
    title_font_path: Path,
) -> Image.Image:
    base = Image.new("RGBA", background.size, "white")
    base.alpha_composite(background)
    quiet_zone = Image.new("RGBA", background.size, (0, 0, 0, 0))
    quiet_zone_draw = ImageDraw.Draw(quiet_zone)
    quiet_zone_draw.rounded_rectangle(
        (
            QUIET_ZONE_LEFT,
            QUIET_ZONE_TOP,
            QUIET_ZONE_RIGHT,
            QUIET_ZONE_BOTTOM,
        ),
        radius=QUIET_ZONE_RADIUS,
        fill=QUIET_ZONE_FILL,
    )
    base.alpha_composite(quiet_zone)
    draw = ImageDraw.Draw(base)
    display_name = format_display_name(name)

    title_font = ImageFont.truetype(str(title_font_path), size=TITLE_FONT_SIZE)
    draw.text(
        (TITLE_X, TITLE_Y),
        TITLE_TEXT,
        font=title_font,
        fill="black",
        stroke_width=TITLE_STROKE_WIDTH,
        stroke_fill=TITLE_STROKE_FILL,
    )

    name_font = fit_font(
        draw=draw,
        text=display_name,
        font_path=name_font_path,
        max_width=MAX_NAME_WIDTH,
        start_size=NAME_FONT_SIZE,
        min_size=MIN_NAME_FONT_SIZE,
    )
    draw_centered_text(
        draw=draw,
        text=display_name,
        font=name_font,
        center_x=NAME_CENTER_X,
        center_y=NAME_CENTER_Y,
        fill="black",
    )

    draw.rectangle(
        [(0, 0), (base.width - 1, base.height - 1)],
        outline="black",
        width=2,
    )
    return base.convert("RGB")


def render_card_bytes(
    background: Image.Image,
    name: str,
    name_font_path: Path,
    title_font_path: Path,
) -> ImageReader:
    card = create_name_card(background, name, name_font_path, title_font_path)
    buffer = io.BytesIO()
    card.save(buffer, format="PNG")
    buffer.seek(0)
    return ImageReader(buffer)


def compute_card_size(
    page_width: float,
    page_height: float,
    image_width: int,
    image_height: int,
    rows: int,
    columns: int,
) -> tuple[float, float]:
    ratio = image_width / image_height
    usable_width = page_width - 2 * PAGE_MARGIN_X - (columns - 1) * PAGE_GAP_X
    usable_height = page_height - 2 * PAGE_MARGIN_Y - (rows - 1) * PAGE_GAP_Y
    width_from_columns = usable_width / columns
    width_from_rows = (usable_height / rows) * ratio
    card_width = min(width_from_columns, width_from_rows)
    card_height = card_width / ratio
    return card_width, card_height


def make_pdf(
    names: list[str],
    source_image_path: Path,
    name_font_path: Path,
    title_font_path: Path,
    output_pdf: Path,
    rows: int,
    columns: int,
    seed: str,
) -> None:
    if rows <= 0 or columns <= 0:
        raise ValueError("--rows と --columns は 1 以上で指定してください。")

    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    source_image = Image.open(source_image_path).convert("RGBA")
    page_width, page_height = A4
    card_width, card_height = compute_card_size(
        page_width=page_width,
        page_height=page_height,
        image_width=DEFAULT_TEMPLATE_WIDTH,
        image_height=DEFAULT_TEMPLATE_HEIGHT,
        rows=rows,
        columns=columns,
    )
    total_width = columns * card_width + (columns - 1) * PAGE_GAP_X
    total_height = rows * card_height + (rows - 1) * PAGE_GAP_Y
    start_x = (page_width - total_width) / 2
    start_y = page_height - (page_height - total_height) / 2

    pdf = canvas.Canvas(str(output_pdf), pagesize=A4)

    page_offsets = list(range(0, len(names), rows))
    for page_number, offset in enumerate(page_offsets):
        page_names = names[offset : offset + rows]
        for row_index, name in enumerate(page_names):
            card_key = f"{offset + row_index}:{name}"
            background = build_randomized_background(
                source=source_image,
                variant_key=card_key,
                seed=seed,
            )
            image = render_card_bytes(
                background,
                name,
                name_font_path,
                title_font_path,
            )

            for column_index in range(columns):
                x = start_x + column_index * (card_width + PAGE_GAP_X)
                y = start_y - (row_index + 1) * card_height - row_index * PAGE_GAP_Y
                pdf.drawImage(
                    image,
                    x,
                    y,
                    width=card_width,
                    height=card_height,
                    mask="auto",
                )

        if page_number != len(page_offsets) - 1:
            pdf.showPage()

    pdf.save()


def main() -> int:
    args = parse_args()
    if DEPENDENCY_ERROR is not None:
        print(
            "エラー: 依存関係が不足しています。"
            " `python3 -m pip install -r requirements.txt` を実行してから再実行してください。",
            file=sys.stderr,
        )
        return 1

    try:
        ensure_source_image_exists(args.source_image)
        effective_seed, auto_generated_seed = resolve_seed(args.seed)
        name_font_path = resolve_name_font_path(args.font)
        title_font_path = resolve_title_font_path(TITLE_FONT_PATH)
        names = load_names(args.names)
        make_pdf(
            names=names,
            source_image_path=args.source_image,
            name_font_path=name_font_path,
            title_font_path=title_font_path,
            output_pdf=args.output,
            rows=args.rows,
            columns=args.columns,
            seed=effective_seed,
        )
    except Exception as exc:  # pragma: no cover - CLI entry point
        print(f"エラー: {exc}", file=sys.stderr)
        return 1

    if auto_generated_seed:
        print(f"背景シードを自動生成しました: {effective_seed}")
    print(f"PDF を作成しました: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
