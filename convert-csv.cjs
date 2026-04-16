#!/usr/bin/env node
/**
 * 配車表CSV → kintoneインポートCSV 変換スクリプト
 *
 * Usage:
 *   node convert-csv.cjs input.csv [output.csv]
 */

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// ── 定数 ──
const KIND_MAP = {
  'ドライ': 'D',
  'リーファー': 'R',
  'タンク': 'T',
  'フラットラック': 'F',
  'オープントップ': 'O',
};

const KINTONE_FIELDS = [
  '配送日',
  '着時間0',
  '配送先_配送依頼',
  'コンテナ番号_配送依頼',
  'BL_BK',
  '搬出',
  '配送先住所',
  'サイズ',
  '種類',
  '本船名_配送依頼',
  '搬入',
  '配車_連携2',
  '配車_工程',
];

// ── CSV解析（簡易: カンマ区切り、クォート対応） ──
function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ── 日付変換: "2026年04月15日(水)" → "2026-04-15" ──
function parseJapaneseDate(text) {
  const m = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  const year = m[1];
  const month = m[2].padStart(2, '0');
  const day = m[3].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ── サイズ：種類 の分割 ──
// "40 9'6:ドライ" → { size: "40", kind: "D" }
// "20:リーファー"  → { size: "20", kind: "R" }
function parseSizeKind(text) {
  if (!text) return { size: '', kind: '' };
  const colonIdx = text.indexOf(':');
  if (colonIdx === -1) return { size: text.trim(), kind: '' };

  const sizePart = text.substring(0, colonIdx).trim();
  const kindPart = text.substring(colonIdx + 1).trim();

  // サイズ: 先頭の数字部分のみ抽出 ("40 9'6" → "40", "20" → "20")
  const sizeMatch = sizePart.match(/^(\d+)/);
  const size = sizeMatch ? sizeMatch[1] : sizePart;

  // 種類: 日本語名→コード変換
  const kind = KIND_MAP[kindPart] || kindPart;

  return { size, kind };
}

// ── CSV値のエスケープ ──
function escapeCSV(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ── メイン処理 ──
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node convert-csv.js <input.csv> [output.csv]');
    process.exit(1);
  }

  const inputPath = path.resolve(args[0]);
  const outputPath = args[1] ? path.resolve(args[1]) : path.join(path.dirname(inputPath), 'output_kintone.csv');

  // CP932で読み込み
  const buf = fs.readFileSync(inputPath);
  let text;
  // UTF-8 BOM判定
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    text = buf.toString('utf8');
  } else {
    text = iconv.decode(buf, 'cp932');
  }

  const lines = text.split(/\r?\n/);

  let deliveryDate = '';
  const records = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // 空行スキップ
    if (!line) { i++; continue; }

    const fields = parseCSVLine(lines[i]);

    // 日付行の検出: "2026年04月15日(水),,,,,,,"
    if (!deliveryDate || fields[0].match(/\d{4}年\d{1,2}月\d{1,2}日/)) {
      const dateStr = parseJapaneseDate(fields[0]);
      if (dateStr) {
        deliveryDate = dateStr;
        i++;
        continue;
      }
    }

    // ヘッダー行スキップ: "配車表", "手塚運輸株式会社", カラムヘッダー
    if (fields[0] === '配車表' ||
        fields[0].includes('手塚運輸') ||
        fields[0] === 'No.' ||
        fields[0] === '') {
      // 2行目ヘッダー (サイズ：種類 行) もスキップ
      // "No." の次行が ",,,サイズ：種類,..." なのでまとめて処理
      if (fields[0] === 'No.') {
        i += 2; // カラムヘッダー2行分
        continue;
      }
      // 空のフィールド0 = 2行目データの可能性があるが、ここではヘッダー内の空行
      // ヘッダー部分の空行判定: サイズ：種類 を含む場合はヘッダー2行目
      if (fields[0] === '' && fields.length >= 4 && fields[3] === 'サイズ：種類') {
        i++;
        continue;
      }
      // 得意先略称等が空でNo.も空 → 後で2行目として処理されるのでスキップしない
      if (fields[0] === '' && fields.length >= 4 && fields[3] !== 'サイズ：種類') {
        // データの2行目の可能性 → スキップしない（下のロジックで処理）
      } else {
        i++;
        continue;
      }
    }

    // ページ区切り行: "1?/ 2" のようなパターン
    if (fields[0].match(/^\d+\??\s*\/\s*\d+$/)) {
      i++;
      continue;
    }

    // データ行: 1行目はNo.が数字
    const no = fields[0].trim();
    if (no.match(/^\d+$/)) {
      // 1行目 (メインデータ)
      const row1 = fields;

      // 2行目を読む
      i++;
      let row2 = ['', '', '', '', '', '', '', ''];
      if (i < lines.length) {
        const nextLine = lines[i].trim();
        if (nextLine) {
          const nextFields = parseCSVLine(lines[i]);
          // 2行目かどうか: A列が空でD列にサイズ情報がある
          if (nextFields[0] === '' || nextFields[0].trim() === '') {
            row2 = nextFields;
            i++;
          }
          // 2行目でなければiを戻さない（次のループで処理）
        } else {
          i++; // 空行スキップ
        }
      }

      // フィールド抽出
      const time = (row1[1] || '').trim();
      const customer = (row1[2] || '').trim();      // 得意先略称
      const containerNo = (row1[3] || '').trim();
      const blBk = (row1[4] || '').trim();
      const pickup = (row1[5] || '').trim();         // 搬出
      const destination = (row1[6] || '').trim();     // 作業先 → 配送先
      const address = (row1[7] || '').trim();         // 作業先住所

      const sizeKindRaw = (row2[3] || '').trim();    // サイズ：種類
      const vessel = (row2[4] || '').trim();          // 本船
      const dropoff = (row2[5] || '').trim();         // 搬入
      // row2[7] = 指示書備考 (今回は使用しない)

      const { size, kind } = parseSizeKind(sizeKindRaw);

      records.push({
        '配送日': deliveryDate,
        '着時間0': time,
        '配送先_配送依頼': destination,
        'コンテナ番号_配送依頼': containerNo,
        'BL_BK': blBk,
        '搬出': pickup,
        '配送先住所': address,
        'サイズ': size,
        '種類': kind,
        '本船名_配送依頼': vessel,
        '搬入': dropoff,
        '配車_連携2': '未',
        '配車_工程': '0',
      });
    } else {
      // 不明な行 → スキップ
      i++;
    }
  }

  // CSV出力 (UTF-8 BOM付き)
  const header = KINTONE_FIELDS.map(escapeCSV).join(',');
  const rows = records.map(rec =>
    KINTONE_FIELDS.map(f => escapeCSV(rec[f])).join(',')
  );

  const csvContent = '\uFEFF' + header + '\n' + rows.join('\n') + '\n';
  fs.writeFileSync(outputPath, csvContent, 'utf8');

  console.log(`変換完了: ${records.length} 件`);
  console.log(`出力: ${outputPath}`);

  // サマリ表示
  if (records.length > 0) {
    console.log(`\n日付: ${records[0]['配送日']}`);
    console.log('--- 先頭3件 ---');
    records.slice(0, 3).forEach((r, idx) => {
      console.log(`  ${idx + 1}. ${r['着時間0']} ${r['配送先_配送依頼']} [${r['コンテナ番号_配送依頼']}] ${r['サイズ']}ft ${r['種類']}`);
    });
  }
}

main();
