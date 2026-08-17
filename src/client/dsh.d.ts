declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react'

  export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error'
  export function StateDot(props: { state: StateDotState; size?: number; className?: string }): ReactNode
  export function Button(props: {
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement>): ReactNode
  export function DisclosureRow(props: {
    icon: ReactNode
    title: string
    open: boolean
    expandable: boolean
    onToggle: () => void
    expandOnRowClick?: boolean
    collapsedContent?: ReactNode
    children?: ReactNode
    className?: string
    titleClassName?: string
  }): ReactNode
  export function Tooltip(props: {
    label: string | (() => string)
    side?: 'right' | 'bottom' | 'top'
    children: ReactNode
  }): ReactNode
  export function Pill(props: {
    active?: boolean
    className?: string
    children?: ReactNode
    onClick?: () => void
  }): ReactNode
  export interface MenuItem { id: string; label: ReactNode }
  export function Menu(props: {
    open: boolean
    anchor: ReactNode
    items: readonly MenuItem[]
    selectedId?: string
    onSelect: (id: string) => void
    onClose: () => void
  }): ReactNode
  export function writeClipboard(text: string): Promise<void>
  export const IconGlobeOutline14: (props: { size?: number; className?: string }) => JSX.Element
  export const IconWarningOutline16: (props: { size?: number; className?: string }) => JSX.Element
  export const IconCheckOutline16: (props: { size?: number; className?: string }) => JSX.Element
  export const IconRefreshOutline16: (props: { size?: number; className?: string }) => JSX.Element
  export const IconCloseOutline16: (props: { size?: number; className?: string }) => JSX.Element
}
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ReactNode } from 'react'
  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    closeLabel?: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
    headless?: boolean
  }): import('react').ReactPortal | null
}
