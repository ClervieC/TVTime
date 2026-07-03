const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

export function todayISODate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function diffDaysFromToday(isoDate: string) {
  const target = new Date(isoDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function todayFullLabel() {
  const now = new Date();
  const formatted = now
    .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
  return `TODAY · ${formatted}`;
}

export function dateLabel(isoDate: string) {
  const target = new Date(isoDate + "T00:00:00");
  const diffDays = diffDaysFromToday(isoDate);

  if (diffDays === 0) return todayFullLabel();
  if (diffDays === -1) return "YESTERDAY";
  if (diffDays === 1) return "TOMORROW";
  if (diffDays > 1 && diffDays < 7) return DAY_NAMES[target.getDay()];

  const sameYear = target.getFullYear() === new Date().getFullYear();
  return target
    .toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    })
    .toUpperCase();
}

export function formatTime(airstamp: string) {
  return new Date(airstamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Groups more than a week away (in either direction) collapse into a single
 * bucket so the list doesn't fragment into dozens of one-off date headers.
 */
export function upcomingGroupKey(isoDate: string) {
  const diffDays = diffDaysFromToday(isoDate);
  if (diffDays >= 7) return "LATER";
  if (diffDays <= -7) return "EARLIER";
  return isoDate;
}

export function upcomingGroupLabel(key: string, isoDate: string) {
  if (key === "LATER" || key === "EARLIER") return key;
  return dateLabel(isoDate);
}
