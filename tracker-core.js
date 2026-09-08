(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrackerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'work_tracker_v3';
  const LEGACY_KEY = 'work_tracker_full_v2';
  const categories = [
    { value: 'visa', label: 'ビザ関連', subs: ['新規申請', '更新', '変更', '資料確認', 'その他'] },
    { value: 'certificate', label: '証明書関連', subs: ['在職証明書', '収入証明書', '業務内容証明書', 'その他'] },
    { value: 'travel', label: '出張者関連', subs: ['来日前準備', '宿泊手配', '滞在中対応', '終了後対応', 'その他'] },
    { value: 'general', label: '本社施設・総務関連', subs: ['施設・設備', '入館カード', '管理会社対応', '防災', '寮・社宅', 'その他', '要分類'] },
    { value: 'rakumon', label: 'Rakumon関連', subs: ['CS', '企業・ToB', '財務・報酬', '運営', '採用', 'データ・会議', 'SNS・改善', 'その他'] }
  ];
  const statuses = [
    { value: 'todo', label: '未着手' }, { value: 'doing', label: '対応中' },
    { value: 'waiting', label: '先方待ち' }, { value: 'follow', label: '要フォロー' },
    { value: 'done', label: '完了' }
  ];
  const priorities = [{ value: 'p1', label: '高' }, { value: 'p2', label: '中' }, { value: 'p3', label: '低' }];
  const str = value => String(value == null ? '' : value);
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number(value.slice(0, 4)) >= 1000 && !Number.isNaN(Date.parse(value))
      && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  }
  function today(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = type => parts.find(p => p.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function addDays(date, amount) {
    if (!validDate(date)) throw new Error('日付を確認してください。');
    const value = new Date(date + 'T12:00:00Z');
    value.setUTCDate(value.getUTCDate() + amount);
    return value.toISOString().slice(0, 10);
  }
  function weekOf(date) {
    const day = new Date(date + 'T12:00:00Z').getUTCDay();
    const start = addDays(date, -((day + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  function inWeek(date, week) { return validDate(date) && date >= week.start && date <= week.end; }
  function label(options, value) { return options.find(item => item.value === value)?.label || str(value); }
  function uid() {
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function empty() { return { version: 3, tasks: [] }; }
  function mapCategory(value) {
    const mapping = {
      rakumon_cs: ['rakumon', 'CS'], cs: ['rakumon', 'CS'],
      rakumon_company: ['rakumon', '企業・ToB'], school: ['rakumon', '企業・ToB'],
      rakumon_finance: ['rakumon', '財務・報酬'], rakumon_operation: ['rakumon', '運営'],
      rgs_admin: ['general', '要分類'],
      'Rakumon・CS': ['rakumon', 'CS'], 'Rakumon・企業': ['rakumon', '企業・ToB'],
      'Rakumon・財務': ['rakumon', '財務・報酬'], 'Rakumon・運営': ['rakumon', '運営'],
      'RGS・総務': ['general', '要分類']
    };
    if (mapping[value]) return mapping[value];
    const found = categories.find(c => c.value === value || c.label === value);
    return found ? [found.value, 'その他'] : ['general', '要分類'];
  }
  function oldEnum(options, value, fallback) {
    return options.find(o => o.value === value || o.label === str(value).split(' / ')[0])?.value || fallback;
  }
  function migrateLegacy(rows) {
    if (!Array.isArray(rows)) throw new Error('旧データの形式を確認できません。');
    const used = new Set();
    const tasks = rows.map((old, index) => {
      if (!old || typeof old !== 'object' || Array.isArray(old) || typeof old.title !== 'string' || !old.title.trim()) {
        throw new Error(`旧データの ${index + 1} 件目にタイトルがありません。元データは変更していません。`);
      }
      const [category, subcategory] = mapCategory(old.category);
      let id = `legacy-${str(old.id || index + 1)}`;
      if (used.has(id)) id += `-${index}`;
      used.add(id);
      const candidate = str(old.next).match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
      const dueDate = validDate(candidate) ? candidate : '';
      return {
        id, date: validDate(old.date) ? old.date : '', category, subcategory,
        title: old.title, status: oldEnum(statuses, old.status, 'todo'),
        priority: oldEnum(priorities, old.priority, 'p2'), plan: str(old.plan), next: str(old.next),
        dueDate, legacyCategory: str(old.category), legacyDate: str(old.date),
        activities: str(old.actual).trim() ? [{ id: `${id}-actual`, date: null, text: str(old.actual), minutes: null, legacy: true }] : []
      };
    });
    return validate({ version: 3, tasks });
  }
  function validate(input) {
    if (!input || input.version !== 3 || !Array.isArray(input.tasks)) throw new Error('対応するバックアップ形式ではありません。');
    const ids = new Set();
    for (const task of input.tasks) {
      if (!task || typeof task.id !== 'string' || !task.id || ids.has(task.id)) throw new Error('案件 ID が不正、または重複しています。');
      ids.add(task.id);
      if (typeof task.title !== 'string' || !task.title.trim()) throw new Error('タイトルが空の案件があります。');
      if (!categories.some(c => c.value === task.category) || !statuses.some(s => s.value === task.status)
        || !priorities.some(p => p.value === task.priority)) throw new Error('分類・状態・優先度を確認してください。');
      for (const key of ['subcategory', 'plan', 'next', 'date', 'dueDate']) {
        if (typeof task[key] !== 'string') throw new Error(`案件の ${key} が不正です。`);
      }
      for (const key of ['date', 'dueDate']) if (task[key] && !validDate(task[key])) throw new Error('案件の日付が不正です。');
      if (!Array.isArray(task.activities)) throw new Error('対応履歴が不正です。');
      const logIds = new Set();
      for (const log of task.activities) {
        if (!log || typeof log.id !== 'string' || !log.id || logIds.has(log.id)) throw new Error('対応記録 ID が不正です。');
        logIds.add(log.id);
        if (typeof log.text !== 'string' || !log.text.trim()) throw new Error('空の対応記録があります。');
        if (!(log.date === null && log.legacy === true) && !validDate(log.date)) throw new Error('対応日が不正です。');
        if (log.minutes !== null && (!Number.isInteger(log.minutes) || log.minutes < 0 || log.minutes > 1440)) throw new Error('作業時間は 0〜1440 分で入力してください。');
      }
    }
    return JSON.parse(JSON.stringify(input));
  }
  function load(storage) {
    const saved = storage.getItem(KEY);
    if (saved !== null) return { data: validate(JSON.parse(saved)), migrated: false };
    const old = storage.getItem(LEGACY_KEY);
    if (old === null) return { data: empty(), migrated: false };
    const data = migrateLegacy(JSON.parse(old));
    storage.setItem(KEY, JSON.stringify(data));
    return { data, migrated: true };
  }
  function save(storage, data) { storage.setItem(KEY, JSON.stringify(validate(data))); }
  function overdue(task, date = today()) { return task.status !== 'done' && validDate(task.dueDate) && task.dueDate < date; }
  function weeklyLogs(tasks, week) {
    return tasks.flatMap(task => task.activities.filter(log => inWeek(log.date, week)).map(log => ({ task, log })))
      .sort((a, b) => a.log.date.localeCompare(b.log.date));
  }
  function summary(tasks, week) {
    const logs = weeklyLogs(tasks, week);
    return { records: logs.length, cases: new Set(logs.map(l => l.task.id)).size,
      minutes: logs.reduce((sum, entry) => sum + (entry.log.minutes ?? 0), 0),
      missingMinutes: logs.filter(entry => entry.log.minutes === null).length };
  }
  function backup(data) { return JSON.stringify({ ...validate(data), exportedAt: new Date().toISOString() }, null, 2); }
  function parseCsv(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = []; let row = []; let cell = ''; let quoted = false; let afterQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; afterQuote = true; }
        else cell += c;
      } else if (c === ',' || c === '\n' || c === '\r') {
        row.push(cell); cell = ''; afterQuote = false;
        if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
      } else if (c === '"' && !cell && !afterQuote) quoted = true;
      else { if (afterQuote || c === '"') throw new Error('CSV の引用符が不正です。'); cell += c; }
    }
    if (quoted) throw new Error('CSV の引用符が閉じられていません。');
    if (cell || row.length || afterQuote) { row.push(cell); rows.push(row); }
    return rows;
  }
  function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
  function parseImport(text, name) {
    if (/\.csv$/i.test(name)) {
      const [headers, ...rows] = parseCsv(text);
      const expected = ['日付 / Date', '分類 / Category', 'タイトル / Title', '状態 / Status', '優先度 / Priority', '予定 / Plan', '実績 / Actual', '次アクション / Next'];
      if (!headers || expected.some((h, i) => headers[i] !== h) || headers.length !== 8) throw new Error('旧 Work Tracker の全件 CSV、または JSON バックアップを選んでください。');
      const nonempty = rows.filter(row => row.some(Boolean));
      const counts = new Map();
      const old = nonempty.map(row => {
        if (row.length !== 8) throw new Error('CSV の列数が一致しません。');
        const key = hash(JSON.stringify(row)); const count = counts.get(key) || 0; counts.set(key, count + 1);
        return { id: `csv-${key}-${count}`, date: row[0], category: row[1], title: row[2], status: row[3], priority: row[4], plan: row[5], actual: row[6], next: row[7] };
      });
      return migrateLegacy(old);
    }
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    return Array.isArray(value) ? migrateLegacy(value) : validate(value);
  }
  function fingerprint(task) {
    return JSON.stringify([task.date, task.category, task.subcategory, task.title, task.status, task.priority, task.plan, task.next, task.dueDate,
      task.activities.map(log => [log.date, log.text, log.minutes, !!log.legacy])]);
  }
  function merge(current, imported) {
    const data = validate(current); validate(imported);
    const byId = new Map(data.tasks.map(t => [t.id, t]));
    const remaining = new Map(data.tasks.map(t => [t.id, fingerprint(t)]));
    let added = 0; let skipped = 0; let conflicts = 0;
    for (const task of imported.tasks) {
      if (byId.has(task.id)) {
        if (fingerprint(byId.get(task.id)) === fingerprint(task)) skipped++;
        else conflicts++;
        remaining.delete(task.id);
      } else {
        // Old CSV has no IDs. Match existing records one-for-one without
        // collapsing distinct, identical rows from the same imported file.
        const match = task.id.startsWith('legacy-csv-')
          ? [...remaining].find(([, signature]) => signature === fingerprint(task)) : null;
        if (match) { skipped++; remaining.delete(match[0]); }
        else { data.tasks.push(task); byId.set(task.id, task); added++; }
      }
    }
    return { data, added, skipped, conflicts };
  }
  function csvCell(value) {
    let text = str(value);
    if (/^\s*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }
  function csv(rows) { return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'); }
  function weeklyCsv(tasks, week) {
    return csv([['対応日', '分類', '詳細分類', '案件', '実績', '作業時間（分）', '現在の状態', '次アクション', '次回対応日'],
      ...weeklyLogs(tasks, week).map(({ task, log }) => [log.date, label(categories, task.category), task.subcategory, task.title, log.text, log.minutes ?? '', label(statuses, task.status), task.next, task.dueDate])]);
  }
  function report(tasks, week) {
    const lines = [`# 業務週報メモ｜${week.start} ～ ${week.end}`, '', '対応日は日本時間。日付未確認の旧実績は集計対象外です。', ''];
    for (const category of categories) {
      const entries = weeklyLogs(tasks.filter(t => t.category === category.value), week);
      lines.push(`## ${category.label}`, '');
      if (!entries.length) lines.push('記録なし', '');
      for (const { task, log } of entries) {
        lines.push(`- ${log.date}｜${task.title}${log.minutes === null ? '' : `（${log.minutes} 分）`}`,
          ...log.text.split('\n').map(line => `  ${line}`), '');
      }
    }
    const open = tasks.filter(t => t.status !== 'done');
    lines.push('## 現在の継続案件', '', '以下は出力時点の状態です。', '');
    if (!open.length) lines.push('なし');
    for (const task of open) lines.push(`- ${task.title}｜${label(statuses, task.status)}${task.dueDate ? `｜次回 ${task.dueDate}` : ''}`, `  ${task.next || '次アクション未設定'}`);
    return lines.join('\n');
  }
  return { KEY, LEGACY_KEY, categories, statuses, priorities, validDate, today, addDays, weekOf, inWeek, label, uid, empty,
    migrateLegacy, validate, load, save, overdue, weeklyLogs, summary, backup, parseCsv, parseImport, merge, weeklyCsv, report };
});
