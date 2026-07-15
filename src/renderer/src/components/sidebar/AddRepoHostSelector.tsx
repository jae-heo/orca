import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { SidebarHostOption } from './sidebar-host-options'
import { getSidebarHostHealthLabel } from './sidebar-host-options'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { describeRuntimeCompatBlock } from '../../../../shared/protocol-compat'
import { translate } from '@/i18n/i18n'
import { canConnectAddRepoHost, canSelectAddRepoHost } from './add-repo-host-availability'

type AddRepoHostSelectorProps = {
  sources: SidebarHostOption[]
  selectedSourceId: ExecutionHostId
  sourceOpen: boolean
  onSourceOpenChange: (open: boolean) => void
  onSelectSource: (sourceId: ExecutionHostId) => void
  hosts: SidebarHostOption[]
  selectedHostId: ExecutionHostId
  hostOpen: boolean
  onHostOpenChange: (open: boolean) => void
  onSelectHost: (hostId: ExecutionHostId) => void
  onConnectHost?: (hostId: ExecutionHostId) => void
  onAddSshHost?: () => void
  onAddRemoteServer?: () => void
}

function getHostStatusDetail(host: SidebarHostOption): string {
  if (host.compatibility?.kind === 'blocked') {
    return describeRuntimeCompatBlock(host.compatibility)
  }
  return `${getSidebarHostHealthLabel(host.health)}${host.detail ? ` - ${host.detail}` : ''}`
}

type RoutePickerProps = {
  label: string
  options: SidebarHostOption[]
  selectedId: ExecutionHostId
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: ExecutionHostId) => void
  onConnect?: (id: ExecutionHostId) => void
  addAction?: { label: string; detail: string; onSelect: () => void }
}

function AddRepoRoutePicker({
  label,
  options,
  selectedId,
  open,
  onOpenChange,
  onSelect,
  onConnect,
  addAction
}: RoutePickerProps): React.JSX.Element | null {
  const selected = options.find((option) => option.id === selectedId) ?? options[0]
  if (!selected) {
    return null
  }

  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-2 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            className="h-8 min-w-0 justify-between gap-2 bg-input px-2.5 text-xs font-medium"
          >
            <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span>
            <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
              {getSidebarHostHealthLabel(selected.health)}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(360px,calc(100vw-1rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandList>
              {options.map((option) => {
                const isSelected = option.id === selectedId
                const disabled = !canSelectAddRepoHost(option)
                const canConnect = canConnectAddRepoHost(option)
                const isConnecting = option.health === 'connecting'
                return (
                  <CommandItem
                    key={option.id}
                    value={`${option.label} ${option.detail}`}
                    disabled={disabled && !canConnect}
                    aria-disabled={disabled}
                    onSelect={() => {
                      if (disabled) {
                        return
                      }
                      onSelect(option.id)
                      onOpenChange(false)
                    }}
                    className={cn(
                      'items-start gap-2 px-3 py-2 text-xs',
                      disabled && !canConnect && 'cursor-not-allowed opacity-55'
                    )}
                  >
                    <Check
                      className={cn(
                        'mt-0.5 size-3 text-muted-foreground',
                        isSelected ? 'opacity-70' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {getHostStatusDetail(option)}
                      </span>
                    </span>
                    {canConnect ? (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="ml-2 h-auto w-[5.75rem] shrink-0 justify-end gap-1 self-center px-0 py-0 text-[11px] font-normal text-muted-foreground hover:text-foreground hover:no-underline"
                        disabled={isConnecting}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onConnect?.(option.id)
                        }}
                      >
                        {isConnecting ? <Loader2 className="size-3 animate-spin" /> : null}
                        {isConnecting
                          ? translate(
                              'auto.components.sidebar.AddRepoHostSelector.connecting',
                              'Connecting'
                            )
                          : translate(
                              'auto.components.sidebar.AddRepoHostSelector.connect',
                              'Connect'
                            )}
                      </Button>
                    ) : null}
                  </CommandItem>
                )
              })}
              {addAction ? (
                <CommandItem
                  value={`${addAction.label} ${addAction.detail}`}
                  onSelect={() => {
                    onOpenChange(false)
                    addAction.onSelect()
                  }}
                  className="items-start gap-2 border-t border-border px-3 py-2 text-xs"
                >
                  <Plus className="mt-0.5 size-3 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{addAction.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {addAction.detail}
                    </span>
                  </span>
                </CommandItem>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function AddRepoHostSelector({
  sources,
  selectedSourceId,
  sourceOpen,
  onSourceOpenChange,
  onSelectSource,
  hosts,
  selectedHostId,
  hostOpen,
  onHostOpenChange,
  onSelectHost,
  onConnectHost,
  onAddSshHost,
  onAddRemoteServer
}: AddRepoHostSelectorProps): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/25 p-2.5">
      <AddRepoRoutePicker
        label={translate('auto.components.sidebar.AddRepoHostSelector.from', 'From')}
        options={sources}
        selectedId={selectedSourceId}
        open={sourceOpen}
        onOpenChange={onSourceOpenChange}
        onSelect={onSelectSource}
        addAction={
          onAddRemoteServer
            ? {
                label: translate(
                  'auto.components.sidebar.AddRepoHostSelector.addRemoteServer',
                  'Add remote server'
                ),
                detail: translate(
                  'auto.components.sidebar.AddRepoHostSelector.addRemoteServerDetail',
                  'Pair with Orca running on another computer.'
                ),
                onSelect: onAddRemoteServer
              }
            : undefined
        }
      />
      <AddRepoRoutePicker
        label={translate('auto.components.sidebar.AddRepoHostSelector.host', 'Host')}
        options={hosts}
        selectedId={selectedHostId}
        open={hostOpen}
        onOpenChange={onHostOpenChange}
        onSelect={onSelectHost}
        onConnect={onConnectHost}
        addAction={
          onAddSshHost
            ? {
                label: translate(
                  'auto.components.sidebar.AddRepoHostSelector.addSshHost',
                  'Add SSH host'
                ),
                detail: translate(
                  'auto.components.sidebar.AddRepoHostSelector.addSshHostForSourceDetail',
                  'Add it to the selected source server.'
                ),
                onSelect: onAddSshHost
              }
            : undefined
        }
      />
    </div>
  )
}
