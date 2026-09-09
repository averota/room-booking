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
