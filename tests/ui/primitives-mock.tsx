import type { ReactNode, ButtonHTMLAttributes } from 'react'

export function StateDot({ state, className }: { state: string; className?: string }): JSX.Element {
  return <span data-testid="state-dot" data-state={state} className={className} />
}

export function Button({ children, icon, onClick, disabled, variant }: {
  children?: ReactNode
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: string
} & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return <button type="button" disabled={disabled} onClick={onClick} data-variant={variant}>{icon}{children}</button>
}

export function DisclosureRow({ title, open, children, collapsedContent, onToggle }: {
  title: string
  open: boolean
  children?: ReactNode
  collapsedContent?: ReactNode
  onToggle: () => void
}): JSX.Element {
  return (
    <div>
      <button type="button" onClick={onToggle}>{title}{collapsedContent}</button>
      {open ? <div>{children}</div> : null}
    </div>
  )
}

export function Tooltip({ children }: { children?: ReactNode }): JSX.Element {
  return <>{children}</>
}

export function Pill({ children, active, onClick }: { children?: ReactNode; active?: boolean; onClick?: () => void }): JSX.Element {
  return <span data-active={active === true ? 'true' : undefined} onClick={onClick}>{children}</span>
}

export function Menu({ open, anchor, items, onSelect }: {
  open: boolean
  anchor: ReactNode
  items: readonly { id: string; label: ReactNode }[]
  selectedId?: string
  onSelect: (id: string) => void
  onClose: () => void
}): JSX.Element {
  return (
    <span>
      {anchor}
      {open ? <div role="menu">{items.map(item => <button type="button" key={item.id} onClick={() => { onSelect(item.id) }}>{item.label}</button>)}</div> : null}
    </span>
  )
}

export async function writeClipboard(_text: string): Promise<void> {}

export function IconGlobeOutline14({ size }: { size?: number }): JSX.Element {
  return <span data-icon="globe" data-size={size} />
}

export function IconWarningOutline16({ size }: { size?: number }): JSX.Element {
  return <span data-icon="warning" data-size={size} />
}

export function IconCheckOutline16({ size }: { size?: number }): JSX.Element {
  return <span data-icon="check" data-size={size} />
}

export function IconRefreshOutline16({ size }: { size?: number }): JSX.Element {
  return <span data-icon="refresh" data-size={size} />
}

export function IconCloseOutline16({ size }: { size?: number }): JSX.Element {
  return <span data-icon="close" data-size={size} />
}

export function Modal({ open, title, description, children, footer, onClose }: {
  open: boolean
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
}): JSX.Element | null {
  if (!open) return null
  return (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {description === undefined ? null : <p>{description}</p>}
      <div>{children}</div>
      <div>{footer}</div>
      <button type="button" onClick={onClose}>close</button>
    </div>
  )
}
