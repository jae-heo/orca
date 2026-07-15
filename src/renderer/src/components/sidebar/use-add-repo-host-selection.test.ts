import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'
import type { SidebarHostOption } from './sidebar-host-options'

const mocks = vi.hoisted(() => ({
  stateValues: [] as unknown[],
  stateSetters: [] as ReturnType<typeof vi.fn>[],
  stateIndex: 0,
  refValues: [] as unknown[],
  refIndex: 0,
  hostOptions: [] as SidebarHostOption[],
  storeState: {
    settings: { activeRuntimeEnvironmentId: null as string | null },
    switchRuntimeEnvironment: vi.fn(),
    setSshConnectionState: vi.fn(),
    setEnvironmentSshConnectionState: vi.fn(),
    sshConnectionStates: new Map(),
    sshStateByEnvironment: new Map(),
    runtimeEnvironments: [] as { id: string; name: string; source?: 'manual' | 'ephemeral-vm' }[]
  },
  sshConnect: vi.fn(),
  sshGetState: vi.fn(),
  hydrateEnvironmentSsh: vi.fn(),
  connectEnvironmentSsh: vi.fn()
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useMemo: <T>(factory: () => T) => factory(),
    useEffect: (effect: () => void | (() => void)) => {
      effect()
    },
    useRef: <T>(value: T) => {
      const index = mocks.refIndex++
      return {
        current: index in mocks.refValues ? (mocks.refValues[index] as T) : value
      }
    },
    useState: <T>(initial: T | (() => T)) => {
      const index = mocks.stateIndex++
      const value =
        index in mocks.stateValues
          ? mocks.stateValues[index]
          : typeof initial === 'function'
            ? (initial as () => T)()
            : initial
      const setter = vi.fn()
      mocks.stateSetters[index] = setter
      return [value as T, setter]
    }
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.storeState) => unknown) => selector(mocks.storeState)
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn()
  }
}))

vi.mock('./use-sidebar-host-scope-options', () => ({
  useSidebarHostScopeOptions: () => ({ hostOptions: mocks.hostOptions })
}))

vi.mock('@/runtime/runtime-environment-ssh-state', () => ({
  hydrateRuntimeEnvironmentSshState: mocks.hydrateEnvironmentSsh,
  connectRuntimeEnvironmentSshTarget: mocks.connectEnvironmentSsh
}))

