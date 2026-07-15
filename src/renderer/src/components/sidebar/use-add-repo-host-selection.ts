import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import {
  getSettingsFocusedExecutionHostId,
  isRuntimeOwnedSshTargetId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import type { ExecutionHostHealth } from '../../../../shared/execution-host-registry'
import type { SshConnectionState, SshConnectionStatus } from '../../../../shared/ssh-types'
import { isEphemeralVmRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { AddRepoDialogStep } from './add-repo-dialog-types'
import { useSidebarHostScopeOptions } from './use-sidebar-host-scope-options'
import { canSelectAddRepoHost } from './add-repo-host-availability'
import { translate } from '@/i18n/i18n'
import {
  connectRuntimeEnvironmentSshTarget,
  hydrateRuntimeEnvironmentSshState
} from '@/runtime/runtime-environment-ssh-state'
import type { SidebarHostOption } from './sidebar-host-options'

function sshHealth(status: SshConnectionStatus | undefined): ExecutionHostHealth {
  switch (status) {
    case 'connected':
      return 'available'
    case 'connecting':
    case 'deploying-relay':
    case 'reconnecting':
      return 'connecting'
    case 'auth-failed':
    case 'error':
    case 'reconnection-failed':
      return 'error'
    case 'disconnected':
    case undefined:
      return 'disconnected'
  }
}

function directHostOption(source: SidebarHostOption): SidebarHostOption {
  return {
    ...source,
    label:
      source.kind === 'runtime'
        ? translate('auto.components.sidebar.useAddRepoHostSelection.thisServer', 'This server')
        : translate(
            'auto.components.sidebar.useAddRepoHostSelection.thisComputer',
            'This computer'
          ),
    detail: source.label
  }
}

export function useAddRepoHostSelection({
  isOpen,
  setStep
}: {
  isOpen: boolean
  setStep: (step: AddRepoDialogStep) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const switchRuntimeEnvironment = useAppStore((s) => s.switchRuntimeEnvironment)
  const setSshConnectionState = useAppStore((s) => s.setSshConnectionState)
  const setEnvironmentSshConnectionState = useAppStore((s) => s.setEnvironmentSshConnectionState)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const sshStateByEnvironment = useAppStore((s) => s.sshStateByEnvironment)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const { hostOptions: allHostOptions } = useSidebarHostScopeOptions()
  const ephemeralRuntimeEnvironmentIds = useMemo(
    () =>
      new Set(
        runtimeEnvironments
          .filter(isEphemeralVmRuntimeEnvironment)
          .map((environment) => environment.id)
      ),
    [runtimeEnvironments]
  )
  const sourceOptions = useMemo(
    () =>
      allHostOptions.filter((host) => {
        const parsed = parseExecutionHostId(host.id)
        return (
          parsed?.kind !== 'ssh' &&
          (parsed?.kind !== 'runtime' || !ephemeralRuntimeEnvironmentIds.has(parsed.environmentId))
        )
      }),
    [allHostOptions, ephemeralRuntimeEnvironmentIds]
  )
  const [selectedSourceId, setSelectedSourceId] = useState<ExecutionHostId>(LOCAL_EXECUTION_HOST_ID)
  const [selectedHostIdState, setSelectedHostIdState] =
    useState<ExecutionHostId>(LOCAL_EXECUTION_HOST_ID)
  const [sourceSelectorOpen, setSourceSelectorOpen] = useState(false)
  const [hostSelectorOpen, setHostSelectorOpen] = useState(false)
  const previousOpenRef = useRef(false)

  const selectedSource =
    sourceOptions.find((host) => host.id === selectedSourceId && canSelectAddRepoHost(host)) ??
    sourceOptions.find(
      (host) => host.id === LOCAL_EXECUTION_HOST_ID && canSelectAddRepoHost(host)
    ) ??
    sourceOptions.find((host) => canSelectAddRepoHost(host)) ??
    sourceOptions[0]
  const effectiveSourceId = selectedSource?.id ?? LOCAL_EXECUTION_HOST_ID
  const selectedSourceParsed = parseExecutionHostId(effectiveSourceId)
  const selectedRuntimeEnvironmentId =
    selectedSourceParsed?.kind === 'runtime' ? selectedSourceParsed.environmentId : null

  const hostOptions = useMemo<SidebarHostOption[]>(() => {
    if (!selectedSource) {
      return []
    }
    const direct = directHostOption(selectedSource)
    if (!selectedRuntimeEnvironmentId) {
      return [direct, ...allHostOptions.filter((host) => host.kind === 'ssh')]
    }
    const bucket = sshStateByEnvironment.get(selectedRuntimeEnvironmentId)
    const sshOptions = [...(bucket?.targetLabels ?? new Map<string, string>())]
      .filter(([targetId]) => !isRuntimeOwnedSshTargetId(targetId))
      .map<SidebarHostOption>(([targetId, label]) => {
        const connectionStatus = bucket?.connectionStates.get(targetId)?.status ?? 'disconnected'
        return {
          id: toSshExecutionHostId(targetId),
          label,
          detail: translate(
            'auto.components.sidebar.useAddRepoHostSelection.sshViaServer',
            'SSH via {{value0}}',
            { value0: selectedSource.label }
          ),
          kind: 'ssh',
          health: sshHealth(connectionStatus),
          presence: 'configured',
          connectionStatus
        }
      })
    return [direct, ...sshOptions]
  }, [allHostOptions, selectedRuntimeEnvironmentId, selectedSource, sshStateByEnvironment])

  const selectedHost = hostOptions.find((host) => host.id === selectedHostIdState) ?? hostOptions[0]
  const selectedHostId = selectedHost?.id ?? effectiveSourceId
  const selectedHostParsed = parseExecutionHostId(selectedHostId)
  const selectedSshTargetId =
    selectedHostParsed?.kind === 'ssh' ? selectedHostParsed.targetId : null
  const selectedHostKind = selectedSshTargetId
    ? ('ssh' as const)
    : selectedSourceParsed?.kind === 'runtime'
      ? ('runtime' as const)
      : ('local' as const)

  useEffect(() => {
    if (isOpen && !previousOpenRef.current) {
      const focusedHostId = getSettingsFocusedExecutionHostId(settings)
      const nextSourceId = sourceOptions.some(
        (host) => host.id === focusedHostId && canSelectAddRepoHost(host)
      )
        ? focusedHostId
        : LOCAL_EXECUTION_HOST_ID
      setSelectedSourceId(nextSourceId)
      setSelectedHostIdState(nextSourceId)
    }
    if (!isOpen) {
      setSourceSelectorOpen(false)
      setHostSelectorOpen(false)
    }
    previousOpenRef.current = isOpen
  }, [isOpen, settings, sourceOptions])

  useEffect(() => {
    if (!isOpen || !selectedRuntimeEnvironmentId) {
      return
    }
    // Why: Host choices belong to the selected source server, so hydrate that
    // server's SSH namespace instead of showing this computer's same-named targets.
    void hydrateRuntimeEnvironmentSshState(selectedRuntimeEnvironmentId).catch(() => {})
  }, [isOpen, selectedRuntimeEnvironmentId])

  const handleSelectAddProjectSource = useCallback(
    async (sourceId: ExecutionHostId): Promise<void> => {
      const source = sourceOptions.find((candidate) => candidate.id === sourceId)
      if (!source || !canSelectAddRepoHost(source)) {
        return
      }
      const parsed = parseExecutionHostId(sourceId)
      const environmentId = parsed?.kind === 'runtime' ? parsed.environmentId : null
      const switched = await switchRuntimeEnvironment(environmentId)
      if (!switched) {
        return
      }
      setSelectedSourceId(sourceId)
      setSelectedHostIdState(sourceId)
      setStep('add')
    },
    [setStep, sourceOptions, switchRuntimeEnvironment]
  )

  const handleSelectAddProjectHost = useCallback(
    async (hostId: ExecutionHostId): Promise<void> => {
      const host = hostOptions.find((candidate) => candidate.id === hostId)
      if (!host || !canSelectAddRepoHost(host)) {
        return
      }
      setSelectedHostIdState(hostId)
      setStep('add')
    },
    [hostOptions, setStep]
  )

  const handleConnectAddProjectHost = useCallback(
    async (hostId: ExecutionHostId): Promise<void> => {
      const host = hostOptions.find((candidate) => candidate.id === hostId)
      const parsed = parseExecutionHostId(hostId)
      if (!host || parsed?.kind !== 'ssh') {
        return
      }

      const targetId = parsed.targetId
      const previousState = selectedRuntimeEnvironmentId
        ? sshStateByEnvironment.get(selectedRuntimeEnvironmentId)?.connectionStates.get(targetId)
        : sshConnectionStates.get(targetId)
      const connectingState: SshConnectionState = {
        targetId,
        status: 'connecting',
        error: null,
        reconnectAttempt: previousState?.reconnectAttempt ?? 0,
        remotePlatform: previousState?.remotePlatform
      }
      if (selectedRuntimeEnvironmentId) {
        setEnvironmentSshConnectionState(selectedRuntimeEnvironmentId, targetId, connectingState)
      } else {
        setSshConnectionState(targetId, connectingState)
      }

      try {
        const state = selectedRuntimeEnvironmentId
          ? await connectRuntimeEnvironmentSshTarget(selectedRuntimeEnvironmentId, targetId)
          : (((await window.api.ssh.connect({ targetId })) as SshConnectionState | null) ??
            ((await window.api.ssh.getState({ targetId })) as SshConnectionState | null))
        if (!selectedRuntimeEnvironmentId && state) {
          setSshConnectionState(targetId, state)
        }
        if (state?.status !== 'connected') {
          return
        }
        setSelectedHostIdState(hostId)
        setStep('add')
        setHostSelectorOpen(false)
      } catch (err) {
        const fallbackState: SshConnectionState = previousState ?? {
          targetId,
          status: 'disconnected',
          error:
            err instanceof Error
              ? err.message
              : translate(
                  'auto.components.sidebar.useAddRepoHostSelection.connectionFailed',
                  'SSH connection failed.'
                ),
          reconnectAttempt: 0
        }
        if (selectedRuntimeEnvironmentId) {
          setEnvironmentSshConnectionState(selectedRuntimeEnvironmentId, targetId, fallbackState)
        } else {
          setSshConnectionState(targetId, fallbackState)
        }
        toast.error(
          err instanceof Error
            ? err.message
            : translate(
                'auto.components.sidebar.useAddRepoHostSelection.connectionFailed',
                'SSH connection failed.'
              )
        )
      }
    },
    [
      hostOptions,
      selectedRuntimeEnvironmentId,
      setEnvironmentSshConnectionState,
      setSshConnectionState,
      setStep,
      sshConnectionStates,
      sshStateByEnvironment
    ]
  )

  return {
    sourceOptions,
    selectedSourceId: effectiveSourceId,
    selectedSourceParsed,
    selectedRuntimeEnvironmentId,
    hostOptions,
    selectedHostId,
    selectedHostParsed,
    selectedHostKind,
    selectedSshTargetId,
    sourceSelectorOpen,
    setSourceSelectorOpen,
    hostSelectorOpen,
    setHostSelectorOpen,
    handleSelectAddProjectSource,
    handleSelectAddProjectHost,
    handleConnectAddProjectHost
  }
}
