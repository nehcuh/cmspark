import test from 'node:test'
import assert from 'node:assert/strict'
import { selectWindowFrame } from '../src/sidepanel/components/personal-workspace/WindowScreenshotImport'

test('one-shot import reads only a verified window frame and releases the stream before returning a preview', async () => {
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let surface: string | undefined = 'window', stops = 0, draws = 0
  let frame: () => void
  const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false, getSettings: () => ({ displaySurface: surface }), stop: () => { stops++ } })
  const media = { getDisplayMedia: async (options: DisplayMediaStreamOptions) => {
    assert.equal(options.audio, false)
    return { getVideoTracks: () => [track], getTracks: () => [track] }
  } }
  const video = { videoWidth: 800, videoHeight: 600, srcObject: null, muted: true,
    requestVideoFrameCallback: (fn: () => void) => { frame = fn; return 1 }, cancelVideoFrameCallback() {},
    play: async () => { queueMicrotask(frame) } }
  const canvas = { getContext: () => ({ drawImage: () => { draws++ } }), toDataURL: () => 'data:image/png;base64,AA==' }
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: media } })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (type: string) => type === 'video' ? video : canvas } })
    const signal = new AbortController().signal
    assert.match(await selectWindowFrame(signal), /^data:image\/png;base64,/)
    assert.equal(video.srcObject, null)
    for (surface of ['monitor', 'browser', undefined]) assert.match(await selectWindowFrame(signal).then(() => '', e => e.message), /单个窗口/)
    surface = 'window'
    assert.equal(await selectWindowFrame(AbortSignal.abort()).then(() => '', e => e.name), 'AbortError')
    assert.equal(draws, 1)
    assert.equal(stops, 5)
  } finally {
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore)
    else Reflect.deleteProperty(globalThis, 'navigator')
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