describe('useAddRepoHostSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.stateIndex = 0
    mocks.stateSetters = []
    mocks.refIndex = 0
    mocks.refValues = []
    mocks.hostOptions = [
      {
        id: 'local',
        label: 'Local Mac',
        detail: 'This computer',
        kind: 'local',
        health: 'local',
        presence: 'local'
      },
      {
        id: 'ssh:ssh-1',
        label: 'Builder',
        detail: 'SSH',
        kind: 'ssh',
        health: 'available',
        presence: 'configured'
      },
      {
        id: 'runtime:env-1',
        label: 'Server',
        detail: 'Runtime',
        kind: 'runtime',
        health: 'available',
        presence: 'active'
      }
    ]
    mocks.storeState.settings = { activeRuntimeEnvironmentId: null }
    mocks.storeState.switchRuntimeEnvironment.mockResolvedValue(true)
    mocks.storeState.sshConnectionStates = new Map()
    mocks.storeState.sshStateByEnvironment = new Map()
    mocks.storeState.runtimeEnvironments = []
    mocks.sshConnect.mockReset()
    mocks.sshGetState.mockReset()
    mocks.hydrateEnvironmentSsh.mockReset().mockResolvedValue(undefined)
    mocks.connectEnvironmentSsh.mockReset()
    vi.stubGlobal('window', {
      api: {
        ssh: {
          connect: mocks.sshConnect,
          getState: mocks.sshGetState
        }
      }
    })
  })

  it('exposes the selected SSH target id', async () => {
    mocks.stateValues = ['local', 'ssh:ssh-1', false, false]
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep: vi.fn() })

    expect(result.selectedHostId).toBe('ssh:ssh-1')
    expect(result.selectedHostParsed).toMatchObject({ kind: 'ssh', targetId: 'ssh-1' })
    expect(result.selectedSshTargetId).toBe('ssh-1')
  })

  it('switches runtime before selecting a From server', async () => {
    mocks.stateValues = ['local', 'local', false, false]
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleSelectAddProjectSource('runtime:env-1')

    expect(mocks.storeState.switchRuntimeEnvironment).toHaveBeenCalledWith('env-1')
    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('runtime:env-1')
    expect(mocks.stateSetters[1]).toHaveBeenCalledWith('runtime:env-1')
    expect(setStep).toHaveBeenCalledWith('add')
  })

  it('lets a reconnecting runtime From server run the reachability probe', async () => {
    mocks.stateValues = ['local', 'local', false, false]
    mocks.hostOptions[2] = {
      ...mocks.hostOptions[2],
      health: 'connecting'
    }
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleSelectAddProjectSource('runtime:env-1')

    expect(mocks.storeState.switchRuntimeEnvironment).toHaveBeenCalledWith('env-1')
    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('runtime:env-1')
    expect(mocks.stateSetters[1]).toHaveBeenCalledWith('runtime:env-1')
    expect(setStep).toHaveBeenCalledWith('add')
  })

  it('clears the active runtime before selecting the local From source', async () => {
    mocks.stateValues = ['runtime:env-1', 'runtime:env-1', false, false]
    mocks.storeState.settings = { activeRuntimeEnvironmentId: 'env-1' }
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleSelectAddProjectSource('local')

    expect(mocks.storeState.switchRuntimeEnvironment).toHaveBeenCalledWith(null)
    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('local')
    expect(mocks.stateSetters[1]).toHaveBeenCalledWith('local')
    expect(setStep).toHaveBeenCalledWith('add')
  })

  it('keeps a disconnected Host visible so it can be connected inline', async () => {
    mocks.stateValues = ['local', 'ssh:ssh-1', false, false]
    mocks.hostOptions[1] = {
      ...mocks.hostOptions[1],
      health: 'disconnected'
    }
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep: vi.fn() })

    expect(result.selectedHostId).toBe('ssh:ssh-1')
    expect(result.selectedSshTargetId).toBe('ssh-1')
  })

  it('does not select a disconnected SSH host', async () => {
    mocks.stateValues = ['local', 'local', false, false]
    mocks.hostOptions[1] = {
      ...mocks.hostOptions[1],
      health: 'disconnected'
    }
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleSelectAddProjectHost('ssh:ssh-1')

    expect(mocks.storeState.switchRuntimeEnvironment).not.toHaveBeenCalled()
    expect(mocks.stateSetters[1]).not.toHaveBeenCalledWith('ssh:ssh-1')
    expect(setStep).not.toHaveBeenCalled()
  })

  it('connects and selects a disconnected SSH host from Add Project', async () => {
    mocks.stateValues = ['local', 'local', false, true]
    mocks.hostOptions[1] = {
      ...mocks.hostOptions[1],
      health: 'disconnected'
    }
    mocks.sshConnect.mockResolvedValue({
      targetId: 'ssh-1',
      status: 'connected',
      error: null,
      reconnectAttempt: 0
    })
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })
    await result.handleConnectAddProjectHost('ssh:ssh-1')

    expect(mocks.storeState.setSshConnectionState).toHaveBeenCalledWith(
      'ssh-1',
      expect.objectContaining({ status: 'connecting' })
    )
    expect(mocks.sshConnect).toHaveBeenCalledWith({ targetId: 'ssh-1' })
    expect(mocks.storeState.setSshConnectionState).toHaveBeenCalledWith(
      'ssh-1',
      expect.objectContaining({ status: 'connected' })
    )
    expect(mocks.stateSetters[1]).toHaveBeenCalledWith('ssh:ssh-1')
    expect(mocks.stateSetters[3]).toHaveBeenCalledWith(false)
    expect(setStep).toHaveBeenCalledWith('add')
  })

  it('does not auto-select the active runtime host while it is unavailable', async () => {
    mocks.stateValues = ['local', 'local', false, false]
    mocks.hostOptions[2] = {
      ...mocks.hostOptions[2],
      health: 'blocked'
    }
    mocks.storeState.settings = { activeRuntimeEnvironmentId: 'env-1' }
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    useAddRepoHostSelection({ isOpen: true, setStep: vi.fn() })

    expect(mocks.stateSetters[0]).toHaveBeenCalledWith('local')
  })

  it('hides ephemeral VM runtime hosts from Add Project selection', async () => {
    mocks.stateValues = ['runtime:env-vm', 'runtime:env-vm', false, false]
    mocks.hostOptions.push({
      id: 'runtime:env-vm',
      label: 'orca VM abc12345',
      detail: 'Runtime',
      kind: 'runtime',
      health: 'available',
      presence: 'project'
    })
    mocks.storeState.runtimeEnvironments = [
      { id: 'env-vm', name: 'orca VM abc12345', source: 'ephemeral-vm' }
    ]
    const setStep = vi.fn()
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep })

    expect(result.hostOptions.map((host) => host.id)).not.toContain('runtime:env-vm')
    expect(result.selectedHostId).toBe('local')
    await result.handleSelectAddProjectSource('runtime:env-vm')
    expect(mocks.storeState.switchRuntimeEnvironment).not.toHaveBeenCalledWith('env-vm')
    expect(setStep).not.toHaveBeenCalled()
  })

  it('scopes Host options to SSH targets owned by the selected From server', async () => {
    mocks.stateValues = ['runtime:env-1', 'ssh:ssh-p8', false, false]
    mocks.storeState.settings = { activeRuntimeEnvironmentId: 'env-1' }
    mocks.storeState.sshStateByEnvironment = new Map([
      [
        'env-1',
        {
          targetsHydrated: true,
          targetLabels: new Map([['ssh-p8', 'p8']]),
          removedTargetLabels: new Map(),
          connectionStates: new Map([
            [
              'ssh-p8',
              {
                targetId: 'ssh-p8',
                status: 'connected' as const,
                error: null,
                reconnectAttempt: 0
              }
            ]
          ])
        }
      ]
    ])
    const { useAddRepoHostSelection } = await import('./use-add-repo-host-selection')

    const result = useAddRepoHostSelection({ isOpen: true, setStep: vi.fn() })

    expect(result.selectedRuntimeEnvironmentId).toBe('env-1')
    expect(result.selectedSshTargetId).toBe('ssh-p8')
    expect(result.hostOptions.map((host) => host.label)).toEqual(['This server', 'p8'])
    expect(mocks.hydrateEnvironmentSsh).toHaveBeenCalledWith('env-1')
  })
})
