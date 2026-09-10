// =====================================================================
// Dashboard: room picker + monthly calendar + booking modal
// =====================================================================

const state = {
  me: null,          // { session, profile, email }
  rooms: [],
  selectedRoomId: null,
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(), // 0-indexed
  bookings: [],       // bookings loaded for the visible grid, selected room only
  editingBookingId: null
};

let dayModal, bookingModal;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const me = await requireSession();
  if (!me) return;
  state.me = me;

  document.getElementById('userName').textContent = me.profile.full_name || me.email;
  document.getElementById('userAvatar').textContent = initials(me.profile.full_name || me.email);
  const roleBadge = document.getElementById('roleBadge');
  roleBadge.textContent = me.profile.role === 'admin' ? 'Admin' : 'Member';
  roleBadge.classList.toggle('admin', me.profile.role === 'admin');
  applyRoleVisibility(me.profile.role);
  wireLogout(document.getElementById('logoutBtn'));

  dayModal = new bootstrap.Modal(document.getElementById('dayModal'));
  bookingModal = new bootstrap.Modal(document.getElementById('bookingModal'));

  wireCalendarToolbar();
  wireBookingForm();

  await loadRooms();
}

// ---------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------
async function loadRooms() {
  const { data, error } = await sb
    .from('rooms')
    .select('id, name, location, capacity, description, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    showToast('Could not load rooms: ' + error.message, 'danger');
    return;
  }

  state.rooms = data || [];
  renderRoomPicker();

  if (state.rooms.length > 0) {
    selectRoom(state.rooms[0].id);
  } else {
    document.getElementById('roomMetaBar').style.display = 'none';
    document.getElementById('calendarCard').style.display = 'none';
    document.getElementById('noRoomsState').style.display = 'block';
  }
}

function renderRoomPicker() {
  const wrap = document.getElementById('roomPicker');
  wrap.innerHTML = '';
  state.rooms.forEach((room) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room-pill' + (room.id === state.selectedRoomId ? ' active' : '');
    btn.innerHTML = `${escapeHtml(room.name)} <span class="cap">· ${room.capacity} seats</span>`;
    btn.addEventListener('click', () => selectRoom(room.id));
    wrap.appendChild(btn);
  });
}

function selectRoom(roomId) {
  state.selectedRoomId = roomId;
  renderRoomPicker();
  const room = state.rooms.find((r) => r.id === roomId);
  if (room) {
    document.getElementById('roomName').textContent = room.name;
    document.getElementById('roomMeta').textContent =
      [room.location, `${room.capacity} seats`].filter(Boolean).join(' · ') +
      (room.description ? ` — ${room.description}` : '');
  }
  loadBookingsAndRender();
}

// ---------------------------------------------------------------------
// Calendar rendering
// ---------------------------------------------------------------------
function wireCalendarToolbar() {
  document.getElementById('prevMonthBtn').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => shiftMonth(1));
  document.getElementById('todayBtn').addEventListener('click', () => {
    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    loadBookingsAndRender();
  });
  document.getElementById('newBookingBtn').addEventListener('click', () => openBookingModal(new Date()));
}

function shiftMonth(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear -= 1; }
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear += 1; }
  loadBookingsAndRender();
}

function gridRange() {
  const firstOfMonth = new Date(state.viewYear, state.viewMonth, 1);
  const gridStart = addDaysLocal(firstOfMonth, -firstOfMonth.getDay());
  const gridEnd = addDaysLocal(gridStart, 42); // 6 weeks
  return { gridStart, gridEnd };
}

async function loadBookingsAndRender() {
  if (!state.selectedRoomId) return;
  const { gridStart, gridEnd } = gridRange();

  const { data, error } = await sb
    .from('bookings')
    .select('id, room_id, user_id, topic, start_time, end_time, recurrence_group_id, recurrence_rule, invitees, profiles(full_name)')
    .eq('room_id', state.selectedRoomId)
    .lt('start_time', gridEnd.toISOString())
    .gt('end_time', gridStart.toISOString())
    .order('start_time', { ascending: true });

  if (error) {
    showToast('Could not load bookings: ' + error.message, 'danger');
    return;
  }

  state.bookings = data || [];
  renderCalendar();
}

