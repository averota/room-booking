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
 * Add `months` calendar months to `date`, clamping the day-of-month so it
 * never overflows into a later month. Plain `setMonth()` doesn't do this:
 * Jan 31 + 1 month naively becomes Mar 3 (Feb only has 28/29 days), which
 * silently shifts a recurring booking's weekday/date every time it crosses
 * a short month. Clamping keeps "the 31st" landing on the last day of
 * shorter months instead, which is what people actually expect from a
 * monthly recurrence.
 */
function addMonthsClamped(date, months) {
  const day = date.getDate();
  const d = new Date(date);
  d.setDate(1); // avoid overflow while switching months
  d.setMonth(d.getMonth() + months);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  d.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
  return d;
}

/** Same idea as addMonthsClamped, for the Feb 29 -> Feb 28 case on yearly recurrence. */
function addYearsClamped(date, years) {
  return addMonthsClamped(date, years * 12);
}

const MAX_OCCURRENCES = 366;

/**
 * Expand a booking into occurrence [start, end] pairs based on a recurrence
 * rule. `rule` is one of null, 'daily', 'weekly', 'monthly', 'yearly'.
 * Returns { occurrences, truncated } — `truncated` is true if the safety
 * cap was hit before reaching `untilDateStr`, so the caller can warn the
 * person their series was cut short instead of silently under-booking.
 *
 * Each occurrence is computed directly from the ORIGINAL start date
 * (start + N days/weeks/months/years), not from the previous occurrence.
 * Advancing from the previous one would compound date-clamping: e.g. a
 * "31st of the month" booking would clamp to Feb 28, and if the *next*
 * step advanced from that Feb 28 instead of the original Jan 31, every
 * later month would drift to the 28th too, instead of correctly bouncing
 * back to the 30th/31st once the month is long enough again.
 */
function expandOccurrences(startDate, endDate, rule, untilDateStr) {
  const duration = endDate.getTime() - startDate.getTime();
  const occurrences = [{ start: new Date(startDate), end: new Date(endDate) }];

  if (!rule || rule === 'none') return { occurrences, truncated: false };

  const until = combineDateTime(untilDateStr, '23:59');
  let truncated = false;

  // Loop one step past the cap on purpose: if that extra occurrence would
  // still fall within `until`, we know occurrences were genuinely cut off
  // (rather than the cap coincidentally landing right on the last one).
  for (let n = 1; n <= MAX_OCCURRENCES + 1; n++) {
    let occStart;
    if (rule === 'daily') occStart = addDaysLocal(startDate, n);
    else if (rule === 'weekly') occStart = addDaysLocal(startDate, n * 7);
    else if (rule === 'monthly') occStart = addMonthsClamped(startDate, n);
    else if (rule === 'yearly') occStart = addYearsClamped(startDate, n);
    else break;

    if (occStart.getTime() > until.getTime()) break;

    if (n > MAX_OCCURRENCES) {
      truncated = true;
      break;
    }

    occurrences.push({ start: occStart, end: new Date(occStart.getTime() + duration) });
  }

  return { occurrences, truncated };
}

/** True if [aStart,aEnd) overlaps [bStart,bEnd) */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

function recurrenceLabel(rule) {
  return { daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly', yearly: 'Repeats yearly' }[rule] || '';
}

/** True if yyyy-mm-dd string `a` is strictly before yyyy-mm-dd string `b`. */
function dateStrBefore(a, b) {
  return a < b; // safe lexicographic comparison for zero-padded yyyy-mm-dd
}

/** Escapes text for safe insertion into innerHTML. Shared by calendar.js and admin.js. */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// ---------------------------------------------------------------------
// Shared confirm dialog (replaces window.confirm/prompt with a modal).
// Usage:
//   const ok = await showConfirmDialog({ title, message, confirmLabel, danger });
//   const which = await showConfirmDialog({ title, message, confirmLabel, danger, choices: [...] });
// Resolves to `null` if dismissed, otherwise `true` (no choices) or the
// selected choice's value (radio choices).
// ---------------------------------------------------------------------
function showConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, choices = null }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('sharedConfirmModal');
    if (existing) existing.remove();

    const choicesHtml = choices
      ? `<div class="confirm-choice-group">${choices.map((c, i) => `
          <label class="confirm-choice">
            <input type="radio" name="confirmChoice" value="${escapeHtml(c.value)}" ${i === 0 ? 'checked' : ''}>
            <span>
              <span class="confirm-choice-title">${escapeHtml(c.label)}</span>
              ${c.hint ? `<span class="confirm-choice-hint">${escapeHtml(c.hint)}</span>` : ''}
            </span>
          </label>`).join('')}</div>`
      : '';

    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal fade" id="sharedConfirmModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">${escapeHtml(title)}</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body">
              <p class="${choices ? 'mb-3' : 'mb-0'}">${message}</p>
              ${choicesHtml}
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Never mind</button>
              <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-accent'}" id="sharedConfirmBtn">${escapeHtml(confirmLabel)}</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap.firstElementChild);

    const modalEl = document.getElementById('sharedConfirmModal');
    const modal = new bootstrap.Modal(modalEl);
    let resolved = false;

    modalEl.querySelector('#sharedConfirmBtn').addEventListener('click', () => {
      resolved = true;
      let value = true;
      if (choices) {
        const checked = modalEl.querySelector('input[name="confirmChoice"]:checked');
        value = checked ? checked.value : choices[0].value;
      }
      modal.hide();
      resolve(value);
    });

    modalEl.addEventListener('hidden.bs.modal', () => {
      modalEl.remove();
      if (!resolved) resolve(null);
    });

    modal.show();
  });
}

