"use strict";

// generate_name_tags.py をブラウザ向けに移植したもの。
// 座標はすべて名札テンプレート (537x326) 上のピクセル値。

// ===== 普段触るところ =====
const CONFIG = {
  templateWidth: 537,
  templateHeight: 326,

  titleX: 52,
  titleY: 94,
  titleFontSize: 30,

  nameCenterX: 268,
  nameCenterY: 182,
  nameFontSize: 64,

  // ふりがなを表示するときは名前を少し下げる
  kanaCenterY: 145,
  kanaFontSize: 21,
  nameCenterYWithKana: 194,

  quietZone: { left: 52, top: 84, right: 486, bottom: 236, radius: 18 },
  quietZoneFill: "rgba(255, 255, 255, 0.843)", // 215 / 255

  // ===== 以下は通常触らない =====
  minNameFontSize: 40,
  maxNameWidth: 390,
  titleStrokeWidth: 1,

  randomTopSourceHeight: 420,
  randomBottomSourceStart: 700,
  randomTopOutputHeight: 108,
  randomBottomOutputHeight: 124,
  randomColorFactor: 1.42,
  randomContrastFactor: 1.14,
  randomSourceWidthMinRatio: 0.58,
  randomSourceWidthMaxRatio: 0.92,
  randomTopSourceTopMax: 180,
  randomBottomSourceEndMarginMax: 120,
  randomTopSourceHeightJitter: 50,
  randomBottomSourceStartJitter: 60,
  randomTopOutputHeightJitter: 10,
  randomBottomOutputHeightJitter: 12,
  randomColorFactorJitter: 0.1,
  randomContrastFactorJitter: 0.04,
  randomMirrorChance: 0.38,

  // 上の RANDOM 系の値は高さ 900px 以上の元画像を前提にしているので、
  // それより小さい画像はこの高さまで拡大してから切り出す。
  minSourceHeight: 900,

  pageMarginMm: 6,
  pageGapXMm: 0,
  pageGapYMm: 0,

  // 名札サイズ (mm)。null はページに合わせて最大化
  cardSizes: {
    auto: null,
    meishi: [91, 55], // 名刺サイズ。市販の名札ケースの多くに入る
  },

  // PDF に埋め込む名札画像の解像度倍率 (3 なら 1611x978px)
  pdfScale: 3,
  pdfJpegQuality: 0.92,
};

const FONTS = {
  serif: { family: '"Noto Serif JP"', weight: 400 },
  sans: { family: '"Noto Sans JP"', weight: 700 },
};
const TITLE_FONT = FONTS.sans;
// CSV の列名 (小文字で比較する)
const COLUMN_HEADERS = {
  name: ["name", "氏名", "名前", "fullname", "full_name"],
  kana: ["ふりがな", "フリガナ", "よみがな", "ヨミガナ", "kana", "furigana", "reading"],
  org: ["所属", "会社", "部署", "役職", "団体", "affiliation", "organization", "company", "title"],
};
// 架空の人物
const SAMPLE_ROWS = [
  ["山田 太郎", "やまだ たろう"],
  ["鈴木 花子", "すずき はなこ"],
  ["佐藤 一郎", "さとう いちろう"],
  ["高橋 美咲", "たかはし みさき"],
  ["田中 健太", "たなか けんた"],
  ["伊藤 さくら", "いとう さくら"],
  ["渡辺 大輔", "わたなべ だいすけ"],
  ["中村 結衣", "なかむら ゆい"],
  ["小林 翔", "こばやし しょう"],
];

const MM = 72 / 25.4;
const A4_WIDTH = 210 * MM;
const A4_HEIGHT = 297 * MM;

// ===== 乱数 =====

function hashSeed(text) {
  // cyrb128: 文字列から 128bit のシードを作る
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function makeVariantRng(variantKey, seed) {
  // sfc32
  let [a, b, c, d] = hashSeed(`${seed}\0${variantKey}`);
  const random = () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) random();
  return {
    random,
    randint: (min, max) => min + Math.floor(random() * (max - min + 1)),
    uniform: (min, max) => min + (max - min) * random(),
  };
}

function randomSeed() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

// ===== 名前一覧 =====

function splitCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