function renderCalendar() {
  document.getElementById('monthLabel').textContent = `${MONTH_LABELS[state.viewMonth]} ${state.viewYear}`;

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const { gridStart } = gridRange();
  const todayKey = dateKey(new Date());

  const byDate = {};
  state.bookings.forEach((b) => {
    const k = dateKey(new Date(b.start_time));
    (byDate[k] = byDate[k] || []).push(b);
  });

  for (let i = 0; i < 42; i++) {
    const cellDate = addDaysLocal(gridStart, i);
    const key = dateKey(cellDate);
    const isOutside = cellDate.getMonth() !== state.viewMonth;
    const isToday = key === todayKey;

    const cell = document.createElement('div');
    cell.className = 'day-cell' + (isOutside ? ' outside' : '') + (isToday ? ' today' : '');
    cell.innerHTML = `<div class="date-num">${cellDate.getDate()}</div>`;

    const dayBookings = (byDate[key] || []).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const maxShown = 3;
    dayBookings.slice(0, maxShown).forEach((b) => {
      const mine = b.user_id === state.me.profile.id;
      const chip = document.createElement('div');
      chip.className = 'day-chip ' + (mine ? 'mine' : 'other');
      chip.textContent = `${formatTime(new Date(b.start_time))} · ${b.topic}`;
      cell.appendChild(chip);
    });
    if (dayBookings.length > maxShown) {
      const more = document.createElement('div');
      more.className = 'day-chip-more';
      more.textContent = `+${dayBookings.length - maxShown} more`;
      cell.appendChild(more);
    }

    cell.addEventListener('click', () => openDayModal(cellDate));
    grid.appendChild(cell);
  }
}

// ---------------------------------------------------------------------
// Day modal (view bookings for a date, cancel / edit / add)
// ---------------------------------------------------------------------
function openDayModal(date) {
  document.getElementById('dayModalDate').textContent = formatDateLong(date);
  document.getElementById('dayModalRoom').textContent = state.rooms.find((r) => r.id === state.selectedRoomId)?.name || '';

  const key = dateKey(date);
  const list = state.bookings
    .filter((b) => dateKey(new Date(b.start_time)) === key)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const container = document.getElementById('dayBookingsList');
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state">No bookings yet for this day.</div>';
  } else {
    list.forEach((b) => container.appendChild(renderBookingRow(b)));
  }

  document.getElementById('dayModalAddBtn').onclick = () => {
    dayModal.hide();
    openBookingModal(date);
  };

  dayModal.show();
}

function renderBookingRow(b) {
  const mine = b.user_id === state.me.profile.id;
  const isAdmin = state.me.profile.role === 'admin';
  const canManage = mine || isAdmin;

  const row = document.createElement('div');
  row.className = 'booking-row';

  const bookedByName = mine ? 'You' : (b.profiles?.full_name || 'Colleague');

  row.innerHTML = `
    <div>
      <div class="time">${formatTime(new Date(b.start_time))} – ${formatTime(new Date(b.end_time))}</div>
      <div class="topic">${escapeHtml(b.topic)}</div>
      <div class="booked-by">
        Booked by ${escapeHtml(bookedByName)}
        ${b.recurrence_group_id ? `<span class="badge badge-soft-accent ms-1">${recurrenceLabel(b.recurrence_rule)}</span>` : ''}
      </div>
      ${b.invitees ? `<div class="invitee-row">${inviteeChipsHtml(b.invitees)}</div>` : ''}
    </div>
    <div class="d-flex flex-column gap-1 align-items-end" style="min-width:110px;"></div>
  `;

  const actions = row.querySelector('div.d-flex');
  if (canManage) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-outline-accent';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      dayModal.hide();
      openBookingModal(new Date(b.start_time), b);
    });
    actions.appendChild(editBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-sm btn-outline-danger';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => confirmCancel(b));
    actions.appendChild(cancelBtn);
  } else {
    const badge = document.createElement('span');
    badge.className = 'badge badge-soft-accent';
    badge.textContent = 'Booked';
    actions.appendChild(badge);
  }

  return row;
}

