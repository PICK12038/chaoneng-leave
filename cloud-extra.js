/**
 * 云端版补充逻辑（无框架、无依赖）：
 *   1. 拦截「导出」里的 /api/export.* 链接，改成在浏览器里现场生成 xlsx / csv
 *   2. 云端不需要「在线心跳」，把相关定时器关掉，省流量
 * 依赖：config.js（window.SUPABASE_CONFIG / window.CLOUD_MODE）、cloud-api.js、xlsx.js、parser.js
 */
import { buildXlsx } from './xlsx.js';
import { timeTextOf } from './parser.js';

const CAT_LABEL = { early: '提前请假', sat: '周六', sun: '周日', other: '其他' };
const CHECK_LABEL = { '': '未核对', paper: '有实物', left: '已走' };

const HEAD = ['序号', '宿舍', '姓名', '班组', '请假时间', '原因', '假条状态', '核对', '备注', '录入人'];
const WIDTHS = [6, 10, 12, 12, 36, 22, 10, 16, 20, 10];

function slipText(r) {
  const s = r.slip || {};
  if (s.sent) return '已发';
  if (s.written) return '已写';
  return '未写';
}

function rowOf(r, i) {
  return [
    i + 1,
    r.dorm || '',
    r.name || '',
    r.group || '',
    timeTextOf(r) || r.timeRaw || '',
    r.reason || r.note || '',
    slipText(r),
    CHECK_LABEL[r.check || ''] || '未核对',
    r.note || '',
    r.by || '',
  ];
}

async function weekRows(weekId) {
  const data = await window.CloudAPI.weekData(weekId);
  const recs = (data.week.records || []).slice().sort((a, b) => {
    const k = (r) => r.startAt + '|' + r.name;
    return k(a) < k(b) ? -1 : 1;
  });
  return { week: data.week, recs };
}

function sheetsFor(recs) {
  const groups = [
    ['汇总', recs],
    ['提前请假', recs.filter((r) => r.category === 'early')],
    ['周六', recs.filter((r) => r.category === 'sat')],
    ['周日', recs.filter((r) => r.category === 'sun')],
  ];
  return groups.map(([name, list]) => ({
    name,
    widths: WIDTHS,
    rows: [HEAD, ...list.map(rowOf)],
  }));
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

async function exportXlsx(weekId) {
  const { week, recs } = await weekRows(weekId);
  const bytes = buildXlsx(sheetsFor(recs));
  download(
    new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `超能班请假_${week.saturday}.xlsx`
  );
}

async function exportCsv(weekId) {
  const { week, recs } = await weekRows(weekId);
  const lines = [HEAD, ...recs.map(rowOf)].map((cols) =>
    cols
      .map((v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      })
      .join(',')
  );
  download(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `超能班请假_${week.saturday}.csv`);
}

/* 拦住导出链接 */
document.addEventListener(
  'click',
  (e) => {
    const a = e.target.closest('a[href^="/api/export"]');
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const href = a.getAttribute('href') || '';
    const weekId = (href.match(/week=([^&]+)/) || [])[1] || '';
    const job = href.includes('.csv') ? exportCsv(weekId) : exportXlsx(weekId);
    job.catch((err) => {
      console.error(err);
      alert('导出失败：' + (err && err.message ? err.message : err));
    });
  },
  true
);

window.CLOUD_MODE = true;
window.__cloudExport = { exportXlsx, exportCsv };
