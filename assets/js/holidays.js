// =====================================================================
// holidays.html — admin-only holiday CRUD + spreadsheet import
// =====================================================================

let holidayModal;
let editingHolidayId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const me = await requireSession();
  if (!me) return;

  if (me.profile.role !== 'admin') {
    document.getElementById('adminGate').style.display = 'block';
    document.getElementById('holidayTableWrap').style.display = 'none';
    document.getElementById('addHolidayBtn').style.display = 'none';
    document.getElementById('uploadHolidayBtn').style.display = 'none';
    document.querySelector('.room-meta-bar').style.display = 'none';
    document.querySelector('.upload-hint').style.display = 'none';
  }

  document.getElementById('userName').textContent = me.profile.full_name || me.email;
  document.getElementById('userAvatar').textContent = initials(me.profile.full_name || me.email);
  applyRoleVisibility(me.profile.role);
  wireLogout(document.getElementById('logoutBtn'));

  holidayModal = new bootstrap.Modal(document.getElementById('holidayModal'));

  document.getElementById('addHolidayBtn').addEventListener('click', () => openHolidayModal(null));
  document.getElementById('holidayForm').addEventListener('submit', onSubmitHoliday);

  const fileInput = document.getElementById('holidayFileInput');
  document.getElementById('uploadHolidayBtn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', onFileSelected);

  if (me.profile.role === 'admin') {
    await loadHolidays();
  }
}

async function loadHolidays() {
  const { data, error } = await sb
    .from('holidays')
    .select('id, date, description, remark')
    .order('date', { ascending: true });

  if (error) {
    showToast('Could not load holidays: ' + error.message, 'danger');
    return;
  }

  renderTable(data || []);
}

function renderTable(holidays) {
  const body = document.getElementById('holidayTableBody');
  body.innerHTML = '';
  document.getElementById('holidaysEmptyState').style.display = holidays.length === 0 ? 'block' : 'none';

  holidays.forEach((holiday) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(formatDateLong(parseDateOnly(holiday.date)))}</strong></td>
      <td>${escapeHtml(holiday.description)}</td>
      <td>${escapeHtml(holiday.remark || '—')}</td>
      <td class="text-end"></td>
    `;
    const actionsCell = tr.querySelector('td.text-end');

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-outline-accent me-2';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openHolidayModal(holiday));
    actionsCell.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-outline-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => onDeleteHoliday(holiday));
    actionsCell.appendChild(deleteBtn);

    body.appendChild(tr);
  });
}

/** Parses a 'yyyy-mm-dd' date-only string as a local Date (avoids UTC off-by-one). */
function parseDateOnly(dateStr) {
  const [y, mo, da] = dateStr.split('-').map(Number);
  return new Date(y, mo - 1, da);
}

function openHolidayModal(holiday) {
  editingHolidayId = holiday ? holiday.id : null;
  document.getElementById('holidayModalTitle').textContent = holiday ? 'Edit holiday' : 'Add holiday';
  document.getElementById('holidayDateInput').value = holiday ? holiday.date : '';
  document.getElementById('holidayDescriptionInput').value = holiday ? holiday.description : '';
  document.getElementById('holidayRemarkInput').value = holiday ? holiday.remark || '' : '';
  holidayModal.show();
}

async function onSubmitHoliday(e) {
  e.preventDefault();

  const payload = {
    date: document.getElementById('holidayDateInput').value,
    description: document.getElementById('holidayDescriptionInput').value.trim(),
    remark: document.getElementById('holidayRemarkInput').value.trim()
  };

  if (!payload.date || !payload.description) {
    showToast('Please fill in the date and description.', 'danger');
    return;
  }

  const submitBtn = document.getElementById('holidaySubmitBtn');
  submitBtn.disabled = true;

  let error;
  if (editingHolidayId) {
    ({ error } = await sb.from('holidays').update(payload).eq('id', editingHolidayId));
  } else {
    ({ error } = await sb.from('holidays').upsert(payload, { onConflict: 'date' }));
  }

  submitBtn.disabled = false;

  if (error) {
    showToast('Could not save holiday: ' + error.message, 'danger');
    return;
  }

  showToast(editingHolidayId ? 'Holiday updated.' : 'Holiday added.', 'success');
  holidayModal.hide();
  await loadHolidays();
}

async function onDeleteHoliday(holiday) {
  const ok = await showConfirmDialog({
    title: 'Delete holiday',
    message: `Delete “${escapeHtml(holiday.description)}” on ${escapeHtml(formatDateLong(parseDateOnly(holiday.date)))}?`,
    confirmLabel: 'Delete holiday',
    danger: true
  });
  if (!ok) return;

  const { error } = await sb.from('holidays').delete().eq('id', holiday.id);
  if (error) {
    showToast('Could not delete holiday: ' + error.message, 'danger');
    return;
  }
  showToast('Holiday deleted.', 'success');
  await loadHolidays();
}

// ---------------------------------------------------------------------
// CSV / Excel bulk upload
// ---------------------------------------------------------------------
async function onFileSelected(e) {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file later
  if (!file) return;

  let rows;
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (err) {
    showToast('Could not read that file. Make sure it\'s a valid .csv or .xlsx.', 'danger');
    return;
  }

  if (!rows.length) {
    showToast('That file has no rows to import.', 'danger');
    return;
  }

  const valid = [];
  let skipped = 0;
  for (const row of rows) {
    const normalized = normalizeHolidayRow(row);
    if (normalized) valid.push(normalized);
    else skipped += 1;
  }

  if (valid.length === 0) {
    showToast('No usable rows found — check that the file has Date and Description columns.', 'danger');
    return;
  }

  const ok = await showConfirmDialog({
    title: 'Import holidays',
    message: `Found <strong>${valid.length}</strong> holiday${valid.length === 1 ? '' : 's'} to import` +
      (skipped ? `, and skipped ${skipped} row${skipped === 1 ? '' : 's'} with a missing date or description.` : '.') +
      ' Existing holidays on the same date will be updated rather than duplicated.',
    confirmLabel: `Import ${valid.length}`
  });
  if (!ok) return;

  const payload = valid.map((v) => ({ date: v.dateKey, description: v.description, remark: v.remark }));
  const { error } = await sb.from('holidays').upsert(payload, { onConflict: 'date' });

  if (error) {
    showToast('Could not import holidays: ' + error.message, 'danger');
    return;
  }

  showToast(`Imported ${valid.length} holiday${valid.length === 1 ? '' : 's'}.`, 'success');
  await loadHolidays();
}
