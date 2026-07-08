import { Language } from "./userSettings";

const DAY_NAMES: Record<Language, string[]> = {
  en: ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"],
  fr: ["DIMANCHE", "LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI"],
};

const TODAY_WORD: Record<Language, string> = { en: "TODAY", fr: "AUJOURD'HUI" };
const YESTERDAY_WORD: Record<Language, string> = { en: "YESTERDAY", fr: "HIER" };
const TOMORROW_WORD: Record<Language, string> = { en: "TOMORROW", fr: "DEMAIN" };
const LATER_WORD: Record<Language, string> = { en: "LATER", fr: "PLUS TARD" };
const EARLIER_WORD: Record<Language, string> = { en: "EARLIER", fr: "AVANT" };

export function todayISODate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

// TVmaze's `airdate` field is a date-only string in the show's own broadcast
// region (e.g. US Eastern), not the viewer's — an episode airing at 8pm
// Eastern already reads as the next calendar day for anyone east of that
// (all of Europe), so treating `airdate` as if it were already the user's
// local date shifts "today" episodes into "yesterday". `airstamp` is a full
// UTC instant, so parsing that and only THEN truncating to a local calendar
// day gives the date the way the viewer's clock would show it. Every
// function below takes an airstamp, not an airdate — do not feed it airdate.
export function diffDaysFromToday(airstamp: string) {
  const target = new Date(airstamp);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// The local calendar-day key for an airstamp — use this (not the raw
// airstamp, which includes a time-of-day, and not airdate, which is in the
// wrong timezone) whenever episodes need to be grouped or matched by day.
export function localDateKey(airstamp: string) {
  const d = new Date(airstamp);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function todayFullLabel(language: Language = "en") {
  const now = new Date();
  const formatted = now
    .toLocaleDateString(language, { month: "short", day: "numeric", year: "numeric" })
    .toUpperCase();
  return `${TODAY_WORD[language]} · ${formatted}`;
}

export function dateLabel(airstamp: string, language: Language = "en") {
  const target = new Date(airstamp);
  target.setHours(0, 0, 0, 0);
  const diffDays = diffDaysFromToday(airstamp);

  if (diffDays === 0) return todayFullLabel(language);
  if (diffDays === -1) return YESTERDAY_WORD[language];
  if (diffDays === 1) return TOMORROW_WORD[language];
  if (diffDays > 1 && diffDays < 7) return DAY_NAMES[language][target.getDay()];

  const sameYear = target.getFullYear() === new Date().getFullYear();
  return target
    .toLocaleDateString(language, {
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
export function upcomingGroupKey(airstamp: string) {
  const diffDays = diffDaysFromToday(airstamp);
  if (diffDays >= 7) return "LATER";
  if (diffDays <= -7) return "EARLIER";
  return localDateKey(airstamp);
}

export function upcomingGroupLabel(key: string, airstamp: string, language: Language = "en") {
  if (key === "LATER") return LATER_WORD[language];
  if (key === "EARLIER") return EARLIER_WORD[language];
  return dateLabel(airstamp, language);
}
