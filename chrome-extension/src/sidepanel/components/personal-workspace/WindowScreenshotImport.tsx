import { useEffect, useRef, useState } from 'react'

/** Capture one presented frame. Chromium/portals can offer more surface types than requested. */
export async function selectWindowFrame(signal: AbortSignal): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window' }, audio: false })
  const tracks = stream.getVideoTracks()
  let video: HTMLVideoElement | undefined
  try {
    signal.throwIfAborted()
    const track = tracks[0]
    if (tracks.length !== 1 || track.getSettings().displaySurface !== 'window')
      throw new Error('请选择单个窗口。当前桌面无法确认窗口类型时，可直接导入 PNG。')
    video = document.createElement('video')
    video.muted = true
    video.srcObject = stream
    const player = video
    await new Promise<void>((resolve, reject) => {
      const ended = () => settle(new Error('窗口共享已结束，请重新选窗。'))
      const abort = () => settle(new Error('已取消选窗。'))
      const timer = setTimeout(() => settle(new Error('未收到窗口画面，请重新选择或导入 PNG。')), 10_000)
      const frame = player.requestVideoFrameCallback(() => settle())
      function settle(error?: Error) {
        clearTimeout(timer)
        player.cancelVideoFrameCallback(frame)
        signal.removeEventListener('abort', abort)
        track.removeEventListener('ended', ended)
        if (error) reject(error)
        else resolve()
      }
      track.addEventListener('ended', ended, { once: true })
      signal.addEventListener('abort', abort, { once: true })
      if (track.readyState === 'ended') ended()
      else void player.play().catch(ended)
    })
    signal.throwIfAborted()
    if (track.readyState !== 'live' || track.muted || track.getSettings().displaySurface !== 'window')
      throw new Error('当前窗口没有可用的单窗画面。')
    const width = player.videoWidth, height = player.videoHeight
    if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216)
      throw new Error('窗口尺寸超出识别范围，请缩小窗口后重试。')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器无法读取当前画面，可改为导入 PNG。')
    ctx.drawImage(player, 0, 0)
    const png = canvas.toDataURL('image/png')
    if (!png.startsWith('data:image/png;base64,') || png.length > 8_388_630)
      throw new Error('截图为空或超过 6 MiB，请缩小窗口后重试。')
    return png
  } finally {
    for (const track of stream.getTracks()) track.stop()
    if (video) video.srcObject = null
  }
}

export function WindowScreenshotImport({ busy, sendImage, onImport }: {
  busy: boolean; sendImage: boolean; onImport: (base64: string) => Promise<boolean>
}) {
  const active = useRef<AbortController | null>(null)
  const [selecting, setSelecting] = useState(false), [png, setPng] = useState(''), [error, setError] = useState('')
  useEffect(() => () => { active.current?.abort() }, [])
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia ||
      typeof HTMLVideoElement === 'undefined' || !HTMLVideoElement.prototype.requestVideoFrameCallback) return null
  async function select() {
    if (active.current) return
    const owner = new AbortController()
    active.current = owner
    setSelecting(true); setError(''); setPng('')
    try {
      const image = await selectWindowFrame(owner.signal)
      if (!owner.signal.aborted) setPng(image)
    } catch (e) {
      if (!owner.signal.aborted) setError((e as Error).name === 'NotAllowedError' ? '选窗已取消或桌面未授权，仍可导入 PNG。' : (e as Error).message)
    } finally {
      if (!owner.signal.aborted) setSelecting(false)
      active.current = null
    }
  }
  return <div>
    <button type="button" className="cm-p-button" disabled={busy || selecting} onClick={() => void select()}>{selecting ? '等待窗口画面…' : '选一个窗口截一张图'}</button>
    {error && <p role="alert">{error}</p>}
    {png && <div><img className="cm-personal-source-image" src={png} alt="待确认导入的窗口截图" />
      <p className="cm-personal-fieldnote">共享已结束。请核对整张窗口截图的内容。</p>
      <button type="button" className="cm-p-button" disabled={busy} onClick={async () => {
        if (await onImport(png.slice(png.indexOf(',') + 1))) setPng('')
      }}>{sendImage ? '确认导入并发送给已授权模型' : '确认导入截图'}</button>
      <button type="button" className="cm-p-link" disabled={busy} onClick={() => setPng('')}>丢弃截图</button>
    </div>}
  </div>
}