async function confirmCancel(booking) {
  if (booking.recurrence_group_id) {
    const choice = await showConfirmDialog({
      title: 'Cancel booking',
      message: `This booking is part of a recurring series (${recurrenceLabel(booking.recurrence_rule).toLowerCase()}). What would you like to cancel?`,
      confirmLabel: 'Cancel booking',
      danger: true,
      choices: [
        { value: 'one', label: 'Just this occurrence', hint: formatDateLong(new Date(booking.start_time)) },
        { value: 'series', label: 'The entire series', hint: 'Removes every date in this recurring booking' }
      ]
    });
    if (!choice) return;
    if (choice === 'series') { await cancelSeries(booking.recurrence_group_id); return; }
    await cancelSingle(booking.id);
    return;
  }

  const ok = await showConfirmDialog({
    title: 'Cancel booking',
    message: `Cancel “${escapeHtml(booking.topic)}” on ${formatDateLong(new Date(booking.start_time))}?`,
    confirmLabel: 'Cancel booking',
    danger: true
  });
  if (!ok) return;
  await cancelSingle(booking.id);
}

async function cancelSingle(bookingId) {
  const { error } = await sb.from('bookings').delete().eq('id', bookingId);
  if (error) { showToast('Could not cancel booking: ' + error.message, 'danger'); return; }
  showToast('Booking cancelled.', 'success');
  dayModal.hide();
  await loadBookingsAndRender();
}

async function cancelSeries(groupId) {
  const { error } = await sb.from('bookings').delete().eq('recurrence_group_id', groupId);
  if (error) { showToast('Could not cancel series: ' + error.message, 'danger'); return; }
  showToast('Recurring series cancelled.', 'success');
  dayModal.hide();
  await loadBookingsAndRender();
}

// ---------------------------------------------------------------------
// Booking form modal (create / edit)
// ---------------------------------------------------------------------
function wireBookingForm() {
  const recurrenceSelect = document.getElementById('recurrenceSelect');
  recurrenceSelect.addEventListener('change', () => {
    const show = recurrenceSelect.value !== 'none';
    document.getElementById('recurrenceEndFields').classList.toggle('show', show);
  });

  const dateInput = document.getElementById('bookingDate');
  const untilInput = document.getElementById('recurrenceUntil');
  dateInput.addEventListener('change', () => {
    untilInput.min = dateInput.value;
    if (untilInput.value && dateStrBefore(untilInput.value, dateInput.value)) {
      untilInput.value = dateInput.value;
    }
  });

  document.getElementById('bookingInvitees').addEventListener('input', (e) => {
    document.getElementById('inviteePreview').innerHTML = inviteeChipsHtml(e.target.value);
  });

  document.getElementById('bookingForm').addEventListener('submit', onSubmitBooking);
}

