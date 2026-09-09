/** Image renderer that advances through avatar fallbacks after load errors. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'

export interface ArtworkImageProps {
  readonly sources: readonly string[]
  readonly className?: string
  readonly fallback?: ReactNode
}

export function ArtworkImage({ sources, className, fallback = null }: ArtworkImageProps) {
  const key = sources.join('\u0000')
  const stableSources = useMemo(() => sources, [key])
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [key])
  const source = stableSources[index]
  if (source === undefined) return fallback
  return (
    <img
      className={className}
      src={source}
      alt=""
      aria-hidden
      onError={() => { setIndex((current) => current + 1) }}
    />
  )
}
