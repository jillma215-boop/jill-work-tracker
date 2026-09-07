const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../tracker-core.js');

function memory(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: key => map.has(key) ? map.get(key) : null, setItem: (key, value) => map.set(key, value) };
}
function legacy(overrides = {}) {
  return { id: 101, date: '2026-09-01', category: 'rakumon_company', title: '法人利用確認', status: 'waiting', priority: 'p1',
    plan: '状況を確認', actual: 'メールを送付\n資料の返信待ち', next: '2026-09-14 再確認', ...overrides };
}
function task(overrides = {}) {
  return { id: 'case-a', date: '2026-09-01', category: 'visa', subcategory: '更新', title: '更新資料確認', status: 'doing', priority: 'p2',
    plan: '', next: '', dueDate: '', activities: [], ...overrides };
}
function log(id, date, minutes = null) { return { id, date, text: '資料を確認', minutes }; }
const headers = ['日付 / Date', '分類 / Category', 'タイトル / Title', '状態 / Status', '優先度 / Priority', '予定 / Plan', '実績 / Actual', '次アクション / Next'];
function oldCsv(rows) {
  const values = rows.map(r => [r.date, r.category, r.title, r.status, r.priority, r.plan, r.actual, r.next]);
  return '\uFEFF' + [headers, ...values].map(row => row.map(s => '"' + s.replaceAll('"', '""') + '"').join(',')).join('\r\n');
}

test('empty installations contain no embedded customer examples', () => {
  assert.deepEqual(C.load(memory()), { data: { version: 3, tasks: [] }, migrated: false });
});

test('legacy migration preserves original bytes, notes, IDs and category meaning', () => {
  const raw = JSON.stringify([legacy(), legacy({ id: 102, category: 'rgs_admin' }), legacy({ id: 103, category: 'unknown-old' })]);
  const storage = memory({ [C.LEGACY_KEY]: raw });
  const first = C.load(storage);
  assert.equal(storage.getItem(C.LEGACY_KEY), raw);
  assert.equal(first.data.tasks[0].next, '2026-09-14 再確認');
  assert.equal(first.data.tasks[0].dueDate, '2026-09-14');
  assert.equal(first.data.tasks[0].subcategory, '企業・ToB');
  assert.equal(first.data.tasks[1].subcategory, '要分類');
  assert.equal(first.data.tasks[2].legacyCategory, 'unknown-old');
  assert.equal(first.data.tasks[0].activities[0].text, legacy().actual);
  assert.equal(first.data.tasks[0].activities[0].date, null);
  assert.equal(C.summary(first.data.tasks, C.weekOf('2026-09-01')).records, 0);
  assert.equal(C.load(storage).migrated, false);
  assert.deepEqual(C.load(storage).data, first.data);
});

test('old short category IDs still map to their known business', () => {
  const result = C.migrateLegacy([legacy({ category: 'school' }), legacy({ id: 2, category: 'cs' })]);
  assert.equal(result.tasks[0].subcategory, '企業・ToB');
  assert.equal(result.tasks[1].subcategory, 'CS');
});

test('corrupt storage never falls back to empty data or overwrites source', () => {
  for (const key of [C.KEY, C.LEGACY_KEY]) {
    const storage = memory({ [key]: '{broken' });
    assert.throws(() => C.load(storage));
    assert.equal(storage.getItem(key), '{broken');
  }
  const storage = memory({ [C.LEGACY_KEY]: '[{"title":null}]' });
  assert.throws(() => C.load(storage)); assert.equal(storage.getItem(C.KEY), null);
});

test('failed writes do not destroy a valid saved snapshot', () => {
  const storage = memory(); C.save(storage, { version: 3, tasks: [task()] });
  const original = storage.getItem(C.KEY);
  assert.throws(() => C.save(storage, { version: 3, tasks: [task({ title: '' })] }));
  assert.equal(storage.getItem(C.KEY), original);
  storage.setItem = () => { throw new Error('quota exceeded'); };
  assert.throws(() => C.save(storage, C.empty()), /quota/);
  assert.equal(storage.getItem(C.KEY), original);
});

test('Japanese calendar dates and Monday weeks work at timezone and year boundaries', () => {
  assert.equal(C.today(new Date('2026-09-06T15:05:00Z')), '2026-09-07');
  assert.deepEqual(C.weekOf('2027-01-01'), { start: '2026-12-28', end: '2027-01-03' });
  assert.deepEqual(C.weekOf('2026-09-13'), { start: '2026-09-07', end: '2026-09-13' });
  assert.equal(C.validDate('2026-02-30'), false);
  assert.equal(C.validDate('2028-02-29'), true);
  assert.throws(() => C.weekOf(''));
});