function openBookingModal(defaultDate, existingBooking = null) {
  const form = document.getElementById('bookingForm');
  form.reset();
  document.getElementById('conflictAlert').style.display = 'none';
  document.getElementById('recurrenceEndFields').classList.remove('show');
  document.getElementById('inviteePreview').innerHTML = '';

  const room = state.rooms.find((r) => r.id === state.selectedRoomId);
  document.getElementById('bookingModalRoom').textContent = room ? room.name : '';

  if (existingBooking) {
    state.editingBookingId = existingBooking.id;
    document.getElementById('bookingModalTitle').textContent = 'Edit booking';
    document.getElementById('bookingSubmitLabel').textContent = 'Save changes';
    document.getElementById('bookingTopic').value = existingBooking.topic;
    const s = new Date(existingBooking.start_time);
    const e = new Date(existingBooking.end_time);
    document.getElementById('bookingDate').value = dateKey(s);
    document.getElementById('bookingStart').value = `${pad2(s.getHours())}:${pad2(s.getMinutes())}`;
    document.getElementById('bookingEnd').value = `${pad2(e.getHours())}:${pad2(e.getMinutes())}`;
    document.getElementById('bookingInvitees').value = existingBooking.invitees || '';
    document.getElementById('inviteePreview').innerHTML = inviteeChipsHtml(existingBooking.invitees || '');
    document.getElementById('recurrenceGroup').style.display = 'none';
    document.getElementById('editRecurrenceNote').style.display = existingBooking.recurrence_group_id ? 'block' : 'none';
  } else {
    state.editingBookingId = null;
    document.getElementById('bookingModalTitle').textContent = 'New booking';
    document.getElementById('bookingSubmitLabel').textContent = 'Create booking';
    document.getElementById('bookingDate').value = dateKey(defaultDate);
    const suggested = suggestedTimeRange(defaultDate);
    document.getElementById('bookingStart').value = suggested.start;
    document.getElementById('bookingEnd').value = suggested.end;
    document.getElementById('recurrenceGroup').style.display = 'block';
    document.getElementById('editRecurrenceNote').style.display = 'none';
    document.getElementById('ignoreSaturday').checked = true;
    document.getElementById('ignoreSunday').checked = true;
  }

  document.getElementById('recurrenceUntil').min = document.getElementById('bookingDate').value;
  bookingModal.show();
}

async function onSubmitBooking(e) {
  e.preventDefault();
  const conflictAlert = document.getElementById('conflictAlert');
  conflictAlert.style.display = 'none';

  const dateStr = document.getElementById('bookingDate').value;
  const startStr = document.getElementById('bookingStart').value;
  const endStr = document.getElementById('bookingEnd').value;
  const topic = document.getElementById('bookingTopic').value.trim();
  const invitees = parseInvitees(document.getElementById('bookingInvitees').value).join(', ');

  if (!dateStr || !startStr || !endStr || !topic) {
    showToast('Please fill in all required fields.', 'danger');
    return;
  }

  const start = combineDateTime(dateStr, startStr);
  const end = combineDateTime(dateStr, endStr);

  if (end.getTime() <= start.getTime()) {
    showToast('End time must be after the start time.', 'danger');
    return;
  }
  if (start.getTime() < Date.now() - 5 * 60 * 1000) {
    showToast('You can’t book a time in the past.', 'danger');
    return;
  }

  const submitBtn = document.getElementById('bookingSubmitBtn');
  submitBtn.disabled = true;

  try {
    if (state.editingBookingId) {
      await submitEdit(state.editingBookingId, start, end, topic, invitees);
    } else {
      const rule = document.getElementById('recurrenceSelect').value;
      const untilStr = document.getElementById('recurrenceUntil').value;
      const ignoreSaturday = document.getElementById('ignoreSaturday').checked;
      const ignoreSunday = document.getElementById('ignoreSunday').checked;
      await submitCreate(start, end, topic, invitees, rule === 'none' ? null : rule, untilStr, ignoreSaturday, ignoreSunday);
    }
  } finally {
    submitBtn.disabled = false;
  }
}

async function submitEdit(bookingId, start, end, topic, invitees) {
  const conflicts = await checkConflicts(state.selectedRoomId, [{ start, end }], bookingId);
  if (conflicts.length > 0) {
    renderConflicts(conflicts);
    return;
  }

  const { error } = await sb
    .from('bookings')
    .update({ topic, start_time: start.toISOString(), end_time: end.toISOString(), invitees: invitees || null })
    .eq('id', bookingId);

  if (error) {
    if (isOverlapViolation(error)) {
      showToast('That time now clashes with another booking — please pick another slot.', 'danger');
    } else {
      showToast('Could not save changes: ' + error.message, 'danger');
    }
    return;
  }
  showToast('Booking updated.', 'success');
  bookingModal.hide();
  await loadBookingsAndRender();
}

