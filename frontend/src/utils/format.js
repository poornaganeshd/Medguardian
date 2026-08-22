import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import advancedFormat from 'dayjs/plugin/advancedFormat';

dayjs.extend(relativeTime);
dayjs.extend(advancedFormat);

export { dayjs };

export const formatDate = (value, pattern = 'D MMM YYYY') =>
  value ? dayjs(value).format(pattern) : '—';

export const formatDateTime = (value) =>
  value ? dayjs(value).format('D MMM YYYY, h:mm A') : '—';

export const formatTime = (value) => (value ? dayjs(value).format('h:mm A') : '—');

/** "08:00" -> "8:00 AM" without needing a date. */
export const formatClock = (hhmm) => {
  if (!hhmm || hhmm === 'prn') return 'As needed';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const fromNow = (value) => (value ? dayjs(value).fromNow() : '—');

export const todayKey = () => dayjs().format('YYYY-MM-DD');
export const dateKey = (value) => dayjs(value).format('YYYY-MM-DD');
export const addDays = (key, days) => dayjs(key).add(days, 'day').format('YYYY-MM-DD');

/** Human label for a dose status. */
export const STATUS_LABEL = {
  taken: 'Taken',
  skipped: 'Skipped',
  missed: 'Missed',
  late: 'Late',
  due: 'Due now',
  upcoming: 'Upcoming'
};

export const STATUS_VARIANT = {
  taken: 'success',
  skipped: 'neutral',
  missed: 'danger',
  late: 'danger',
  due: 'warning',
  upcoming: 'info'
};

export const URGENCY_LABEL = {
  out_of_stock: 'Out of stock',
  refill_now: 'Refill now',
  critical: 'Critical',
  urgent: 'Urgent',
  soon: 'Soon',
  ok: 'Well stocked'
};

export const URGENCY_VARIANT = {
  out_of_stock: 'danger',
  refill_now: 'danger',
  critical: 'danger',
  urgent: 'warning',
  soon: 'warning',
  ok: 'success'
};

export const ADHERENCE_LABEL = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  needs_attention: 'Needs attention',
  no_data: 'No data yet'
};

export const ADHERENCE_VARIANT = {
  excellent: 'success',
  good: 'success',
  fair: 'warning',
  needs_attention: 'danger',
  no_data: 'neutral'
};

export const SEVERITY_VARIANT = { major: 'danger', moderate: 'warning', minor: 'info' };

export const RECORD_CATEGORY_LABEL = {
  prescription: 'Prescription',
  pharmacy_bill: 'Pharmacy bill',
  lab_report: 'Lab report',
  discharge_summary: 'Discharge summary',
  imaging: 'Imaging',
  vaccination: 'Vaccination',
  insurance: 'Insurance',
  referral: 'Referral',
  consultation_note: 'Consultation note',
  other: 'Other'
};

export const FREQUENCY_LABEL = {
  daily: 'Every day',
  specific_days: 'Specific days',
  interval: 'Every few days',
  cycle: 'Cycle (on/off)',
  as_needed: 'As needed (PRN)'
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SKIP_REASON_LABEL = {
  forgot: 'Forgot',
  felt_better: 'Felt better',
  side_effects: 'Side effects',
  ran_out: 'Ran out of stock',
  doctor_advice: "Doctor's advice",
  not_needed: 'Not needed',
  other: 'Other'
};

/** "1 tablet" / "2 tablets" */
export const pluralUnit = (quantity, unit = 'dose') => {
  const n = Number(quantity ?? 0);
  const rounded = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  return `${rounded} ${unit}${n === 1 ? '' : 's'}`;
};

export const initials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export const percent = (value) => (value === null || value === undefined ? '—' : `${value}%`);
