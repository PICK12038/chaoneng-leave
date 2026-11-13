/**
 * 表格截图识别（浏览器版，无依赖）：
 *   把分班表截图切成单元格，逐格 Tesseract OCR，再用名册纠错，
 *   还原成「姓名 + 班级 + 组别」列表，喂给 parseRosterText 的预览流程。
 *
 * 结构推断不靠标题文字：每段 = 1 序号列 + 4 组列，段顺序固定
 *   丰泰班 → 超能1班 → 超能2班 → 超能3班
 */
const CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const OCR_LANG = 'chi_sim';
const OCR_LANG_URL = 'https://tessdata.projectnaptha.com/4.0.0/chi_sim.traineddata.gz';
const CLASS_ORDER = ['丰泰班', '超能1班', '超能2班', '超能3班'];

let workerPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('OCR 引擎加载失败，请检查网络'));
    document.head.appendChild(el);
  });
}

async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(CDN);
      return window.Tesseract.createWorker(OCR_LANG, 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        logger: (m) => {
          if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
        },
      });
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

/* ---------- 图像处理（纯 canvas，无依赖） ---------- */
function toGray(imgEl) {
  const c = document.createElement('canvas');
  // 统一放大到宽 ≥1600，小图识别率太低
  const k = Math.max(1, 1600 / imgEl.naturalWidth);
  c.width = Math.round(imgEl.naturalWidth * k);
  c.height = Math.round(imgEl.naturalHeight * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(imgEl, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const gray = new Float32Array(c.width * c.height);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return { gray, width: c.width, height: c.height, canvas: c, ctx: g };
}

function findLines(gray, width, height) {
  // 每行/列的「暗像素占比」
  const rowScore = new Float32Array(height);
  const colScore = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    let s = 0;
    for (let x = 0; x < width; x++) s += 1 - gray[y * width + x] / 255;
    rowScore[y] = s / width;
  }
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y < height; y++) s += 1 - gray[y * width + x] / 255;
    colScore[x] = s / height;
  }
  const peaks = (score, len) => {
    // 阈值自适应：从 0.35 逐步放宽
    for (const ratio of [0.35, 0.25, 0.15, 0.08]) {
      const sorted = [...score].sort((a, b) => b - a);
      const base = sorted[Math.floor(len * 0.5)];
      const top = sorted[Math.floor(len * 0.01)];
      const thr = base + (top - base) * ratio;
      const idx = [];
      for (let i = 0; i < len; i++) if (score[i] >= thr) idx.push(i);
      if (!idx.length) continue;
      const groups = [[idx[0], idx[0]]];
      for (const v of idx.slice(1)) {
        if (v - groups[groups.length - 1][1] <= 5) groups[groups.length - 1][1] = v;
        else groups.push([v, v]);
      }
      const lines = groups.map(([s, e]) => {
        let best = s;
        for (let i = s; i <= e; i++) if (score[i] > score[best]) best = i;
        return best;
      });
      if (lines.length >= 8) return lines;
    }
    return [];
  };
  return { rows: peaks(rowScore, height), cols: peaks(colScore, width) };
}

function dedupe(lines, minGap) {
  const out = [];
  for (const v of lines) {
    if (!out.length || v - out[out.length - 1] >= minGap) out.push(v);
  }
  return out;
}

/* 把竖线序列切成段（每段 = 序号 + 4 组），段间隔明显小于列宽 */
function buildColumns(cols) {
  if (cols.length < 7) return [];
  const widths = [];
  for (let i = 1; i < cols.length; i++) widths.push(cols[i] - cols[i - 1]);
  const sortedW = [...widths].sort((a, b) => a - b);
  const med = sortedW[Math.floor(sortedW.length / 2)];
  const segs = [];
  let cur = [cols[0]];
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] < med * 0.35) {
      segs.push(cur);
      cur = [cols[i + 1]];
    } else {
      cur.push(cols[i + 1]);
    }
  }
  if (cur.length > 1) segs.push(cur);
  const info = [];
  segs.forEach((seg, si) => {
    if (seg.length < 2) return;
    const cls = CLASS_ORDER[si] || null;
    const n = seg.length - 1; // 该段有几列
    for (let k = 0; k < n; k++) {
      info.push({
        seg: si,
        col: k,
        x0: seg[k],
        x1: seg[k + 1],
        class: cls,
        group: k === 0 ? null : `${k}组`,
      });
    }
  });
  return info;
}

