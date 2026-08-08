/**
 * Path B — wrap raw pcm_s16le as minimal WAV for whisper-cli (-f expects container).
 */

/** Build a minimal WAV (PCM s16le) container around raw PCM. */
export function wrapPcmS16leAsWav(
  pcm: Buffer,
  sampleRate = 16_000,
  channels = 1,
): Buffer {
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

/** Ensure whisper-cli gets a WAV file body (raw pcm_s16le is wrapped). */
export function audioBodyForWhisper(
  audio: Buffer,
  format: "pcm_s16le" | "wav",
): { body: Buffer; fileName: "audio.wav" } {
  if (format === "wav") {
    return { body: audio, fileName: "audio.wav" }
  }
  return { body: wrapPcmS16leAsWav(audio), fileName: "audio.wav" }
}