test('cross-week history counts actual activities once and distinguishes missing time from zero', () => {
  const t = task({ activities: [log('a', '2026-09-06', 10), log('b', '2026-09-07', 20), log('c', '2026-09-13'), log('d', '2026-09-14', 15), log('e', '2026-09-08', 0)] });
  assert.deepEqual(C.summary([t], C.weekOf('2026-09-07')), { records: 3, cases: 1, minutes: 20, missingMinutes: 1 });
  assert.equal(C.summary([t], C.weekOf('2026-09-14')).minutes, 15);
});

test('explicit deadline determines overdue; follow-up without a deadline is not overdue', () => {
  assert.equal(C.overdue(task({ status: 'follow' }), '2026-09-07'), false);
  assert.equal(C.overdue(task({ dueDate: '2026-09-07' }), '2026-09-07'), false);
  assert.equal(C.overdue(task({ dueDate: '2026-09-06' }), '2026-09-07'), true);
  assert.equal(C.overdue(task({ dueDate: '2026-09-06', status: 'done' }), '2026-09-07'), false);
});

test('JSON backup round trip keeps every history entry and known legacy fields', () => {
  const source = { version: 3, tasks: [task({ legacyCategory: 'old', activities: [log('a', '2026-09-07', 5), log('b', '2026-09-14')] })] };
  const imported = C.parseImport(C.backup(source), 'backup.json');
  assert.deepEqual(imported.tasks, source.tasks);
  assert.deepEqual(C.merge(C.empty(), imported).data.tasks, source.tasks);
  assert.equal(C.merge(source, imported).added, 0);
});

test('conflicting IDs never overwrite local tasks or merge incompatible history', () => {
  const current = { version: 3, tasks: [task({ activities: [log('a', '2026-09-07')] })] };
  const imported = { version: 3, tasks: [task({ activities: [log('b', '2026-09-08')] }), task({ id: 'new' })] };
  const result = C.merge(current, imported);
  assert.equal(result.conflicts, 1); assert.equal(result.added, 1);
  assert.equal(result.data.tasks[0].activities[0].id, 'a');
  assert.equal(current.tasks.length, 1);
});

test('old CSV handles BOM, commas, multiline fields and escaped quotes; repeated import is safe', () => {
  const rows = [legacy({ actual: '一行目, カンマ\n"引用"を含む二行目', category: 'Rakumon・企業' })];
  const imported = C.parseImport(oldCsv(rows), 'export.csv');
  assert.equal(imported.tasks[0].activities[0].text, rows[0].actual);
  assert.equal(C.merge(imported, C.parseImport(oldCsv(rows), 'export.csv')).added, 0);
  const migrated = C.migrateLegacy(rows);
  assert.equal(C.merge(migrated, imported).added, 0);
});

test('distinct identical CSV rows and JSON tasks are not collapsed', () => {
  const imported = C.parseImport(oldCsv([legacy(), legacy()]), 'export.csv');
  assert.equal(C.merge(C.empty(), imported).added, 2);
  assert.equal(C.merge(imported, imported).added, 0);
  assert.equal(C.merge({ version: 3, tasks: [task()] }, { version: 3, tasks: [task({ id: 'other' })] }).added, 1);
});

test('invalid import dates, duplicate IDs, broken CSV and invalid durations are rejected', () => {
  assert.throws(() => C.parseImport('not,json\n1,2', 'file.csv'));
  assert.throws(() => C.parseCsv('"unclosed'));
  assert.throws(() => C.validate({ version: 3, tasks: [task(), task()] }));
  assert.throws(() => C.validate({ version: 3, tasks: [task({ activities: [log('a', '2026-02-30')] })] }));
  assert.throws(() => C.validate({ version: 3, tasks: [task({ activities: [log('a', '2026-09-07', -1)] })] }));
});

test('weekly CSV neutralizes spreadsheet formulas and exports only selected-week logs', () => {
  const t = task({ title: '=1+1', activities: [{ ...log('a', '2026-09-07', 20), text: '@SUM(1,2)' }, log('b', '2026-09-14')] });
  const parsed = C.parseCsv(C.weeklyCsv([t], C.weekOf('2026-09-07')));
  assert.equal(parsed.length, 2); assert.equal(parsed[1][3], "'=1+1"); assert.equal(parsed[1][4], "'@SUM(1,2)");
});

test('weekly memo excludes undated history and labels follow-up as current state', () => {
  const t = task({ activities: [log('a', '2026-09-07'), { id: 'old', date: null, text: '旧履歴のテスト本文', minutes: null, legacy: true }] });
  const report = C.report([t], C.weekOf('2026-09-07'));
  assert.ok(report.includes('2026-09-07｜更新資料確認'));
  assert.ok(!report.includes('旧履歴のテスト本文'));
  assert.ok(report.includes('出力時点の状態'));
});
