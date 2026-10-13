import * as React from "react"

import { cn } from "@/lib/utils"
import type { Locale } from "@/i18n/config"

interface LocaleFlagProps {
  locale: Locale
  className?: string
}

// Emoji flags don't render on Windows, and the full flag-icons set is too large.
// Add one SVG per LOCALES entry; Spain uses the small civil ensign because the
// full crest is unreadable here and its SVG is about 80KB.
const FLAG_SVGS: Record<Locale, React.ReactNode> = {
  en: (
    <svg viewBox="0 0 640 480" className="h-full w-full" role="presentation">
      <path fill="#bd3d44" d="M0 0h640v480H0" />
      <path
        stroke="#fff"
        strokeWidth="37"
        d="M0 55.3h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640"
      />
      <path fill="#192f5d" d="M0 0h364.8v258.5H0" />
      <marker id="locale-flag-us-star" markerHeight="30" markerWidth="30">
        <path fill="#fff" d="m14 0 9 27L0 10h28L5 27z" />
      </marker>
      <path
        fill="none"
        markerMid="url(#locale-flag-us-star)"
        d="m0 0 16 11h61 61 61 61 60L47 37h61 61 60 61L16 63h61 61 61 61 60L47 89h61 61 60 61L16 115h61 61 61 61 60L47 141h61 61 60 61L16 166h61 61 61 61 60L47 192h61 61 60 61L16 218h61 61 61 61 60z"
      />
    </svg>
  ),
  es: (
    <svg viewBox="0 0 640 480" className="h-full w-full" role="presentation">
      <path fill="#AA151B" d="M0 0h640v480H0z" />
      <path fill="#F1BF00" d="M0 120h640v240H0z" />
    </svg>
  ),
  zh: (
    <svg viewBox="0 0 30 24" className="h-full w-full" role="presentation">
      <path fill="#DE2910" d="M0 0h30v24H0z" />
      <path
        fill="#FFDE00"
        d="M5 2 5.674 4.073 7.853 4.073 6.09 5.354 6.763 7.427 5 6.146 3.237 7.427 3.91 5.354 2.147 4.073 4.326 4.073zM10 1 10.328 1.803 11.168 1.803 10.5 2.372 10.824 3.175 10 2.643 9.176 3.175 9.5 2.372 8.832 1.803 9.672 1.803zM12 3.5 12.378 4.054 12.884 3.533 12.718 4.696 13.168 5.25 12.378 5.146 11.829 5.75 11.726 4.734 11.01 4.25 11.662 4.179zM12 6.5 12.367 6.895 12.939 7.343 12.213 7.317 11.964 7.999 11.442 7.25 11.641 6.869 11.038 7.275 11.765 7.301zM10 9 10.298 8.761 10.265 8.036 10.865 8.643 11.641 8.45 11.319 9.21 10.999 9.954 10 9.382 9.001 9.954 9.165 8.45 9.618 9.018 9.219 9.625z"
      />
    </svg>
  ),
}

export function LocaleFlag({ locale, className }: LocaleFlagProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-4 w-[1.35rem] shrink-0 items-center overflow-hidden rounded-[2px] ring-1 ring-black/10 dark:ring-white/15",
        className
      )}
    >
      {FLAG_SVGS[locale]}
    </span>
  )
}