// 1 行 1 名。列名の行があればそれに従い、なければ「名前,(ふりがな,)所属」の順とみなす
function parseEntries(text, withKana) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((f) => f.trim().toLowerCase());
  const find = (key) => header.findIndex((f) => COLUMN_HEADERS[key].includes(f));
  let columns = withKana ? { name: 0, kana: 1, org: 2 } : { name: 0, kana: -1, org: 1 };
  let body = lines;
  if (find("name") >= 0) {
    columns = { name: find("name"), kana: find("kana"), org: find("org") };
    body = lines.slice(1);
  }
  return body
    .map((line) => {
      const fields = splitCsvLine(line);
      const get = (i) => (i >= 0 ? fields[i] || "" : "").trim();
      return { name: get(columns.name), kana: get(columns.kana), org: get(columns.org) };
    })
    .filter((entry) => entry.name);
}

function formatDisplayName(name) {
  return name.trim().split(/\s+/).join(" ");
}

// ===== 背景 =====

function prepareSource(image) {
  const scale = Math.max(1, CONFIG.minSourceHeight / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// 素材がなくても試せるように、上下に水玉模様のある背景をその場で描く
function createSampleSource() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1100;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rng = makeVariantRng("sample", "nafuda");
  const colors = ["#f28b82", "#fbbc04", "#81c995", "#78d9ec", "#a7c7fa", "#d7aefb"];
  const bands = [
    [0, 470],
    [630, 1100],
  ];
  for (let i = 0; i < 260; i++) {
    const [top, bottom] = bands[i % 2];
    ctx.globalAlpha = 0.45 + rng.random() * 0.4;
    ctx.fillStyle = colors[rng.randint(0, colors.length - 1)];
    ctx.beginPath();
    ctx.arc(
      rng.uniform(0, canvas.width),
      rng.uniform(top, bottom),
      rng.uniform(14, 64),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function drawBand(ctx, source, crop, y, width, height, mirror) {
  const [left, top, right, bottom] = crop;
  ctx.save();
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, left, top, right - left, bottom - top, 0, y, width, height);
  ctx.restore();
}

// PIL の ImageEnhance.Color / Contrast と同じ計算
function enhance(ctx, width, height, colorFactor, contrastFactor) {
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  let graySum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const gray = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    for (let c = 0; c < 3; c++) {
      d[i + c] = clamp(Math.round(gray + colorFactor * (d[i + c] - gray)), 0, 255);
    }
    graySum += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  }
  const mean = Math.floor(graySum / (width * height) + 0.5);
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      d[i + c] = clamp(Math.round(mean + contrastFactor * (d[i + c] - mean)), 0, 255);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function buildRandomizedBackground(source, variantKey, seed, scale) {
  const width = Math.round(CONFIG.templateWidth * scale);
  const height = Math.round(CONFIG.templateHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (!source) return canvas;

  const rng = makeVariantRng(variantKey, seed);
  const sw = source.width;
  const sh = source.height;

  const topSourceHeight = clamp(
    CONFIG.randomTopSourceHeight +
      rng.randint(-CONFIG.randomTopSourceHeightJitter, CONFIG.randomTopSourceHeightJitter),
    180,
    sh - 120,
  );
  const bottomSourceStart = clamp(
    CONFIG.randomBottomSourceStart +
      rng.randint(-CONFIG.randomBottomSourceStartJitter, CONFIG.randomBottomSourceStartJitter),
    Math.floor(sh / 2),
    sh - 80,
  );
  const topOutputHeight = clamp(
    CONFIG.randomTopOutputHeight +
      rng.randint(-CONFIG.randomTopOutputHeightJitter, CONFIG.randomTopOutputHeightJitter),
    88,
    136,
  );
  const bottomOutputHeight = clamp(
    CONFIG.randomBottomOutputHeight +
      rng.randint(-CONFIG.randomBottomOutputHeightJitter, CONFIG.randomBottomOutputHeightJitter),
    96,
    144,
  );
  const colorFactor = clamp(
    CONFIG.randomColorFactor +
      rng.uniform(-CONFIG.randomColorFactorJitter, CONFIG.randomColorFactorJitter),
    1.25,
    1.6,
  );
  const contrastFactor = clamp(
    CONFIG.randomContrastFactor +
      rng.uniform(-CONFIG.randomContrastFactorJitter, CONFIG.randomContrastFactorJitter),
    1.08,
    1.22,
  );
  const topSourceTop = rng.randint(
    0,
    Math.max(0, Math.min(CONFIG.randomTopSourceTopMax, sh - topSourceHeight - 1)),
  );
  const bottomSourceEnd =
    sh -
    rng.randint(
      0,
      Math.min(CONFIG.randomBottomSourceEndMarginMax, Math.max(0, sh - bottomSourceStart - 80)),
    );

  const cropWidth = () =>
    clamp(
      Math.round(
        sw * rng.uniform(CONFIG.randomSourceWidthMinRatio, CONFIG.randomSourceWidthMaxRatio),
      ),
      1,
      sw,
    );
  const topCropWidth = cropWidth();
  const bottomCropWidth = cropWidth();
  const topLeft = rng.randint(0, sw - topCropWidth);
  const bottomLeft = rng.randint(0, sw - bottomCropWidth);
  const mirrorTop = rng.random() < CONFIG.randomMirrorChance;
  const mirrorBottom = rng.random() < CONFIG.randomMirrorChance;

  const topH = Math.round(topOutputHeight * scale);
  const bottomH = Math.round(bottomOutputHeight * scale);
  ctx.imageSmoothingQuality = "high";
  drawBand(
    ctx,
    source,
    [topLeft, topSourceTop, topLeft + topCropWidth, topSourceTop + topSourceHeight],
    0,
    width,
    topH,
    mirrorTop,
  );
  drawBand(
    ctx,
    source,
    [bottomLeft, bottomSourceStart, bottomLeft + bottomCropWidth, bottomSourceEnd],
    height - bottomH,
    width,
    bottomH,
    mirrorBottom,
  );
  enhance(ctx, width, height, colorFactor, contrastFactor);
  return canvas;
}

// ===== 名札 =====

const fontSpec = (font, size) => `${font.weight} ${size}px ${font.family}`;

async function ensureFonts(entries, options) {
  // Google Fonts は文字ごとに分割配信されるので、実際に使う文字で読み込む
  const titleText = options.title + entries.map((e) => e.org).join("");
  const nameText = entries.map((e) => e.name + e.kana).join("");
  await Promise.all([
    document.fonts.load(fontSpec(TITLE_FONT, CONFIG.titleFontSize), titleText || "あ"),
    document.fonts.load(fontSpec(options.nameFont, CONFIG.nameFontSize), nameText || "あ"),
  ]);
}

function drawCenteredText(ctx, text, centerX, centerY) {
  const m = ctx.measureText(text);
  const x = centerX - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const y = centerY + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  ctx.fillText(text, x, y);
}

function fitFont(ctx, text, font) {
  for (let size = CONFIG.nameFontSize; size >= CONFIG.minNameFontSize; size -= 2) {
    ctx.font = fontSpec(font, size);
    const m = ctx.measureText(text);
    if (m.actualBoundingBoxLeft + m.actualBoundingBoxRight <= CONFIG.maxNameWidth) return;
  }
  ctx.font = fontSpec(font, CONFIG.minNameFontSize);
}

function createNameCard(background, entry, options, scale) {
  const canvas = document.createElement("canvas");
  canvas.width = background.width;
  canvas.height = background.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(background, 0, 0);
  ctx.scale(scale, scale);

  const q = CONFIG.quietZone;
  ctx.fillStyle = CONFIG.quietZoneFill;
  ctx.beginPath();
  ctx.roundRect(q.left, q.top, q.right - q.left, q.bottom - q.top, q.radius);
  ctx.fill();

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  // 人ごとの所属があれば共通の肩書きより優先する
  const title = entry.org || options.title;
  if (title) {
    ctx.font = fontSpec(TITLE_FONT, CONFIG.titleFontSize);
    const m = ctx.measureText(title);
    const y = CONFIG.titleY + m.fontBoundingBoxAscent;
    ctx.lineJoin = "round";
    ctx.lineWidth = CONFIG.titleStrokeWidth * 2;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(title, CONFIG.titleX, y);
    ctx.fillStyle = "#000000";
    ctx.fillText(title, CONFIG.titleX, y);
  }

  ctx.fillStyle = "#000000";
  const showKana = options.showKana && entry.kana;
  if (showKana) {
    ctx.font = fontSpec(options.nameFont, CONFIG.kanaFontSize);
    drawCenteredText(ctx, formatDisplayName(entry.kana), CONFIG.nameCenterX, CONFIG.kanaCenterY);
  }

  const displayName = formatDisplayName(entry.name);
  fitFont(ctx, displayName, options.nameFont);
  drawCenteredText(
    ctx,
    displayName,
    CONFIG.nameCenterX,
    showKana ? CONFIG.nameCenterYWithKana : CONFIG.nameCenterY,
  );

  if (options.border !== "none") {
    ctx.lineWidth = options.border === "dashed" ? 1.5 : 2;
    ctx.strokeStyle = options.border === "dashed" ? "#666666" : "#000000";
    ctx.setLineDash(options.border === "dashed" ? [8, 6] : []);
    ctx.strokeRect(1, 1, CONFIG.templateWidth - 2, CONFIG.templateHeight - 2);
  }
  return canvas;
}

function renderCard(index, entry, options, scale) {
  const background = buildRandomizedBackground(
    options.source,
    `${index}:${entry.name}`,
    options.seed,
    scale,
  );
  return createNameCard(background, entry, options, scale);
}

// ===== レイアウト =====

const PAGE_MARGIN = CONFIG.pageMarginMm * MM;
const GAP_X = CONFIG.pageGapXMm * MM;
const GAP_Y = CONFIG.pageGapYMm * MM;

// 固定サイズの名札が 1 ページに何行・何枚まで入るか
function maxGrid(sizeMm) {
  if (!sizeMm) return { rows: Infinity, columns: Infinity };
  const [w, h] = sizeMm.map((v) => v * MM);
  return {
    rows: Math.max(1, Math.floor((A4_HEIGHT - 2 * PAGE_MARGIN + GAP_Y) / (h + GAP_Y))),
    columns: Math.max(1, Math.floor((A4_WIDTH - 2 * PAGE_MARGIN + GAP_X) / (w + GAP_X))),
  };
}

function computeLayout(rows, columns, sizeMm) {
  const gapX = GAP_X;
  const gapY = GAP_Y;
  let cardWidth;
  let cardHeight;
  if (sizeMm) {
    [cardWidth, cardHeight] = sizeMm.map((v) => v * MM);
  } else {
    const ratio = CONFIG.templateWidth / CONFIG.templateHeight;
    const usableWidth = A4_WIDTH - 2 * PAGE_MARGIN - (columns - 1) * gapX;
    const usableHeight = A4_HEIGHT - 2 * PAGE_MARGIN - (rows - 1) * gapY;
    cardWidth = Math.min(usableWidth / columns, (usableHeight / rows) * ratio);
    cardHeight = cardWidth / ratio;
  }
  const totalWidth = columns * cardWidth + (columns - 1) * gapX;
  const totalHeight = rows * cardHeight + (rows - 1) * gapY;
  const startX = (A4_WIDTH - totalWidth) / 2;
  const startY = (A4_HEIGHT - totalHeight) / 2;
  // ページ左上を原点とした pt 座標
  const position = (row, column) => ({
    x: startX + column * (cardWidth + gapX),
    y: startY + row * (cardHeight + gapY),
  });
  return { cardWidth, cardHeight, position };
}

// ===== 画面 =====

const $ = (id) => document.getElementById(id);
const els = {
  bgInput: $("bg-input"),
  sampleBg: $("sample-bg"),
  bgStatus: $("bg-status"),
  dropzone: $("dropzone"),
  names: $("names"),
  csvInput: $("csv-input"),
  csvTemplate: $("csv-template"),
  nameCount: $("name-count"),
  title: $("title"),
  nameFont: $("name-font"),
  rows: $("rows"),
  columns: $("columns"),
  seed: $("seed"),
  reseed: $("reseed"),
  form: $("settings"),
  generate: $("generate"),
  message: $("message"),
  sheet: $("sheet"),
  prevPage: $("prev-page"),
  nextPage: $("next-page"),
  pageLabel: $("page-label"),
  kanaRadios: document.querySelectorAll('input[name="kana"]'),
  cardSize: $("card-size"),
  arrange: $("arrange"),
  border: $("border"),
  gridNote: $("grid-note"),
};

const state = {
  source: null,
  entries: [],
  title: "",
  nameFont: FONTS.serif,
  rows: 5,
  columns: 2,
  seed: "",
  showKana: false,
  cardSize: null,
  arrange: "duplicate",
  border: "solid",
  page: 0,
};

function kanaEnabled() {
  return document.querySelector('input[name="kana"]:checked')?.value === "on";
}

function sampleText(withKana) {
  const rows = SAMPLE_ROWS.map(([name, kana]) => (withKana ? `${name},${kana}` : name));
  return [withKana ? "名前,ふりがな,所属" : "名前,所属", ...rows].join("\n");
}

function readPositiveInt(input, fallback) {
  const value = parseInt(input.value, 10);
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

function readForm() {
  state.showKana = kanaEnabled();
  state.entries = parseEntries(els.names.value, state.showKana);
  state.title = els.title.value.trim();
  state.nameFont = FONTS[els.nameFont.value] || FONTS.serif;
  state.cardSize = CONFIG.cardSizes[els.cardSize.value] || null;
  state.arrange = els.arrange.value;
  state.border = els.border.value;

  const max = maxGrid(state.cardSize);
  state.rows = Math.min(readPositiveInt(els.rows, 5), max.rows);
  state.columns = Math.min(readPositiveInt(els.columns, 2), max.columns);
  els.gridNote.textContent = state.cardSize
    ? `このサイズは 1 ページに最大 ${max.rows} 行 × ${max.columns} 枚です。`
    : "";

  if (!els.seed.value.trim()) els.seed.value = randomSeed();
  state.seed = els.seed.value.trim();
  els.nameCount.textContent = `${state.entries.length} 名`;
}

// ページごとに、どの名札をどの位置 (行・列) に置くかを決める
function buildPages() {
  const sequential = state.arrange === "sequential";
  const perPage = sequential ? state.rows * state.columns : state.rows;
  const pages = [];
  state.entries.forEach((entry, index) => {
    const i = index % perPage;
    if (i === 0) pages.push([]);
    const slots = sequential
      ? [{ row: Math.floor(i / state.columns), column: i % state.columns }]
      : Array.from({ length: state.columns }, (_, column) => ({ row: i, column }));
    pages[pages.length - 1].push({ entry, index, slots });
  });
  return pages;
}

function cardOptions() {
  return {
    source: state.source,
    title: state.title,
    nameFont: state.nameFont,
    seed: state.seed,
    showKana: state.showKana,
    border: state.border,
  };
}

function setMessage(text, isError = false) {
  els.message.textContent = text;
  els.message.classList.toggle("error", isError);
}

let previewToken = 0;

async function renderPreview() {
  const token = ++previewToken;
  readForm();
  const pages = buildPages();
  const pageCount = Math.max(1, pages.length);
  state.page = clamp(state.page, 0, pageCount - 1);
  els.pageLabel.textContent = `${state.page + 1} / ${pageCount}`;
  els.prevPage.disabled = state.page === 0;
  els.nextPage.disabled = state.page >= pageCount - 1;

  const cards = pages[state.page] || [];
  const options = cardOptions();
  await ensureFonts(
    cards.map((card) => card.entry),
    options,
  );
  if (token !== previewToken) return;

  const layout = computeLayout(state.rows, state.columns, state.cardSize);
  const scale = Math.min(2, window.devicePixelRatio || 1);
  const fragment = document.createDocumentFragment();
  cards.forEach(({ entry, index, slots }) => {
    const url = renderCard(index, entry, options, scale).toDataURL("image/png");
    slots.forEach(({ row, column }, i) => {
      const { x, y } = layout.position(row, column);
      const img = document.createElement("img");
      img.src = url;
      img.alt = i === 0 ? `${entry.name} の名札` : "";
      img.style.left = `${(x / A4_WIDTH) * 100}%`;
      img.style.top = `${(y / A4_HEIGHT) * 100}%`;
      img.style.width = `${(layout.cardWidth / A4_WIDTH) * 100}%`;
      img.style.height = `${(layout.cardHeight / A4_HEIGHT) * 100}%`;
      fragment.appendChild(img);
    });
  });
  if (cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "名前を入力するとここに表示されます";
    fragment.appendChild(empty);
  }
  els.sheet.replaceChildren(fragment);
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    renderPreview().catch((error) => setMessage(`プレビューに失敗しました: ${error.message}`, true));
  }, 250);
}

// 進捗表示を描画させるために処理を一度譲る (rAF は非表示タブで止まるので使わない)
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

async function generatePdf() {
  readForm();
  if (state.entries.length === 0) {
    setMessage("名前が 1 件もありません。", true);
    return;
  }
  if (!window.jspdf) {
    setMessage("PDF ライブラリを読み込めませんでした。ネットワークを確認して再読み込みしてください。", true);
    return;
  }

  els.generate.disabled = true;
  try {
    const options = cardOptions();
    await ensureFonts(state.entries, options);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const layout = computeLayout(state.rows, state.columns, state.cardSize);
    const pages = buildPages();
    const total = state.entries.length;

    for (const [pageIndex, cards] of pages.entries()) {
      if (pageIndex > 0) pdf.addPage();
      for (const { entry, index, slots } of cards) {
        setMessage(`作成中… ${index + 1} / ${total}`);
        await nextFrame();

        const card = renderCard(index, entry, options, CONFIG.pdfScale);
        const data = card.toDataURL("image/jpeg", CONFIG.pdfJpegQuality);
        for (const { row, column } of slots) {
          const { x, y } = layout.position(row, column);
          pdf.addImage(data, "JPEG", x, y, layout.cardWidth, layout.cardHeight, `card-${index}`);
        }
      }
    }

    pdf.save("name_tags.pdf");
    setMessage(`PDF を作成しました(${total} 名・${pages.length} ページ、シード: ${state.seed})`);
  } catch (error) {
    console.error(error);
    setMessage(`PDF の作成に失敗しました: ${error.message}`, true);
  } finally {
    els.generate.disabled = false;
  }
}

// Excel で保存した CSV は Shift_JIS のことが多いので、UTF-8 で読めなければそちらで読む
function decodeCsv(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("shift_jis").decode(buffer);
  }
}

// Excel でそのまま開けるよう、BOM 付き UTF-8・CRLF で書き出す
function downloadCsvTemplate() {
  const withKana = kanaEnabled();
  const rows = withKana
    ? [
        ["名前", "ふりがな", "所属"],
        ["山田 太郎", "やまだ たろう", "営業部"],
        ["鈴木 花子", "すずき はなこ", ""],
      ]
    : [
        ["名前", "所属"],
        ["山田 太郎", "営業部"],
        ["鈴木 花子", ""],
      ];
  const csv = "\uFEFF" + rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = withKana ? "names_template_kana.csv" : "names_template.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

async function handleImageFile(file) {
  if (!file) return;
  try {
    const img = await loadImageFile(file);
    state.source = prepareSource(img);
    els.bgStatus.textContent = `${file.name}(${img.width}×${img.height})`;
    els.dropzone.classList.add("has-image");
    setMessage("");
    schedulePreview();
  } catch (error) {
    setMessage(error.message, true);
  }
}

function init() {
  els.names.value = sampleText(false);
  els.seed.value = randomSeed();

  els.bgInput.addEventListener("change", () => handleImageFile(els.bgInput.files[0]));
  els.sampleBg.addEventListener("click", () => {
    state.source = createSampleSource();
    els.bgInput.value = "";
    els.bgStatus.textContent = "サンプル背景(自動生成)";
    els.dropzone.classList.add("has-image");
    setMessage("");
    schedulePreview();
  });
  ["dragenter", "dragover"].forEach((type) =>
    els.dropzone.addEventListener(type, () => els.dropzone.classList.add("dragover")),
  );
  ["dragleave", "drop"].forEach((type) =>
    els.dropzone.addEventListener(type, () => els.dropzone.classList.remove("dragover")),
  );

  els.csvTemplate.addEventListener("click", downloadCsvTemplate);
  els.csvInput.addEventListener("change", async () => {
    const file = els.csvInput.files[0];
    if (!file) return;
    els.names.value = decodeCsv(await file.arrayBuffer());
    els.csvInput.value = "";
    state.page = 0;
    schedulePreview();
  });

  [els.names, els.title, els.rows, els.columns, els.seed].forEach((el) =>
    el.addEventListener("input", schedulePreview),
  );
  // サンプルのままなら、ふりがなの有無に合わせてサンプルも入れ替える
  els.kanaRadios.forEach((radio) =>
    radio.addEventListener("change", () => {
      const withKana = kanaEnabled();
      if (els.names.value.trim() === sampleText(!withKana)) els.names.value = sampleText(withKana);
      schedulePreview();
    }),
  );
  [els.nameFont, els.cardSize, els.arrange, els.border].forEach((el) =>
    el.addEventListener("change", schedulePreview),
  );
  els.reseed.addEventListener("click", () => {
    els.seed.value = randomSeed();
    schedulePreview();
  });
  els.prevPage.addEventListener("click", () => {
    state.page--;
    schedulePreview();
  });
  els.nextPage.addEventListener("click", () => {
    state.page++;
    schedulePreview();
  });
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    generatePdf();
  });

  schedulePreview();
}

init();
