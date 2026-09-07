/* Device-local work records. No company data is sent to a server. */
(function () {
  'use strict';
  const C = window.TrackerCore;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let data; let savedRaw; let selectedWeek = C.weekOf(C.today()); let view = 'week';
  let editingTask = null; let loggingTask = null; let editingLog = null;
  function notice(text, error = false) {
    $('notice').textContent = text; $('notice').hidden = false;
    $('notice').classList.toggle('error', error);
  }
  function fail(error) { notice(error.message || '処理できませんでした。元データは保持されています。', true); }
  function options(el, list, all) {
    el.replaceChildren();
    if (all) el.add(new Option(all, 'all'));
    list.forEach(item => el.add(new Option(item.label, item.value)));
  }
  function download(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function commit(change) {
    if (localStorage.getItem(C.KEY) !== savedRaw) throw new Error('別の画面でデータが更新されました。入力内容を控えて画面を開き直してください。今回の変更はまだ保存していません。');
    const next = JSON.parse(JSON.stringify(data)); change(next);
    C.save(localStorage, next); data = next; savedRaw = localStorage.getItem(C.KEY);
  }
  function filtered() {
    const category = $('categoryFilter').value; const status = $('statusFilter').value;
    const query = $('searchInput').value.trim().toLowerCase();
    return data.tasks.filter(t => (category === 'all' || t.category === category)
      && (status === 'all' || t.status === status)
      && (!query || [t.title, t.plan, t.next, t.subcategory, C.label(C.categories, t.category), ...t.activities.map(a => a.text)].join(' ').toLowerCase().includes(query)));
  }
  function matchesView(task) {
    if (view === 'week') return C.inWeek(task.date, selectedWeek) || task.activities.some(a => C.inWeek(a.date, selectedWeek));
    if (view === 'today') return task.status !== 'done' && (task.date === C.today() || ['follow', 'waiting'].includes(task.status) || (task.dueDate && task.dueDate <= C.today()));
    if (view === 'follow') return task.status === 'follow';
    if (view === 'waiting') return task.status === 'waiting';
    if (view === 'overdue') return C.overdue(task);
    return true;
  }
  function logMarkup(task, log) {
    return `<div class="log-entry"><div class="log-meta"><span>${esc(log.date || '旧実績・日付未確認')}</span><span>${log.minutes === null ? '時間未記録' : esc(log.minutes) + ' 分'}</span>
      <button class="btn-secondary" data-action="edit-log" data-id="${esc(task.id)}" data-log="${esc(log.id)}">${log.date ? '修正' : '日付を確認'}</button>
      <button class="btn-danger" data-action="delete-log" data-id="${esc(task.id)}" data-log="${esc(log.id)}" aria-label="この対応記録を削除">削除</button></div><div class="log-text">${esc(log.text)}</div></div>`;
  }
  function render() {
    $('weekDate').value = selectedWeek.start;
    $('weekLabel').textContent = `${selectedWeek.start.replaceAll('-', '/')} ～ ${selectedWeek.end.replaceAll('-', '/')}`;
    const scoped = filtered(); const summary = C.summary(scoped, selectedWeek);
    const cards = [
      ['選択週の対応記録', `${summary.records} 件`, `${summary.cases} 案件に対応`],
      ['選択週の作業時間', `${summary.minutes} 分`, summary.missingMinutes ? `${summary.missingMinutes} 件は時間未記録` : '入力された時間の合計'],
      ['現在の先方待ち', `${scoped.filter(t => t.status === 'waiting').length} 件`, '週に関係なく集計'],
      ['現在の期限超過', `${scoped.filter(t => C.overdue(t)).length} 件`, '次回対応日・期限を超過']
    ];
    $('stats').innerHTML = cards.map(([label, value, note]) => `<div class="stat-card"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-note">${esc(note)}</div></div>`).join('');
    const unknown = scoped.flatMap(t => t.activities).filter(a => !a.date).length;
    $('scopeNote').textContent = (view === 'week' ? '選択週に受付・対応した案件を表示。状態と次アクションは現在の内容です。' : '週の範囲に関係なく案件を表示。上の週次集計・週報出力には選択週が適用されます。')
      + ' 集計と出力には検索・分類・状態の絞り込みが適用されます。'
      + (unknown ? ` 日付未確認の旧実績 ${unknown} 件は週次集計に含みません。「全案件」から日付を確認できます。` : '');
    document.querySelectorAll('[data-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view);
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    const priorities = { p1: 0, p2: 1, p3: 2 };
    const tasks = scoped.filter(matchesView).sort((a, b) => Number(C.overdue(b)) - Number(C.overdue(a)) || priorities[a.priority] - priorities[b.priority] || b.date.localeCompare(a.date));
    $('taskList').innerHTML = tasks.length ? tasks.map(task => {
      const logs = task.activities.filter(log => view !== 'week' || C.inWeek(log.date, selectedWeek));
      const other = task.activities.filter(log => !logs.includes(log));
      const ordered = values => [...values].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return `<article class="task-card ${C.overdue(task) ? 'overdue' : ''}">
        <div class="task-top"><h2 class="task-title">${esc(task.title)}</h2><span class="task-date">受付 ${esc(task.date || '日付未確認')}</span></div>
        <div class="badges"><span class="badge category">${esc(C.label(C.categories, task.category))} / ${esc(task.subcategory)}</span><span class="badge ${esc(task.status)}">${esc(C.label(C.statuses, task.status))}</span><span class="badge priority">優先度 ${esc(C.label(C.priorities, task.priority))}</span>${C.overdue(task) ? '<span class="badge overdue">期限超過</span>' : ''}</div>
        <div class="task-body">${task.plan ? `<div><span class="field-label">予定・目的</span>${esc(task.plan)}</div>` : ''}
          <div><span class="field-label">次アクション</span>${esc(task.next || '未設定')}</div>${task.dueDate ? `<div><span class="field-label">次回対応日・期限</span>${esc(task.dueDate)}</div>` : ''}
          ${task.legacyCategory && task.subcategory === '要分類' ? `<div class="muted">旧分類：${esc(task.legacyCategory)}。案件編集で分類を確認してください。</div>` : ''}</div>
        <div class="task-actions"><button class="btn-primary" data-action="log" data-id="${esc(task.id)}">＋ 対応を記録</button><button class="btn-secondary" data-action="edit" data-id="${esc(task.id)}">案件を編集</button><button class="btn-secondary" data-action="done" data-id="${esc(task.id)}">${task.status === 'done' ? '対応中に戻す' : '完了にする'}</button><button class="btn-danger" data-action="delete" data-id="${esc(task.id)}">案件を削除</button></div>
        ${logs.length ? `<details open><summary>${view === 'week' ? '選択週の対応' : '対応履歴'} ${logs.length} 件</summary>${ordered(logs).map(log => logMarkup(task, log)).join('')}</details>` : '<p class="muted">この表示範囲には対応記録がありません。</p>'}
        ${other.length ? `<details><summary>その他の履歴・日付未確認 ${other.length} 件</summary>${ordered(other).map(log => logMarkup(task, log)).join('')}</details>` : ''}
      </article>`;
    }).join('') : '<div class="empty">表示条件に合う記録がありません。<br>「記録・案件を追加」から始めるか、「全案件」で確認できます。</div>';
  }
  function fillSubs(category, selected) {
    const found = C.categories.find(c => c.value === category);
    const subs = [...found.subs]; if (selected && !subs.includes(selected)) subs.push(selected);
    options($('taskSubcategory'), subs.map(value => ({ value, label: value })));
    $('taskSubcategory').value = selected || subs[0];
  }
  function openTask(id) {
    const task = data.tasks.find(t => t.id === id); editingTask = task?.id || null;
    $('taskForm').reset();
    $('modalTitle').textContent = task ? '案件を編集' : '記録・案件を追加';
    $('taskDate').value = task ? task.date : C.today();
    $('taskCategory').value = task?.category || ($('categoryFilter').value !== 'all' ? $('categoryFilter').value : 'general');
    fillSubs($('taskCategory').value, task?.subcategory);
    $('taskPriority').value = task?.priority || 'p2'; $('taskStatus').value = task?.status || 'todo';
    $('taskTitle').value = task?.title || ''; $('taskPlan').value = task?.plan || '';
    $('taskNext').value = task?.next || ''; $('taskDue').value = task?.dueDate || '';
    $('initialLogFields').hidden = !!task; $('initialLogDate').value = C.today();
    $('taskDialog').showModal();
  }
  function openLog(id, logId) {
    const task = data.tasks.find(t => t.id === id); if (!task) return;
    const log = task.activities.find(a => a.id === logId);
    loggingTask = id; editingLog = log?.id || null; $('logForm').reset();
    $('logTitle').textContent = log ? '対応記録を修正' : '対応を記録';
    $('logCase').textContent = task.title + (log && !log.date ? '｜実際に対応した日を確認して入力してください。' : '');
    $('logDate').value = log ? (log.date || '') : C.today(); $('logMinutes').value = log?.minutes ?? '';
    $('logText').value = log?.text || ''; $('logStatus').value = task.status;
    $('logDue').value = task.dueDate; $('logNext').value = task.next;
    $('logNextFields').hidden = !!log;
    $('logDialog').showModal();
  }
  function minutes(value) { return value === '' ? null : Number(value); }
  function downloadBackup() { download(C.backup(data), `work-tracker-backup-${C.today()}.json`, 'application/json'); }
  try {
    const result = C.load(localStorage); data = result.data; savedRaw = localStorage.getItem(C.KEY);
    if (result.migrated) notice('旧データを引き継ぎました。旧実績の日付は「全案件」から確認してください。旧版の保存データはそのまま残しています。');
  } catch (error) {
    $('workspace').hidden = true; $('recovery').hidden = false; fail(error);
    $('rawBackupBtn').addEventListener('click', () => {
      try { download(JSON.stringify({ current: localStorage.getItem(C.KEY), legacy: localStorage.getItem(C.LEGACY_KEY), beforeImport: localStorage.getItem(C.KEY + '_before_import') }, null, 2), `work-tracker-recovery-${C.today()}.json`, 'application/json'); }
      catch (e) { fail(e); }
    });
    return;
  }
  options($('categoryFilter'), C.categories, '全業務'); options($('statusFilter'), C.statuses, '全状態');
  options($('taskCategory'), C.categories); options($('taskStatus'), C.statuses);
  options($('taskPriority'), C.priorities); options($('logStatus'), C.statuses);
  $('taskCategory').addEventListener('change', () => fillSubs($('taskCategory').value));
  $('newTaskBtn').addEventListener('click', () => openTask());
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('taskForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const id = editingTask || C.uid();
      const record = { date: $('taskDate').value, category: $('taskCategory').value, subcategory: $('taskSubcategory').value,
        priority: $('taskPriority').value, status: $('taskStatus').value, title: $('taskTitle').value.trim(),
        plan: $('taskPlan').value.trim(), next: $('taskNext').value.trim(), dueDate: $('taskDue').value };
      const text = $('taskActual').value.trim();
      commit(next => {
        if (editingTask) {
          const index = next.tasks.findIndex(t => t.id === editingTask);
          next.tasks[index] = { ...next.tasks[index], ...record };
        } else next.tasks.push({ ...record, id, activities: text ? [{ id: C.uid(), date: $('initialLogDate').value, text, minutes: minutes($('initialMinutes').value) }] : [] });
      });
      $('taskDialog').close(); render(); notice('保存しました。表示されない場合は「全案件」から確認できます。');
    } catch (error) { fail(error); alert(error.message); }
  });
  $('logForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const log = { id: editingLog || C.uid(), date: $('logDate').value, text: $('logText').value.trim(), minutes: minutes($('logMinutes').value) };
      commit(next => {
        const task = next.tasks.find(t => t.id === loggingTask);
        if (editingLog) task.activities = task.activities.map(a => a.id === editingLog ? { ...a, ...log } : a);
        else {
          task.activities.push(log); task.status = $('logStatus').value;
          task.dueDate = $('logDue').value; task.next = $('logNext').value.trim();
        }
      });
      $('logDialog').close(); render(); notice('対応記録を保存しました。');
    } catch (error) { fail(error); alert(error.message); }
  });
  $('taskList').addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const { action, id, log } = button.dataset;
    if (action === 'edit') return openTask(id);
    if (action === 'log') return openLog(id);
    if (action === 'edit-log') return openLog(id, log);
    try {
      if (action === 'delete' && !confirm('この案件とすべての対応履歴を削除しますか？必要な記録は先にバックアップしてください。')) return;
      if (action === 'delete-log' && !confirm('この対応記録を削除しますか？')) return;
      commit(next => {
        if (action === 'delete') next.tasks = next.tasks.filter(t => t.id !== id);
        else {
          const task = next.tasks.find(t => t.id === id);
          if (action === 'done') task.status = task.status === 'done' ? 'doing' : 'done';
          if (action === 'delete-log') task.activities = task.activities.filter(a => a.id !== log);
        }
      }); render(); notice('変更を保存しました。');
    } catch (error) { fail(error); }
  });
  function setWeek(date) {
    try { selectedWeek = C.weekOf(date); view = 'week'; render(); }
    catch (error) { fail(error); }
  }
  $('prevWeek').addEventListener('click', () => setWeek(C.addDays(selectedWeek.start, -7)));
  $('nextWeek').addEventListener('click', () => setWeek(C.addDays(selectedWeek.start, 7)));
  $('thisWeek').addEventListener('click', () => setWeek(C.today()));
  $('weekDate').addEventListener('change', () => setWeek($('weekDate').value));
  $('searchInput').addEventListener('input', render);
  $('categoryFilter').addEventListener('change', render); $('statusFilter').addEventListener('change', render);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; render(); }));
  $('backupBtn').addEventListener('click', downloadBackup);
  $('weekCsvBtn').addEventListener('click', () => download(C.weeklyCsv(filtered(), selectedWeek), `work-week-${selectedWeek.start}.csv`, 'text/csv;charset=utf-8'));
  $('reportBtn').addEventListener('click', () => download(C.report(filtered(), selectedWeek), `weekly-notes-${selectedWeek.start}.md`, 'text/markdown;charset=utf-8'));
  $('downloadBtn').addEventListener('click', () => {
    const old = data.tasks.map(t => ({ date: t.date, category: C.label(C.categories, t.category), title: t.title, status: C.label(C.statuses, t.status), priority: C.label(C.priorities, t.priority), plan: t.plan,
      actual: t.activities.map(a => `${a.date || '日付未確認'}｜${a.text}${a.minutes === null ? '' : `（${a.minutes} 分）`}`).join('\n'), next: t.next }));
    const cell = value => '"' + (/^\s*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
    const rows = [['受付日', '分類', '案件', '現在の状態', '優先度', '予定', '対応履歴', '次アクション'], ...old.map(t => Object.values(t))];
    download('\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n'), `work-tracker-all-${C.today()}.csv`, 'text/csv;charset=utf-8');
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('20 MB 以下のファイルを選択してください。');
      const imported = C.parseImport(await file.text(), file.name);
      const merged = C.merge(data, imported);
      if (!merged.added) { notice(`追加する案件はありません。同一内容 ${merged.skipped} 件、同じ ID で内容が異なる案件 ${merged.conflicts} 件。既存データは変更していません。`); return; }
      if (!confirm(`${merged.added} 件を追加します。同一内容 ${merged.skipped} 件はスキップします。${merged.conflicts} 件は同じ ID で内容が異なるため取り込みません。現在の案件は上書きしません。続けますか？`)) return;
      commit(next => {
        localStorage.setItem(C.KEY + '_before_import', JSON.stringify(data));
        next.tasks = merged.data.tasks;
      });
      view = 'all'; render(); notice(`${merged.added} 件を取り込みました。同一内容 ${merged.skipped} 件、内容が異なる ${merged.conflicts} 件はスキップしました。旧実績は実際の対応日を確認してください。`);
    } catch (error) { fail(error); }
    finally { event.target.value = ''; }
  });
  window.addEventListener('storage', event => {
    if (event.key !== C.KEY) return;
    if ($('taskDialog').open || $('logDialog').open) { notice('別の画面で更新がありました。入力内容を控えてから、この画面を開き直してください。', true); return; }
    try { const loaded = C.load(localStorage); data = loaded.data; savedRaw = localStorage.getItem(C.KEY); render(); notice('別の画面で保存された内容を反映しました。'); }
    catch (error) { fail(error); }
  });
  render();
})();
