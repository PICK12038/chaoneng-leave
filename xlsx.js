/**
 * 浏览器版 xlsx 生成器（移植自 ../lib/xlsx.mjs，只把 Buffer 换成 Uint8Array）。
 * 支持：多工作表、表头样式、列宽、自动筛选、冻结首行、居中对齐。
 * 不压缩（ZIP store 模式），一个 250 行 4 表的文件约 20KB。
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const utf8 = (s) => new TextEncoder().encode(String(s));
const alloc = (n) => new Uint8Array(n);
const view = (u) => new DataView(u.buffer, u.byteOffset, u.byteLength);

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function concat(list) {
  let size = 0;
  for (const u of list) size += u.length;
  const out = new Uint8Array(size);
  let off = 0;
  for (const u of list) {
    out.set(u, off);
    off += u.length;
  }
  return out;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function zipStore(files) {
  const { time, day } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = utf8(file.name);
    const data = typeof file.data === 'string' ? utf8(file.data) : file.data;
    const crc = crc32(data);

    const local = alloc(30);
    const lv = view(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    locals.push(local, name, data);

    const central = alloc(46);
    const cv = view(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = concat(centrals);
  const eocd = alloc(22);
  const ev = view(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBuf.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return concat([...locals, centralBuf, eocd]);
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(sheet) {
  const rows = sheet.rows || [];
  const widths = sheet.widths || [];
  let maxCols = 0;
  rows.forEach((r) => (maxCols = Math.max(maxCols, r.length)));
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const body = rows
    .map((cells, ri) => {
      const r = ri + 1;
      const style = ri === 0 ? 1 : 2;
      const tds = cells
        .map((v, ci) => {
          if (v === null || v === undefined || v === '') return '';
          const ref = `${colName(ci)}${r}`;
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
          }
          const text = typeof v === 'object' && v !== null ? String(v.text ?? '') : String(v);
          const s = typeof v === 'object' && v !== null && v.style != null ? v.style : style;
          return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
        })
        .join('');
      const ht = ri === 0 ? ' ht="26" customHeight="1"' : '';
      return `<row r="${r}"${ht}>${tds}</row>`;
    })
    .join('');
  const ref = `A1:${colName(Math.max(0, maxCols - 1))}${Math.max(1, rows.length)}`;
  const pane =
    rows.length > 1
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    pane +
    `<sheetFormatPr defaultRowHeight="22"/>` +
    cols +
    `<sheetData>${body}</sheetData>` +
    (rows.length > 1 ? `<autoFilter ref="${ref}"/>` : '') +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="微软雅黑"/></font><font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="微软雅黑"/></font><font><sz val="11"/><color rgb="FFB91C1C"/><name val="微软雅黑"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F2F4"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8DCE3"/></left><right style="thin"><color rgb="FFD8DCE3"/></right><top style="thin"><color rgb="FFD8DCE3"/></top><bottom style="thin"><color rgb="FFD8DCE3"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function buildXlsx(sheets) {
  const sheetEntries = sheets.map((s, i) => ({ ...s, index: i + 1 }));
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheetEntries
      .map(
        (s) =>
          `<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join('') +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    sheetEntries.map((s) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join('') +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetEntries
      .map(
        (s) =>
          `<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`
      )
      .join('') +
    `<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: STYLES },
    ...sheetEntries.map((s) => ({ name: `xl/worksheets/sheet${s.index}.xml`, data: sheetXml(s) })),
  ];
  return zipStore(files);
}