// ---------------------------------------------------------------------
// Weekend + holiday handling for recurring bookings
// ---------------------------------------------------------------------

/**
 * Builds a "is this date blocked?" predicate from the recurrence options.
 * `holidaySet` is a Set of yyyy-mm-dd strings (see dateKey).
 */
function makeRecurrenceBlockedFn({ ignoreSaturday, ignoreSunday, ignoreHoliday, holidaySet }) {
  return (d) => {
    const day = d.getDay(); // 0 = Sun, 6 = Sat
    if (ignoreSaturday && day === 6) return true;
    if (ignoreSunday && day === 0) return true;
    if (ignoreHoliday && holidaySet && holidaySet.has(dateKey(d))) return true;
    return false;
  };
}

/**
 * Walks a date forward or backward, one day at a time, off any date the
 * `isBlocked` predicate flags (weekend and/or holiday), landing on the
 * closest allowed day in that direction. `direction` is 'backward'
 * (default — move to the previous allowed day) or 'forward'.
 */
function shiftAwayFromBlockedDates(date, isBlocked, direction) {
  const d = new Date(date);
  const step = direction === 'forward' ? 1 : -1;
  let guard = 0;
  while (guard < 14 && isBlocked(d)) {
    d.setDate(d.getDate() + step);
    guard++;
  }
  return d;
}

/**
 * Re-dates every occurrence that falls on a blocked day (ignored weekend
 * day and/or holiday) to the nearest allowed day in the chosen direction.
 * If two occurrences land on the same shifted date (e.g. a daily series
 * with both weekend days ignored can push a Saturday and Sunday
 * occurrence both onto the same Friday), the later duplicate is dropped
 * rather than double-booking the same slot.
 *
 * `options`: { ignoreSaturday, ignoreSunday, ignoreHoliday, holidaySet, direction }
 */
function applyRecurrenceAdjustments(occurrences, options) {
  const { ignoreSaturday, ignoreSunday, ignoreHoliday } = options;
  if (!ignoreSaturday && !ignoreSunday && !ignoreHoliday) return occurrences;

  const isBlocked = makeRecurrenceBlockedFn(options);
  const seen = new Set();
  const result = [];
  for (const occ of occurrences) {
    const duration = occ.end.getTime() - occ.start.getTime();
    const shiftedStart = shiftAwayFromBlockedDates(occ.start, isBlocked, options.direction);
    const key = shiftedStart.getTime();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ start: shiftedStart, end: new Date(shiftedStart.getTime() + duration) });
  }
  return result;
}

// ---------------------------------------------------------------------
// Invitees (informational, free-text, comma-separated)
// ---------------------------------------------------------------------

function parseInvitees(text) {
  return (text || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const INVITEE_CHIP_PALETTE = [
  { bg: 'var(--accent-soft)', fg: 'var(--accent-dark)' },
  { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
  { bg: 'var(--success-soft)', fg: 'var(--success)' },
  { bg: '#E6E9F5', fg: '#3D4A9E' },
  { bg: '#F5E6F0', fg: '#9E3D7C' }
];

/** Renders each invitee as a small pill, cycling through a palette so names stay visually distinct. */
function inviteeChipsHtml(text) {
  return parseInvitees(text)
    .map((name, i) => {
      const c = INVITEE_CHIP_PALETTE[i % INVITEE_CHIP_PALETTE.length];
      return `<span class="invitee-chip" style="background:${c.bg}; color:${c.fg};">${escapeHtml(name)}</span>`;
    })
    .join('');
}

// ---------------------------------------------------------------------
// Smart default booking time: next hour if the date is today, else 8 AM.
// ---------------------------------------------------------------------
function suggestedTimeRange(date) {
  const now = new Date();
  let startHour = dateKey(date) === dateKey(now) ? now.getHours() + 1 : 8;
  startHour = Math.min(Math.max(startHour, 0), 22); // keep room for a 1hr slot before midnight
  const endHour = startHour + 1;
  return { start: `${pad2(startHour)}:00`, end: `${pad2(endHour)}:00` };
}

// ---------------------------------------------------------------------
// Holiday spreadsheet import (CSV/XLSX) — row normalization only.
// The actual file parsing (SheetJS) lives in holidays.js since it's
// tied to that page; this just cleans up whatever rows come out of it.
// ---------------------------------------------------------------------

/**
 * Normalizes one parsed spreadsheet row into { dateKey, description, remark }
 * or null if the row has no usable date. Column names are matched
 * case-insensitively so "Date", "date", " DATE " all work.
 */
function normalizeHolidayRow(row) {
  const keys = Object.keys(row);
  const findKey = (name) => keys.find((k) => k.trim().toLowerCase() === name);

  const dateRaw = row[findKey('date')];
  const description = String(row[findKey('description')] ?? '').trim();
  const remark = String(row[findKey('remark')] ?? '').trim();

  let dateObj = null;
  if (dateRaw instanceof Date && !isNaN(dateRaw.getTime())) {
    dateObj = dateRaw;
  } else if (typeof dateRaw === 'string' && dateRaw.trim()) {
    const parsed = new Date(dateRaw.trim());
    if (!isNaN(parsed.getTime())) dateObj = parsed;
  }

  if (!dateObj || !description) return null;
  return { dateKey: dateKey(dateObj), description, remark };
}
