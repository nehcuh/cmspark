// Composer file ingest — cut out of App.tsx InputArea in #321 PR-7.
// Pure move: selected-files state, dest-ack cache, paste/drag/drop/file-input.

import { useCallback, useEffect, useRef, useState } from "react"
import type { FileAttachment } from "../types"
import { useAgentStore } from "../store/agentStore"
import {
  IMAGE_GIF_SHRINK_FIRST,
  IMAGE_MAX_DECODED,
  checkComposerImageCaps,
  classifyDrop,
  compressImageBlob,
  imageTypeRefuseReason,
  isAllowlistedImageMime,
  mimeFromName,
  needsCompress,
  nextFileErrorAfterIngest,
  pasteImageDisplayName,
} from "../utils/image-compose"

export type UseComposerIngestOpts = {
  ingestBlocked: boolean
  textRef: { current: string }
}

export function useComposerIngest({
  ingestBlocked,
  textRef,
}: UseComposerIngestOpts) {
  const { state } = useAgentStore()
  const [selectedFiles, setSelectedFiles] = useState<FileAttachment[]>([])
  const [fileError, setFileError] = useState("")
  const [destAck, setDestAck] = useState("")
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const selectedFilesRef = useRef(selectedFiles)
  selectedFilesRef.current = selectedFiles
  const dragDepthRef = useRef(0)
  const ingestBlockedRef = useRef(ingestBlocked)
  ingestBlockedRef.current = ingestBlocked
  const destAckRef = useRef<Record<string, string>>({})
  const gestureSendRef = useRef<(files: FileAttachment[]) => void>(() => {})
  useEffect(() => {
    try {
      chrome.storage.local.get(null, (all) => {
        if (chrome.runtime.lastError) return
        const next: Record<string, string> = {}
        for (const [k, v] of Object.entries(all || {})) {
          if (k.startsWith("cmspark.imageDestAck.")) next[k] = String(v ?? "")
        }
        destAckRef.current = { ...next, ...destAckRef.current }
      })
    } catch {
      /* ignore */
    }
  }, [])
  const uploadClearSeq = state.composerUploadClearSeq
  const uploadClearSeen = useRef(uploadClearSeq)
  useEffect(() => {
    if (uploadClearSeq !== uploadClearSeen.current) {
      uploadClearSeen.current = uploadClearSeq
      setSelectedFiles([])
    }
  }, [uploadClearSeq])
  const readFileAsBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(",")[1] || "")
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })

  const addIncomingFiles = async (
    list: File[],
    opts: { fromGesture?: boolean; fromPaste?: boolean },
  ) => {
    if (ingestBlockedRef.current) return
    const maxDocSize = 10 * 1024 * 1024
    const incoming: FileAttachment[] = []
    let addedImages = 0
    let refuse: string | undefined
    // F5: first per-file rejection survives the post-loop banner merge —
    // otherwise a mixed batch (some accepted, some refused) erases the error
    // and the refused files vanish silently.
    let firstErr: string | undefined
    for (const file of list) {
      const type = file.type || mimeFromName(file.name)
      const refuseReason = imageTypeRefuseReason(type)
      if (refuseReason) {
        refuse = refuseReason
        continue
      }
      const isImage = isAllowlistedImageMime(type)
      if (!isImage && file.size > maxDocSize) {
        if (!firstErr) firstErr = `文件 "${file.name}" 超过 10MB 限制`
        continue
      }
      if (isImage && file.size > IMAGE_MAX_DECODED && /^image\/gif$/i.test(type.split(";")[0].trim())) {
        if (!firstErr) firstErr = IMAGE_GIF_SHRINK_FIRST
        continue
      }
      try {
        let working: Blob = file
        let workingType = type
        let compressed = false
        if (isImage && needsCompress(file.size)) {
          const result = await compressImageBlob(file)
          working = result.blob
          workingType = result.blob.type || type
          compressed = result.compressed
        } else if (isImage) {
          // Dimension-only compress when canvas can decode (no-op in node).
          try {
            const result = await compressImageBlob(file)
            working = result.blob
            workingType = result.blob.type || type
            compressed = result.compressed
          } catch {
            working = file
          }
        }
        const base64 = await readFileAsBase64(working)
        const name = opts.fromPaste
          ? pasteImageDisplayName(file.name)
          : file.name || pasteImageDisplayName("")
        incoming.push({
          name,
          type: workingType,
          size: working.size,
          content: base64,
          ...(compressed ? { compressed: true } : {}),
        })
        if (isImage) addedImages += 1
      } catch (err) {
        const msg = err instanceof Error ? err.message : "添加文件失败"
        if (!firstErr) firstErr = msg
      }
    }
    if (incoming.length === 0) {
      const err = nextFileErrorAfterIngest({ refuse, loopErr: firstErr })
      if (err) setFileError(err)
      return
    }

    const nextFiles = [...selectedFilesRef.current, ...incoming]
    const capErr = checkComposerImageCaps(nextFiles.filter((f) => isAllowlistedImageMime(f.type)))
    setFileError(nextFileErrorAfterIngest({ refuse, capErr, loopErr: firstErr }))
    if (capErr) return
    setSelectedFiles(nextFiles)
    selectedFilesRef.current = nextFiles

    // Mixed send: typed text + gesture-added images → send with explicit array.
    if (opts.fromGesture && addedImages > 0 && textRef.current.trim()) {
      gestureSendRef.current(nextFiles)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    await addIncomingFiles(Array.from(files), { fromGesture: false })
    e.target.value = ""
  }

  const handleComposerPaste = (e: React.ClipboardEvent) => {
    if (e.defaultPrevented) return
    if (ingestBlockedRef.current) return
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== "file") continue
      const f = item.getAsFile()
      if (!f) continue
      const type = item.type || mimeFromName(f.name)
      if (isAllowlistedImageMime(type) || type.startsWith("image/")) {
        imageFiles.push(f)
      }
    }
    if (imageFiles.length === 0) return
    // Keep typed text. Do not let the browser insert an HTML <img>.
    e.preventDefault()
    void addIncomingFiles(imageFiles, { fromGesture: true, fromPaste: true })
  }

  const handleComposerDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (ingestBlockedRef.current) {
      e.dataTransfer.dropEffect = "none"
      return
    }
    e.dataTransfer.dropEffect = "copy"
    setDragOver(true)
  }

  const handleComposerDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (ingestBlockedRef.current) return
    dragDepthRef.current += 1
    setDragOver(true)
  }

  const handleComposerDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }

  const handleComposerDrop = (e: React.DragEvent) => {
    dragDepthRef.current = 0
    setDragOver(false)
    if (ingestBlockedRef.current) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    const types = Array.from(e.dataTransfer?.types || [])
    const rawFiles = Array.from(e.dataTransfer?.files || [])
    const verdict = classifyDrop(
      types,
      rawFiles.map((f) => ({ type: f.type, size: f.size, name: f.name })),
    )
    if (verdict.ok === false) {
      setFileError(verdict.error)
      return
    }
    // NEVER fetch — only local File objects from the drop.
    void addIncomingFiles(rawFiles, { fromGesture: true })
  }

  const removeFile = useCallback((idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
  }, [])

  return {
    selectedFiles,
    setSelectedFiles,
    selectedFilesRef,
    fileError,
    setFileError,
    destAck,
    setDestAck,
    destAckRef,
    dragOver,
    fileInputRef,
    handleFileSelect,
    handleComposerPaste,
    handleComposerDragOver,
    handleComposerDragEnter,
    handleComposerDragLeave,
    handleComposerDrop,
    removeFile,
    gestureSendRef,
  }
}
