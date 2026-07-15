import type { SidebarHostOption } from './sidebar-host-options'

export function canSelectAddRepoHost(host: Pick<SidebarHostOption, 'health' | 'kind'>): boolean {
  return (
    host.health === 'local' ||
    host.health === 'available' ||
    // Why: a runtime's shared remote-control channel may be reconnecting even
    // while status.get is reachable. Selecting the server performs its own
    // reachability probe, so do not turn that transient diagnostic into a
    // permanently disabled From option.
    (host.kind === 'runtime' && host.health === 'connecting')
  )
}

export function canConnectAddRepoHost(host: Pick<SidebarHostOption, 'health' | 'kind'>): boolean {
  return (
    host.kind === 'ssh' &&
    (host.health === 'disconnected' || host.health === 'error' || host.health === 'connecting')
  )
}
