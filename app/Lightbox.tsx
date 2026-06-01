'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export default function Lightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const scaleRef = useRef(1)
  const fitScaleRef = useRef(1)
  const posRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const didDragRef = useRef(false)
  const downPosRef = useRef({ x: 0, y: 0 })
  const dragStartRef = useRef({ x: 0, y: 0 })
  const pinchRef = useRef<{ dist: number; scale: number; midX: number; midY: number; posX: number; posY: number } | null>(null)
  const lastTapRef = useRef(0)

  const applyTransform = useCallback((pos: { x: number; y: number }, s: number, animated = false) => {
    posRef.current = pos
    scaleRef.current = s
    if (imageRef.current) {
      imageRef.current.style.transition = animated ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
      imageRef.current.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${s})`
    }
  }, [])

  const handleImageLoad = useCallback(() => {
    if (!imageRef.current) return
    const { naturalWidth, naturalHeight } = imageRef.current
    const vw = window.innerWidth
    const vh = window.innerHeight
    const fit = Math.min(vw / naturalWidth, vh / naturalHeight)
    fitScaleRef.current = fit
    applyTransform({ x: 0, y: 0 }, fit)
  }, [applyTransform])

  useEffect(() => {
    fitScaleRef.current = 1
    applyTransform({ x: 0, y: 0 }, 1)
  }, [url, applyTransform])

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const base = e.ctrlKey ? 0.97 : 0.999
      const factor = Math.pow(base, e.deltaY)
      const newScale = Math.min(Math.max(scaleRef.current * factor, fitScaleRef.current), 20)
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const ratio = newScale / scaleRef.current
      applyTransform({
        x: (e.clientX - cx) * (1 - ratio) + posRef.current.x * ratio,
        y: (e.clientY - cy) * (1 - ratio) + posRef.current.y * ratio,
      }, newScale)
    }
    const block = (e: TouchEvent) => e.preventDefault()
    const container = containerRef.current
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false })
      container.addEventListener('touchmove', block, { passive: false })
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', handleWheel)
        container.removeEventListener('touchmove', block)
      }
    }
  }, [applyTransform])

  const handleDoubleClick = useCallback(() => {
    if (scaleRef.current > fitScaleRef.current * 1.05) applyTransform({ x: 0, y: 0 }, fitScaleRef.current, true)
    else applyTransform(posRef.current, fitScaleRef.current * 3, true)
  }, [applyTransform])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    didDragRef.current = false
    downPosRef.current = { x: e.clientX, y: e.clientY }
    isDraggingRef.current = true
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (Math.abs(e.clientX - downPosRef.current.x) > 5 || Math.abs(e.clientY - downPosRef.current.y) > 5)
      didDragRef.current = true
    if (isDraggingRef.current)
      applyTransform({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y }, scaleRef.current)
  }, [applyTransform])

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false
    setIsDragging(false)
    if (!didDragRef.current) onClose()
  }, [onClose])

  const pinchDist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      didDragRef.current = false
      downPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      dragStartRef.current = { x: e.touches[0].clientX - posRef.current.x, y: e.touches[0].clientY - posRef.current.y }
    } else if (e.touches.length === 2) {
      didDragRef.current = true
      pinchRef.current = {
        dist: pinchDist(e.touches),
        scale: scaleRef.current,
        midX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        midY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        posX: posRef.current.x,
        posY: posRef.current.y,
      }
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const p = pinchRef.current
      const newScale = Math.min(Math.max(p.scale * (pinchDist(e.touches) / p.dist), fitScaleRef.current), 20)
      const curMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const curMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      const ratio = newScale / p.scale
      applyTransform({
        x: (p.midX - cx) * (1 - ratio) + p.posX * ratio + (curMidX - p.midX),
        y: (p.midY - cy) * (1 - ratio) + p.posY * ratio + (curMidY - p.midY),
      }, newScale)
    } else if (e.touches.length === 1) {
      if (Math.abs(e.touches[0].clientX - downPosRef.current.x) > 5 || Math.abs(e.touches[0].clientY - downPosRef.current.y) > 5)
        didDragRef.current = true
      applyTransform({ x: e.touches[0].clientX - dragStartRef.current.x, y: e.touches[0].clientY - dragStartRef.current.y }, scaleRef.current)
    }
  }, [applyTransform])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    if (e.touches.length === 1) {
      pinchRef.current = null
      dragStartRef.current = { x: e.touches[0].clientX - posRef.current.x, y: e.touches[0].clientY - posRef.current.y }
      return
    }
    pinchRef.current = null
    if (didDragRef.current) return
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0
      if (scaleRef.current > fitScaleRef.current * 1.05) applyTransform({ x: 0, y: 0 }, fitScaleRef.current, true)
      else applyTransform(posRef.current, fitScaleRef.current * 3, true)
    } else {
      lastTapRef.current = now
      setTimeout(() => { if (lastTapRef.current === now) onClose() }, 300)
    }
  }, [onClose, applyTransform])

  return (
    <div
      ref={containerRef}
      className="lightbox"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {url ? (
        <img
          ref={imageRef}
          src={url}
          alt=""
          className="lightbox-image"
          draggable={false}
          onLoad={handleImageLoad}
          style={{ pointerEvents: 'none', willChange: 'transform' }}
        />
      ) : (
        <div className="lightbox-loading" />
      )}
    </div>
  )
}
