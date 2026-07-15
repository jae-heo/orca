import { useState } from 'react'
import { AddRepoHostSelector } from './AddRepoHostSelector'
import type { useAddRepoHostSelection } from './use-add-repo-host-selection'
import { AddRemoteHostDialog, type AddRemoteHostMode } from './AddRemoteHostDialog'

export function AddRepoHostSelectorSlot({
  hostSelection
}: {
  hostSelection: ReturnType<typeof useAddRepoHostSelection>
}) {
  const [addRemoteHostMode, setAddRemoteHostMode] = useState<AddRemoteHostMode | null>(null)
  const selectedRuntimeEnvironment =
    hostSelection.selectedSourceParsed?.kind === 'runtime'
      ? {
          id: hostSelection.selectedSourceParsed.environmentId,
          label:
            hostSelection.sourceOptions.find(
              (source) => source.id === hostSelection.selectedSourceId
            )?.label ?? hostSelection.selectedSourceParsed.environmentId
        }
      : null

  return (
    <>
      <AddRepoHostSelector
        sources={hostSelection.sourceOptions}
        selectedSourceId={hostSelection.selectedSourceId}
        sourceOpen={hostSelection.sourceSelectorOpen}
        onSourceOpenChange={hostSelection.setSourceSelectorOpen}
        onSelectSource={(sourceId) => void hostSelection.handleSelectAddProjectSource(sourceId)}
        hosts={hostSelection.hostOptions}
        selectedHostId={hostSelection.selectedHostId}
        hostOpen={hostSelection.hostSelectorOpen}
        onHostOpenChange={hostSelection.setHostSelectorOpen}
        onSelectHost={(hostId) => void hostSelection.handleSelectAddProjectHost(hostId)}
        onConnectHost={(hostId) => void hostSelection.handleConnectAddProjectHost(hostId)}
        onAddSshHost={() => setAddRemoteHostMode('ssh')}
        onAddRemoteServer={() => setAddRemoteHostMode('server')}
      />
      <AddRemoteHostDialog
        mode={addRemoteHostMode}
        onOpenChange={setAddRemoteHostMode}
        sshOwnerEnvironment={selectedRuntimeEnvironment}
      />
    </>
  )
}
