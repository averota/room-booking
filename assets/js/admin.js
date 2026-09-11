// =====================================================================
// rooms.html — admin-only room CRUD
// =====================================================================

let roomModal;
let editingRoomId = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const me = await requireSession();
  if (!me) return;

  if (me.profile.role !== 'admin') {
    document.getElementById('adminGate').style.display = 'block';
    document.getElementById('roomTableWrap').style.display = 'none';
    document.getElementById('addRoomBtn').style.display = 'none';
    document.querySelector('.room-meta-bar').style.display = 'none';
  }

  document.getElementById('userName').textContent = me.profile.full_name || me.email;
  document.getElementById('userAvatar').textContent = initials(me.profile.full_name || me.email);
  applyRoleVisibility(me.profile.role);
  wireLogout(document.getElementById('logoutBtn'));

  roomModal = new bootstrap.Modal(document.getElementById('roomModal'));

  document.getElementById('addRoomBtn').addEventListener('click', () => openRoomModal(null));
  document.getElementById('roomForm').addEventListener('submit', onSubmitRoom);

  if (me.profile.role === 'admin') {
    await loadRooms();
  }
}

async function loadRooms() {
  const { data, error } = await sb
    .from('rooms')
    .select('id, name, location, capacity, description, is_active')
    .order('name', { ascending: true });

  if (error) {
    showToast('Could not load rooms: ' + error.message, 'danger');
    return;
  }

  renderTable(data || []);
}

function renderTable(rooms) {
  const body = document.getElementById('roomTableBody');
  body.innerHTML = '';
  document.getElementById('roomsEmptyState').style.display = rooms.length === 0 ? 'block' : 'none';

  rooms.forEach((room) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(room.name)}</strong>${room.description ? `<div style="color:var(--ink-faint); font-size:0.8rem;">${escapeHtml(room.description)}</div>` : ''}</td>
      <td>${escapeHtml(room.location || '—')}</td>
      <td>${room.capacity}</td>
      <td><span class="status-dot ${room.is_active ? 'active' : 'inactive'}"></span>${room.is_active ? 'Active' : 'Hidden'}</td>
      <td class="text-end"></td>
    `;
    const actionsCell = tr.querySelector('td.text-end');

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-outline-accent me-2';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openRoomModal(room));
    actionsCell.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-outline-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => onDeleteRoom(room));
    actionsCell.appendChild(deleteBtn);

    body.appendChild(tr);
  });
}

function openRoomModal(room) {
  editingRoomId = room ? room.id : null;
  document.getElementById('roomModalTitle').textContent = room ? 'Edit room' : 'Add room';
  document.getElementById('roomNameInput').value = room ? room.name : '';
  document.getElementById('roomLocationInput').value = room ? room.location : '';
  document.getElementById('roomCapacityInput').value = room ? room.capacity : 4;
  document.getElementById('roomDescriptionInput').value = room ? room.description : '';
  document.getElementById('roomActiveInput').checked = room ? room.is_active : true;
  roomModal.show();
}

async function onSubmitRoom(e) {
  e.preventDefault();

  const payload = {
    name: document.getElementById('roomNameInput').value.trim(),
    location: document.getElementById('roomLocationInput').value.trim(),
    capacity: parseInt(document.getElementById('roomCapacityInput').value, 10) || 1,
    description: document.getElementById('roomDescriptionInput').value.trim(),
    is_active: document.getElementById('roomActiveInput').checked
  };

  if (!payload.name) {
    showToast('Please give the room a name.', 'danger');
    return;
  }

  const submitBtn = document.getElementById('roomSubmitBtn');
  submitBtn.disabled = true;

  let error;
  if (editingRoomId) {
    ({ error } = await sb.from('rooms').update(payload).eq('id', editingRoomId));
  } else {
    ({ error } = await sb.from('rooms').insert(payload));
  }

  submitBtn.disabled = false;

  if (error) {
    showToast('Could not save room: ' + error.message, 'danger');
    return;
  }

  showToast(editingRoomId ? 'Room updated.' : 'Room added.', 'success');
  roomModal.hide();
  await loadRooms();
}

async function onDeleteRoom(room) {
  const ok = await showConfirmDialog({
    title: 'Delete room',
    message: `Delete “${escapeHtml(room.name)}”? This also deletes every booking made for this room. This can't be undone.`,
    confirmLabel: 'Delete room',
    danger: true
  });
  if (!ok) return;

  const { error } = await sb.from('rooms').delete().eq('id', room.id);
  if (error) {
    showToast('Could not delete room: ' + error.message, 'danger');
    return;
  }
  showToast('Room deleted.', 'success');
  await loadRooms();
}
