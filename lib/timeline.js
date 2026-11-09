export const PRE_DUCK_SECONDS = 1.2;
export function segueCue({ outgoingSeconds, incomingSeconds, speechSeconds = 0, crossfadeSeconds = 6 }) {
  const length = Math.max(.1, Number(outgoingSeconds) || 180);
  const crossfade = Math.min(Math.max(.05, Number(crossfadeSeconds) || .05), length / 3, Math.max(.1, Number(incomingSeconds) || 180) / 3);
  const duration = Math.max(0, Number(speechSeconds) || 0);
  const musicStart = Math.max(0, length - crossfade);
  const speechStart = Math.max(PRE_DUCK_SECONDS, length - crossfade / 2 - duration / 2);
  const duckAt = Math.max(0, speechStart - PRE_DUCK_SECONDS);
  return { crossfade, duration, musicStart, duckAt, speechStart, speechEnd: speechStart + duration, triggerAt: Math.min(musicStart, duration ? duckAt : musicStart) };
}
export function programmeTimeline(programme, settings) {
  let start = (programme.opening.duration || 0) + (programme.segments[0]?.speech?.duration || 0) + 2 * PRE_DUCK_SECONDS;
  return programme.segments.map((segment, index) => {
    if (!index) return { songId: segment.track.id, musicStart: start, speechStart: (programme.opening.duration || 0) + 2 * PRE_DUCK_SECONDS, speechEnd: start };
    const previous = programme.segments[index - 1];
    const cue = segueCue({ outgoingSeconds: previous.track.interval, incomingSeconds: segment.track.interval, speechSeconds: segment.speech.duration, crossfadeSeconds: settings.crossfadeSeconds });
    const entry = { songId: segment.track.id, musicStart: start + cue.musicStart, duckAt: start + cue.duckAt, speechStart: start + cue.speechStart, speechEnd: start + cue.speechEnd };
    segment.cue = { ...segment.cue, ...cue, placement: 'overlap-tail-and-head', bed: 'outgoing-and-incoming-music' }; start = entry.musicStart; return entry;
  });
}