/* ---------- 名册纠错 ---------- */
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function bestName(text, students) {
  const t = String(text || '').replace(/\s+/g, '');
  if (!t || /^\d{1,3}$/.test(t)) return { name: '', how: 'empty' };
  const byName = new Map(students.map((s) => [s.name, s]));
  if (byName.has(t)) return { name: t, how: 'exact' };
  let best = null;
  for (const s of students) {
    if (Math.abs(s.name.length - t.length) > 1) continue;
    const d = lev(s.name, t);
    if (d <= 1 && (!best || d < best.d)) best = { name: s.name, d };
  }
  if (best) return { name: best.name, how: 'fuzzy' };
  return { name: '', how: 'unknown' };
}

/**
 * 主入口：imgEl 是 <img>（已加载），students 是名册。
 * 返回 { ok, lines: [{name, class, group, confidence, text}], stats }
 */
export async function recognizeTableImage(imgEl, students, onProgress) {
  const { gray, width, height, canvas } = toGray(imgEl);
  const { rows, cols } = findLines(gray, width, height);
  const rowsD = dedupe(rows, Math.max(6, Math.round(height / 200)));
  const colsD = dedupe(cols, Math.max(6, Math.round(width / 300)));
  if (rowsD.length < 4 || colsD.length < 7) {
    return { ok: false, error: `没找到表格线（横 ${rowsD.length} 竖 ${colsD.length}）。请确认截图带完整边框，或重新截图。` };
  }
  const colInfo = buildColumns(colsD);
  const nameCols = colInfo.filter((c) => c && c.group);
  if (!nameCols.length) {
    return { ok: false, error: '表格列结构和「序号 + 4 组」对不上，请确认是分班表' };
  }

  // 数据带：跳过前两行（班级标题 / 表头），从第三条横线开始
  const dataRows = [];
  for (let ri = 2; ri < rowsD.length - 1; ri++) {
    const y0 = rowsD[ri] + 2;
    const y1 = rowsD[ri + 1] - 2;
    if (y1 - y0 < 8) continue;
    dataRows.push({ ri, y0, y1 });
  }
  if (!dataRows.length) return { ok: false, error: '表格里没有数据行' };

  const worker = await getWorker(onProgress);
  const lines = [];
  let done = 0;
  const total = dataRows.length * nameCols.length;
  for (const row of dataRows) {
    for (const col of nameCols) {
      const crop = canvas.getContext('2d').getImageData(col.x0 + 2, row.y0, col.x1 - col.x0 - 4, row.y1 - row.y0);
      const c2 = document.createElement('canvas');
      const scale = Math.max(1, 64 / Math.max(1, crop.height));
      c2.width = Math.round(crop.width * scale);
      c2.height = Math.round(crop.height * scale);
      c2.getContext('2d').drawImage(canvas, col.x0 + 2, row.y0, col.x1 - col.x0 - 4, row.y1 - row.y0, 0, 0, c2.width, c2.height);
      const { data } = await worker.recognize(c2);
      const text = String(data.text || '').replace(/\s+/g, '');
      const hit = bestName(text, students);
      done++;
      if (onProgress) onProgress(done / total);
      if (hit.name) {
        lines.push({ name: hit.name, class: col.class, group: col.group, text, how: hit.how, conf: Math.round(data.confidence || 0) });
      }
    }
  }
  return {
    ok: true,
    lines,
    stats: {
      cells: total,
      recognized: lines.length,
      exact: lines.filter((l) => l.how === 'exact').length,
      fuzzy: lines.filter((l) => l.how === 'fuzzy').length,
    },
  };
}
