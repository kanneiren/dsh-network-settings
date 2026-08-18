/** Small tag badges for operation/action metadata rows. Signal-only badges:
 *  scope plus the notable requirements (admin / reboot / recoverability) —
 *  "no admin needed" style noise is omitted to keep rows scannable. */
import type { ReactNode } from 'react'
import css from './NetworkTab.module.css'

export function MetaBadges({ labels }: { labels: string[] }): ReactNode {
  return (
    <div className={css.metaBadges}>
      {labels.map(label => <span key={label} className={css.detailTag}>{label}</span>)}
    </div>
  )
}
