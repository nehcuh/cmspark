/** Chrome's default device is independent of the operating system default. */
export const MICROPHONE_DEVICE_KEY = "voiceMicrophoneDeviceId"

export async function microphoneConstraints(): Promise<MediaTrackConstraints> {
  const stored = typeof chrome !== "undefined" && chrome.storage?.local
    ? await chrome.storage.local.get(MICROPHONE_DEVICE_KEY)
    : {}
  const id = stored?.[MICROPHONE_DEVICE_KEY]
  return {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    ...(typeof id === "string" && id ? { deviceId: { exact: id } } : {}),
  }
}

export async function openMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: await microphoneConstraints() })
}

export function stopMicrophoneTracks(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    try {
      track.stop()
    } catch {
      // Continue releasing the other tracks.
    }
  }
}
