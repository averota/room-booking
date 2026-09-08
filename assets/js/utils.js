// =====================================================================
// Generic helpers used across pages
// =====================================================================

function showToast(message, variant = 'accent') {
  let stack = document.querySelector('.toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }
  const bg = { accent: 'text-bg-dark', danger: 'text-bg-danger', success: 'text-bg-success' }[variant] || 'text-bg-dark';
  const el = document.createElement('div');
  el.className = `toast align-items-center ${bg} border-0 mb-2`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  stack.appendChild(el);
  const toast = new bootstrap.Toast(el, { delay: 4000 });
  toast.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function pad2(n) { return String(n).padStart(2, '0'); }

/** yyyy-mm-dd in local time (avoids UTC off-by-one from toISOString) */
function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d) {
  let h = d.getHours();
  const m = pad2(d.getMinutes());
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function formatDateLong(d) {
  return `${WEEKDAY_LABELS[d.getDay()]}, ${MONTH_LABELS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Combine a yyyy-mm-dd string and HH:MM string into a local Date object. */
function combineDateTime(dateStr, timeStr) {
  const [y, mo, da] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  return new Date(y, mo - 1, da, h, mi, 0, 0);
}

function addDaysLocal(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Expand a booking into occurrence [start, end] pairs based on a recurrence
 * rule. `rule` is one of null, 'daily', 'weekly', 'monthly', 'yearly'.
 * Caps at 366 occurrences as a safety net against runaway ranges.
 */
function expandOccurrences(startDate, endDate, rule, untilDateStr) {
  const duration = endDate.getTime() - startDate.getTime();
  const occurrences = [{ start: new Date(startDate), end: new Date(endDate) }];

  if (!rule || rule === 'none') return occurrences;

  const until = combineDateTime(untilDateStr, '23:59');
  let cursor = new Date(startDate);
  let guard = 0;

  while (guard < 366) {
    guard += 1;
    let next;
    if (rule === 'daily') next = addDaysLocal(cursor, 1);
    else if (rule === 'weekly') next = addDaysLocal(cursor, 7);
    else if (rule === 'monthly') {
      next = new Date(cursor);
      next.setMonth(next.getMonth() + 1);
    } else if (rule === 'yearly') {
      next = new Date(cursor);
      next.setFullYear(next.getFullYear() + 1);
    } else {
      break;
    }

    if (next.getTime() > until.getTime()) break;

    const occStart = next;
    const occEnd = new Date(occStart.getTime() + duration);
    occurrences.push({ start: occStart, end: occEnd });
    cursor = next;
  }

  return occurrences;
}

/** True if [aStart,aEnd) overlaps [bStart,bEnd) */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

function recurrenceLabel(rule) {
  return { daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly', yearly: 'Repeats yearly' }[rule] || '';
}
