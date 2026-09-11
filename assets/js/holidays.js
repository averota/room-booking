// =====================================================================
// holidays.html — admin-only holiday CRUD + spreadsheet import
//
// The single-record Add/Edit/Delete flow (bootstrap modal + direct
// sb.from('holidays') calls) is unchanged from before.
//
// The bulk upload/preview flow below is ported from invitees.js: same
// header-alias mapping, required-field validation, in-file dedupe,
// editable preview grid, and separate Append vs Overwrite actions.
// Like invitees.js, Append/Overwrite/Clear go through SECURITY DEFINER
// RPC functions (admin_append_holidays, admin_overwrite_holidays,
// admin_clear_holidays — see schema.sql) so each bulk action runs as a
// single atomic transaction on the server, rather than separate
// client-side delete()/insert() calls that could fail halfway through.
// =====================================================================

let holidayModal;
let editingHolidayId = null;

// Schema definition: db column -> accepted header aliases (normalized)
const SCHEMA_FIELDS = {
    date:        ['date', 'holidaydate'],
    description: ['description', 'desc', 'title', 'name', 'holiday'],
    remark:      ['remark', 'remarks', 'note', 'notes']
};
const REQUIRED_FIELDS = ['date', 'description'];

// Human-friendly column headers for tables/exports.
const HEADER_LABELS = {
    date: 'Date',
    description: 'Description',
    remark: 'Remark'
};

function normalizeHeader(h) {
    return String(h).toLowerCase().replace(/[\s_\-]/g, '');
}

