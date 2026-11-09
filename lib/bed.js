// Original, deterministic 48-second station bed: soft sustained chords and
// sparse piano-like notes. No downloaded music or third-party samples.
export function stationBed() {
  const rate = 22050, seconds = 48, samples = rate * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  const chords = [[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]];
  const hz = note => 440 * 2 ** ((note - 69) / 12);
  const note = (t, pitch) => Math.sin(2 * Math.PI * hz(pitch) * t);
  for (let i = 0; i < samples; i++) {
    const t = i / rate; const chord = chords[Math.floor(t / 12) % 4]; const ct = t % 12;
    const envelope = Math.min(1, ct / 1.6, (12 - ct) / 2.4);
    let value = chord.reduce((v, p) => v + note(t, p) * 0.018 + note(t, p + 12) * 0.004, 0) * Math.max(0, envelope);
    const nt = t % 1.5; const pitch = chord[Math.floor(t / 1.5) % 4] + 12;
    value += (note(nt, pitch) * 0.05 + note(nt, pitch + 12) * 0.009) * Math.min(1, nt / 0.025) * Math.exp(-nt * 2.9);
    value *= Math.min(1, t / 1.5, (seconds - t) / 1.5);
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
  }
  return bytes;
}