async function submitCreate(start, end, topic, invitees, rule, untilStr, ignoreSaturday, ignoreSunday) {
  if (rule && !untilStr) {
    showToast('Please choose an end date for the recurrence.', 'danger');
    return;
  }
  if (rule && dateStrBefore(untilStr, document.getElementById('bookingDate').value)) {
    showToast('The recurrence end date can’t be before the booking date.', 'danger');
    return;
  }

  let { occurrences, truncated } = expandOccurrences(start, end, rule, untilStr);
  if (rule) {
    occurrences = applyWeekendSkip(occurrences, ignoreSaturday, ignoreSunday);
  }
  const conflicts = await checkConflicts(state.selectedRoomId, occurrences, null);

  if (conflicts.length > 0) {
    renderConflicts(conflicts);
    return;
  }

  const recurrenceGroupId = occurrences.length > 1 ? crypto.randomUUID() : null;
  const rows = occurrences.map((occ) => ({
    room_id: state.selectedRoomId,
    user_id: state.me.profile.id,
    topic,
    invitees: invitees || null,
    start_time: occ.start.toISOString(),
    end_time: occ.end.toISOString(),
    recurrence_group_id: recurrenceGroupId,
    recurrence_rule: recurrenceGroupId ? rule : null
  }));

  const { error } = await sb.from('bookings').insert(rows);
  if (error) {
    if (isOverlapViolation(error)) {
      showToast('Someone booked that slot moments ago — please pick another time.', 'danger');
    } else {
      showToast('Could not create booking: ' + error.message, 'danger');
    }
    return;
  }

  if (truncated) {
    showToast(`Recurrence was capped at ${MAX_OCCURRENCES} occurrences; booked through then. Shorten the end date to cover a smaller range if you need every date.`, 'accent');
  }
  showToast(occurrences.length > 1 ? `Booked ${occurrences.length} occurrences.` : 'Booking created.', 'success');
  bookingModal.hide();
  await loadBookingsAndRender();
}

/** Postgres exclusion-constraint violation code — our belt-and-braces DB guard against overlaps. */
function isOverlapViolation(error) {
  return error && (error.code === '23P01' || /exclusion/i.test(error.message || ''));
}

async function checkConflicts(roomId, occurrences, excludeBookingId) {
  const minStart = occurrences.reduce((m, o) => (o.start < m ? o.start : m), occurrences[0].start);
  const maxEnd = occurrences.reduce((m, o) => (o.end > m ? o.end : m), occurrences[0].end);

  let query = sb
    .from('bookings')
    .select('id, topic, start_time, end_time')
    .eq('room_id', roomId)
    .lt('start_time', maxEnd.toISOString())
    .gt('end_time', minStart.toISOString());

  const { data, error } = await query;
  if (error) throw error;

  const existing = (data || []).filter((b) => b.id !== excludeBookingId);

  const conflicts = [];
  for (const occ of occurrences) {
    for (const b of existing) {
      const bs = new Date(b.start_time);
      const be = new Date(b.end_time);
      if (rangesOverlap(occ.start, occ.end, bs, be)) {
        conflicts.push({ occurrence: occ, existing: b });
        break;
      }
    }
  }
  return conflicts;
}

function renderConflicts(conflicts) {
  const box = document.getElementById('conflictAlert');
  const items = conflicts
    .slice(0, 8)
    .map((c) => `<li>${formatDateLong(c.occurrence.start)}, ${formatTime(c.occurrence.start)}–${formatTime(c.occurrence.end)} — clashes with “${escapeHtml(c.existing.topic)}”</li>`)
    .join('');
  const extra = conflicts.length > 8 ? `<li>…and ${conflicts.length - 8} more</li>` : '';
  box.innerHTML = `<strong>This room is already booked at that time.</strong><ul>${items}${extra}</ul>`;
  box.style.display = 'block';
}