// Normalizes a raw cell value for the 'date' column into a 'yyyy-mm-dd'
// key. Handles JS Date objects (from XLSX read with cellDates:true —
// read using UTC getters, since that's how SheetJS anchors date-only
// cells, avoiding a local-timezone off-by-one) as well as plain
// strings (CSV files have no cell types, so dates arrive as text).
function normalizeDateCell(value) {
    if (value instanceof Date && !isNaN(value)) {
        const y = value.getUTCFullYear();
        const m = String(value.getUTCMonth() + 1).padStart(2, '0');
        const d = String(value.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const str = String(value ?? '').trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parsed = new Date(str);
    if (isNaN(parsed)) return null;
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function trashIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
        '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
}

function editIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
        '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
}

// Small edit-form modal for correcting an upload-preview row before
// it's committed. Built on .modal-overlay/.modal-box styles (see
// styles.css). Resolves to the edited row object, or null if cancelled.
function editRowDialog(row) {
    return new Promise((resolve) => {
        const fields = Object.keys(SCHEMA_FIELDS);
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-box">
                <h3>Edit holiday</h3>
                <div class="edit-form"></div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" data-action="cancel">Cancel</button>
                    <button type="button" class="btn btn-accent" data-action="save">Save</button>
                </div>
            </div>
        `;

        const form = overlay.querySelector('.edit-form');
        const inputs = {};
        fields.forEach(field => {
            const wrap = document.createElement('div');
            wrap.className = 'mb-2';

            const label = document.createElement('label');
            label.className = 'form-label small fw-semibold mb-1';
            label.textContent = HEADER_LABELS[field] || field;
            if (REQUIRED_FIELDS.includes(field)) {
                const req = document.createElement('span');
                req.className = 'req-text';
                req.textContent = ' *';
                label.appendChild(req);
            }

            const input = document.createElement('input');
            input.type = field === 'date' ? 'date' : 'text';
            input.className = 'form-control form-control-sm';
            input.value = row[field] ?? '';

            wrap.appendChild(label);
            wrap.appendChild(input);
            form.appendChild(wrap);
            inputs[field] = input;
        });

        document.body.appendChild(overlay);
        inputs[fields[0]].focus();

        function cleanup(result) {
            overlay.remove();
            resolve(result);
        }

        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });

        overlay.querySelector('[data-action="save"]').addEventListener('click', () => {
            const updated = {};
            fields.forEach(f => {
                const val = inputs[f].value.trim();
                updated[f] = val === '' ? null : val;
            });
            const missing = REQUIRED_FIELDS.filter(f => !updated[f]);
            if (missing.length > 0) {
                alert(`${missing.map(f => HEADER_LABELS[f] || f).join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`);
                return;
            }
            cleanup(updated);
        });
    });
}

// DOM refs
const toggleUploadBtn = document.getElementById('toggleUploadBtn');
const backToListBtn = document.getElementById('backToListBtn');
const uploadPanel = document.getElementById('uploadPanel');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const tableContainer = document.getElementById('tableContainer');
const errorContainer = document.getElementById('errorContainer');
const statusContainer = document.getElementById('statusContainer');
const summaryContainer = document.getElementById('summaryContainer');
const tableHeader = document.getElementById('tableHeader');
const tableBody = document.getElementById('tableBody');
const fileMeta = document.getElementById('fileMeta');
const clearBtn = document.getElementById('clearBtn');
const appendBtn = document.getElementById('appendBtn');
const overwriteBtn = document.getElementById('overwriteBtn');
const clearHolidaysBtn = document.getElementById('clearHolidaysBtn');

const refreshListBtn = document.getElementById('refreshListBtn');
const viewListContainer = document.getElementById('viewListContainer');
const dangerZone = document.getElementById('dangerZone');
const viewListMeta = document.getElementById('viewListMeta');
const viewListHeader = document.getElementById('viewListHeader');
const viewListBody = document.getElementById('viewListBody');

let currentViewList = [];
let currentDataset = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
    const me = await requireSession();
    if (!me) return;

    const isAdmin = me.profile.role === 'admin';

    if (!isAdmin) {
        document.getElementById('adminGate').style.display = 'block';
        document.querySelector('.room-meta-bar').style.display = 'none';
        document.querySelector('.upload-hint').style.display = 'none';
        viewListContainer.style.display = 'none';
        uploadPanel.style.display = 'none';
        dangerZone.style.display = 'none';
    }

    document.getElementById('userName').textContent = me.profile.full_name || me.email;
    document.getElementById('userAvatar').textContent = initials(me.profile.full_name || me.email);
    applyRoleVisibility(me.profile.role);
    wireLogout(document.getElementById('logoutBtn'));

    holidayModal = new bootstrap.Modal(document.getElementById('holidayModal'));

    document.getElementById('addHolidayBtn').addEventListener('click', () => openHolidayModal(null));
    document.getElementById('holidayForm').addEventListener('submit', onSubmitHoliday);

    // ---------------------------------------------------------------
    // Upload panel is secondary/collapsed by default — only the button
    // click opens it, and it auto-collapses again after a successful
    // append/overwrite so the page returns to showing the list. While
    // the panel is open, the holiday list is hidden so the upload flow
    // has the page's full attention; it reappears (refreshed) once the
    // panel closes.
    // ---------------------------------------------------------------
    refreshListBtn.addEventListener('click', () => { clearMessages(); loadHolidays(); });
    toggleUploadBtn.addEventListener('click', () => setUploadPanelOpen(uploadPanel.classList.contains('hidden')));
    backToListBtn.addEventListener('click', () => setUploadPanelOpen(false));
    fileInput.addEventListener('change', onFileSelected);
    clearBtn.addEventListener('click', resetUploadPreview);
    appendBtn.addEventListener('click', onAppendClick);
    overwriteBtn.addEventListener('click', onOverwriteClick);
    clearHolidaysBtn.addEventListener('click', onClearHolidaysClick);

    if (isAdmin) {
        await loadHolidays();
    }
}

function setUploadPanelOpen(open) {
    uploadPanel.classList.toggle('hidden', !open);
    viewListContainer.classList.toggle('hidden', open);
    dangerZone.classList.toggle('hidden', open);
    if (open) {
        // Always start from a clean, full-size dropzone when opening —
        // any leftover preview from a previous visit is discarded.
        resetUploadPreview();
    }
}

// ---------------------------------------------------------------------
// Main holiday list (loaded on page open, after Refresh, and after any
// append/overwrite/add/edit/delete/clear action)
// ---------------------------------------------------------------------
async function loadHolidays() {
    const { data, error } = await sb
        .from('holidays')
        .select('id, date, description, remark')
        .order('date', { ascending: true });

    if (error) {
        showError('Could not load holidays: ' + error.message);
        return;
    }

    renderTable(data || []);
}

/** Parses a 'yyyy-mm-dd' date-only string as a local Date (avoids UTC off-by-one). */
function parseDateOnly(dateStr) {
    const [y, mo, da] = dateStr.split('-').map(Number);
    return new Date(y, mo - 1, da);
}

function renderTable(holidays) {
    currentViewList = holidays;
    viewListMeta.textContent = `${holidays.length} record(s) in "holidays"`;

    const fields = ['date', 'description', 'remark'];
    let headerHtml = '<tr><th class="idx-col">#</th>';
    fields.forEach(f => { headerHtml += `<th>${HEADER_LABELS[f]}</th>`; });
    headerHtml += '<th class="actions-col">Action</th></tr>';
    viewListHeader.innerHTML = headerHtml;

    if (holidays.length === 0) {
        viewListBody.innerHTML = `<tr><td colspan="${fields.length + 2}"><div class="empty-state">No holidays yet — add one, or upload a spreadsheet.</div></td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    holidays.forEach((holiday, i) => {
        const tr = document.createElement('tr');

        const idxTd = document.createElement('td');
        idxTd.className = 'idx-col';
        idxTd.textContent = i + 1;
        tr.appendChild(idxTd);

        const dateTd = document.createElement('td');
        dateTd.innerHTML = `<strong>${escapeHtml(formatDateLong(parseDateOnly(holiday.date)))}</strong>`;
        tr.appendChild(dateTd);

        const descTd = document.createElement('td');
        descTd.textContent = holiday.description;
        tr.appendChild(descTd);

        const remarkTd = document.createElement('td');
        remarkTd.textContent = holiday.remark || '—';
        tr.appendChild(remarkTd);

        const actionTd = document.createElement('td');
        actionTd.className = 'actions-col';
        const wrap = document.createElement('div');
        wrap.className = 'actions-wrap';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn-icon-only';
        editBtn.title = 'Edit this holiday';
        editBtn.innerHTML = editIconSvg();
        editBtn.addEventListener('click', () => openHolidayModal(holiday));
        wrap.appendChild(editBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-icon-only';
        delBtn.title = 'Delete this holiday';
        delBtn.innerHTML = trashIconSvg();
        delBtn.addEventListener('click', () => onDeleteHoliday(holiday));
        wrap.appendChild(delBtn);

        actionTd.appendChild(wrap);
        tr.appendChild(actionTd);

        fragment.appendChild(tr);
    });
    viewListBody.replaceChildren(fragment);
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
        message: `Delete "${escapeHtml(holiday.description)}" on ${escapeHtml(formatDateLong(parseDateOnly(holiday.date)))}?`,
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
// CSV / Excel bulk upload + preview (ported from invitees.js)
// ---------------------------------------------------------------------
function onFileSelected(e) {
    const file = e.target.files[0];
    if (!file) return;

    resetUploadPreview();
    fileMeta.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });

            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

            if (jsonRows.length === 0) {
                showError('The uploaded file contains no data.');
                return;
            }

            processRows(jsonRows);
        } catch (err) {
            showError(`Failed to parse file: ${err.message}`);
        }
    };

    reader.onerror = () => showError('Error reading file from disk.');
    reader.readAsArrayBuffer(file);
}

// Map raw headers to schema fields, validate & de-duplicate
function processRows(jsonRows) {
    const rawHeaders = Object.keys(jsonRows[0]);

    const headerToField = {};
    const mappedFields = [];
    rawHeaders.forEach(rawHeader => {
        const norm = normalizeHeader(rawHeader);
        for (const [field, aliases] of Object.entries(SCHEMA_FIELDS)) {
            if (aliases.includes(norm) && !mappedFields.includes(field)) {
                headerToField[rawHeader] = field;
                mappedFields.push(field);
                break;
            }
        }
    });

    const missingRequired = REQUIRED_FIELDS.filter(f => !mappedFields.includes(f));
    if (missingRequired.length > 0) {
        showError(`The file is missing required column(s) for: ${missingRequired.map(f => HEADER_LABELS[f] || f).join(', ')}. Required columns are Date and Description.`);
        return;
    }

    const allSchemaFields = Object.keys(SCHEMA_FIELDS);
    const mappedRows = jsonRows.map(row => {
        const out = {};
        allSchemaFields.forEach(f => { out[f] = null; });
        for (const [rawHeader, field] of Object.entries(headerToField)) {
            const val = row[rawHeader];
            if (val === undefined || val === null || val === '') { out[field] = null; continue; }
            if (field === 'date') {
                out[field] = normalizeDateCell(val);
            } else {
                const str = String(val).trim();
                out[field] = str === '' ? null : str;
            }
        }
        return out;
    });

    const validRowsRaw = [];
    let invalidCount = 0;
    mappedRows.forEach(row => {
        const hasRequired = REQUIRED_FIELDS.every(f => row[f] !== null && row[f] !== '');
        if (hasRequired) validRowsRaw.push(row);
        else invalidCount++;
    });

    const seen = new Set();
    const validRows = [];
    let duplicateInFileCount = 0;
    validRowsRaw.forEach(row => {
        const key = row.date;
        if (seen.has(key)) {
            duplicateInFileCount++;
        } else {
            seen.add(key);
            validRows.push(row);
        }
    });

    currentDataset = { validRows, invalidCount, duplicateInFileCount, mappedFields, rawHeaders };

    renderSummary(currentDataset);
    renderPreviewTable();
    tableContainer.classList.remove('hidden');
    dropzone.classList.add('compact');
}

// Re-renders the upload preview table from the current in-memory
// currentDataset.validRows — called on initial parse, and again after
// every edit/delete so the row indices stay in sync.
function renderPreviewTable() {
    renderPreviewRows(
        tableHeader, tableBody, Object.keys(SCHEMA_FIELDS), currentDataset.validRows,
        1000, true,
        { onEdit: handleEditPreviewRow, onDelete: handleDeletePreviewRow }
    );
}

async function handleEditPreviewRow(row, index) {
    const updated = await editRowDialog(row);
    if (!updated) return;

    // Prevent two rows in the same preview ending up with the same
    // date after an edit — that's exactly the validation the initial
    // file parse already applied.
    const isDuplicate = currentDataset.validRows.some((r, i) => i !== index && r.date === updated.date);
    if (isDuplicate) {
        alert(`Date "${updated.date}" is already used by another row in this preview. Please use a unique date.`);
        return;
    }

    currentDataset.validRows[index] = updated;
    renderSummary(currentDataset);
    renderPreviewTable();
}

async function handleDeletePreviewRow(row, index) {
    const confirmed = await showConfirmDialog({
        title: 'Delete row',
        message: `Remove "${escapeHtml(row.description || row.date)}" from this preview? It won't be uploaded. This only affects the preview — nothing has been saved yet.`,
        confirmLabel: 'Delete',
        danger: true
    });
    if (!confirmed) return;

    currentDataset.validRows.splice(index, 1);
    renderSummary(currentDataset);
    renderPreviewTable();
}

// Rendering
function renderSummary(ds) {
    summaryContainer.classList.remove('hidden');
    const total = ds.validRows.length + ds.invalidCount + ds.duplicateInFileCount;
    summaryContainer.innerHTML = `
        <span class="stat-item">Rows in file <span class="stat-value">${total}</span></span>
        <span class="stat-item">Valid <span class="stat-value num-emerald">${ds.validRows.length}</span></span>
        <span class="stat-item">Skipped (missing required fields) <span class="stat-value num-rose">${ds.invalidCount}</span></span>
        <span class="stat-item">Duplicate in file <span class="stat-value num-amber">${ds.duplicateInFileCount}</span></span>
    `;
}

// Renders headerEl/bodyEl atomically via DocumentFragment so a refresh
// never shows a visibly empty table mid-update. `actions` is
// { onEdit, onDelete } — used for the upload preview only, since those
// rows aren't saved yet and can still be corrected before Append/Overwrite.
function renderPreviewRows(headerEl, bodyEl, fields, rows, cap = 1000, capNote = true, actions = null) {
    const hasActions = !!(actions && (actions.onEdit || actions.onDelete));
    const colCount = fields.length + 1 + (hasActions ? 1 : 0); // +1 for index, +1 for actions

    let headerHtml = '<tr><th class="idx-col">#</th>';
    fields.forEach(field => { headerHtml += `<th>${escapeHtml(HEADER_LABELS[field] || field)}</th>`; });
    if (hasActions) {
        headerHtml += `<th class="actions-col">Action</th>`;
    }
    headerHtml += '</tr>';
    headerEl.innerHTML = headerHtml;

    if (rows.length === 0) {
        bodyEl.innerHTML = `<tr><td colspan="${colCount}"><div class="empty-state">No records to display.</div></td></tr>`;
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.slice(0, cap).forEach((row, i) => {
        const tr = document.createElement('tr');

        const idxTd = document.createElement('td');
        idxTd.className = 'idx-col';
        idxTd.textContent = i + 1;
        tr.appendChild(idxTd);

        fields.forEach(field => {
            const td = document.createElement('td');
            td.textContent = row[field] !== null && row[field] !== undefined ? row[field] : '';
            tr.appendChild(td);
        });

        if (hasActions) {
            const actionTd = document.createElement('td');
            actionTd.className = 'actions-col';

            const wrap = document.createElement('div');
            wrap.className = 'actions-wrap';

            if (actions.onEdit) {
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'btn-icon-only';
                editBtn.title = 'Edit this row';
                editBtn.innerHTML = editIconSvg();
                editBtn.addEventListener('click', () => actions.onEdit(row, i));
                wrap.appendChild(editBtn);
            }

            if (actions.onDelete) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-icon-only';
                delBtn.title = 'Delete this row';
                delBtn.innerHTML = trashIconSvg();
                delBtn.addEventListener('click', () => actions.onDelete(row, i));
                wrap.appendChild(delBtn);
            }

            actionTd.appendChild(wrap);
            tr.appendChild(actionTd);
        }

        fragment.appendChild(tr);
    });

    if (capNote && rows.length > cap) {
        const noteTr = document.createElement('tr');
        const noteTd = document.createElement('td');
        noteTd.colSpan = colCount;
        noteTd.style.fontStyle = 'italic';
        noteTd.style.color = 'var(--ink-faint)';
        noteTd.textContent = `Preview capped at first ${cap} rows — all rows are still included in downloads/uploads.`;
        noteTr.appendChild(noteTd);
        fragment.appendChild(noteTr);
    }

    bodyEl.replaceChildren(fragment);
}

function showError(message) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden');
}

function showStatus(html) {
    statusContainer.innerHTML = html;
    statusContainer.classList.remove('hidden');
}

function clearMessages() {
    errorContainer.classList.add('hidden');
    statusContainer.classList.add('hidden');
}

function resetUploadPreview() {
    errorContainer.classList.add('hidden');
    summaryContainer.classList.add('hidden');
    tableContainer.classList.add('hidden');
    tableHeader.innerHTML = '';
    tableBody.innerHTML = '';
    currentDataset = null;
    dropzone.classList.remove('compact');
    fileInput.value = '';
}

async function fetchExistingHolidayDates() {
    const { data, error } = await sb.from('holidays').select('date');
    if (error) throw error;
    return new Set((data || []).map(r => r.date));
}

async function onAppendClick() {
    if (!currentDataset || currentDataset.validRows.length === 0) return;

    appendBtn.disabled = true;
    try {
        showStatus('Checking existing holidays…');
        const existingDates = await fetchExistingHolidayDates();
        const rowsToInsert = currentDataset.validRows.filter(r => !existingDates.has(r.date));
        const alreadyExistCount = currentDataset.validRows.length - rowsToInsert.length;

        if (rowsToInsert.length === 0) {
            showStatus(`<span class="num-amber">Nothing to append — all ${currentDataset.validRows.length} valid row(s) already exist in the table.</span>`);
            appendBtn.disabled = false;
            return;
        }

        const confirmed = await showConfirmDialog({
            title: 'Confirm append',
            message: `This will INSERT ${rowsToInsert.length} new holiday(s) into "holidays". ${alreadyExistCount} record(s) already exist (by date) and will be skipped. Existing data in the table will not be changed or removed.`,
            confirmLabel: `Append ${rowsToInsert.length} record(s)`
        });
        if (!confirmed) { appendBtn.disabled = false; showStatus('Append cancelled.'); return; }

        showStatus('Uploading…');
        const { data: insertedCount, error } = await sb.rpc('admin_append_holidays', { p_rows: rowsToInsert });
        if (error) throw error;

        resetUploadPreview();
        setUploadPanelOpen(false);
        await loadHolidays();
        showStatus(`<span class="num-emerald">Success — appended ${insertedCount} record(s). Skipped ${alreadyExistCount} existing record(s).</span>`);
    } catch (err) {
        showStatus(`<span class="num-rose">Append failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        appendBtn.disabled = false;
    }
}

async function onOverwriteClick() {
    if (!currentDataset || currentDataset.validRows.length === 0) return;

    overwriteBtn.disabled = true;
    try {
        const confirmed = await showConfirmDialog({
            title: 'Confirm overwrite',
            message: `This will PERMANENTLY DELETE ALL existing rows in "holidays" and replace them with ${currentDataset.validRows.length} record(s) from this file. This cannot be undone.`,
            confirmLabel: 'Overwrite table',
            danger: true
        });
        if (!confirmed) { overwriteBtn.disabled = false; showStatus('Overwrite cancelled.'); return; }

        showStatus('Overwriting table…');
        // admin_overwrite_holidays runs the delete + insert as a single
        // atomic transaction server-side, so this can't fail halfway
        // through and leave the table half-deleted or half-inserted.
        const { data: insertedCount, error } = await sb.rpc('admin_overwrite_holidays', { p_rows: currentDataset.validRows });
        if (error) throw error;

        resetUploadPreview();
        setUploadPanelOpen(false);
        await loadHolidays();
        showStatus(`<span class="num-emerald">Success — table overwritten with ${insertedCount} record(s).</span>`);
    } catch (err) {
        showStatus(`<span class="num-rose">Overwrite failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        overwriteBtn.disabled = false;
    }
}

async function onClearHolidaysClick() {
    const confirmed = await showConfirmDialog({
        title: 'Clear all holidays',
        message: 'This will PERMANENTLY DELETE every holiday record. This cannot be undone.',
        confirmLabel: 'Clear all holidays',
        danger: true
    });
    if (!confirmed) return;

    clearHolidaysBtn.disabled = true;
    try {
        showStatus('Clearing holidays…');
        const { error } = await sb.rpc('admin_clear_holidays');
        if (error) throw error;
        await loadHolidays();
        showStatus('<span class="num-emerald">All holiday records cleared.</span>');
    } catch (err) {
        showStatus(`<span class="num-rose">Clear failed: ${escapeHtml(err.message || String(err))}</span>`);
    } finally {
        clearHolidaysBtn.disabled = false;
    }
}
