export const formatRunDuration = (durationMs: number | undefined): string => {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs ?? 0) : 0;
  const totalSeconds = safeDurationMs > 0 ? Math.ceil(safeDurationMs / 1_000) : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};
