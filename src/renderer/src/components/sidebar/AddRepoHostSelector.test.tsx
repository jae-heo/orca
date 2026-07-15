import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AddRepoHostSelector } from './AddRepoHostSelector'

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandItem: ({
    children,
    disabled,
    className,
    'aria-disabled': ariaDisabled
  }: {
    children: React.ReactNode
    disabled?: boolean
    className?: string
    'aria-disabled'?: React.AriaAttributes['aria-disabled']
  }) => (
    <div aria-disabled={ariaDisabled ?? disabled} className={className}>
      {children}
    </div>
  )
}))

describe('AddRepoHostSelector', () => {
  const localSource = {
    id: 'local' as const,
    label: 'Local Mac',
    detail: 'This computer',
    kind: 'local' as const,
    health: 'local' as const,
    presence: 'local' as const
  }

  it('shows separate From and Host controls with scoped setup actions', () => {
    const html = renderToStaticMarkup(
      <AddRepoHostSelector
        sources={[localSource]}
        selectedSourceId="local"
        sourceOpen
        onSourceOpenChange={vi.fn()}
        onSelectSource={vi.fn()}
        hosts={[{ ...localSource, label: 'This computer', detail: 'Local Mac' }]}
        selectedHostId="local"
        hostOpen
        onHostOpenChange={vi.fn()}
        onSelectHost={vi.fn()}
        onAddSshHost={vi.fn()}
        onAddRemoteServer={vi.fn()}
      />
    )

    expect(html).toContain('From')
    expect(html).toContain('Host')
    expect(html).toContain('Add SSH host')
    expect(html).toContain('Add it to the selected source server.')
    expect(html).toContain('Add remote server')
    expect(html).toContain('Pair with Orca running on another computer.')
  })

  it('shows disconnected SSH hosts with a connect action in Add Project', () => {
    const html = renderToStaticMarkup(
      <AddRepoHostSelector
        sources={[localSource]}
        selectedSourceId="local"
        sourceOpen={false}
        onSourceOpenChange={vi.fn()}
        onSelectSource={vi.fn()}
        hosts={[
          { ...localSource, label: 'This computer', detail: 'Local Mac' },
          {
            id: 'ssh:ssh-1',
            label: 'Builder',
            detail: 'SSH',
            kind: 'ssh',
            health: 'disconnected',
            presence: 'configured'
          }
        ]}
        selectedHostId="ssh:ssh-1"
        hostOpen={false}
        onHostOpenChange={vi.fn()}
        onSelectHost={vi.fn()}
      />
    )

    expect(html).toContain('Builder')
    expect(html).toContain('Disconnected')
    expect(html).toContain('Connect')
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('cursor-not-allowed')
    expect(html).not.toContain('opacity-55')
  })

  it('shows exact update guidance for incompatible runtime hosts', () => {
    const html = renderToStaticMarkup(
      <AddRepoHostSelector
        sources={[
          localSource,
          {
            id: 'runtime:old-server',
            label: 'Old server',
            detail: 'Orca server',
            kind: 'runtime',
            health: 'blocked',
            presence: 'active',
            compatibility: {
              kind: 'blocked',
              reason: 'server-too-old',
              clientProtocolVersion: 5,
              serverProtocolVersion: 1,
              requiredServerProtocolVersion: 4
            }
          }
        ]}
        selectedSourceId="runtime:old-server"
        sourceOpen
        onSourceOpenChange={vi.fn()}
        onSelectSource={vi.fn()}
        hosts={[localSource]}
        selectedHostId="runtime:old-server"
        hostOpen={false}
        onHostOpenChange={vi.fn()}
        onSelectHost={vi.fn()}
      />
    )

    expect(html).toContain('Update needed')
    expect(html).toContain('The selected Orca server is too old for this client.')
    expect(html).toContain('Update Orca on the server.')
    expect(html).toContain('aria-disabled="true"')
  })
})
