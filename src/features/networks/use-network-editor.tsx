import { useState } from 'react';
import { NetworkEditor } from './NetworkEditor';
import { useNetworkStore } from './store';
import { newNetworkDraft } from './network-store';
import type { Network } from './model';

// Pages identify the target; session keys, fresh drafts and exit animation live here.
export function useNetworkEditor() {
  const [session, setSession] = useState({ id: '', open: false, revision: 0 });
  const network = useNetworkStore((state) => state.networks.find((item) => item.id === session.id));
  const networks = useNetworkStore((state) => state.networks);
  const [newNetwork, setNewNetwork] = useState<Network | null>(null);
  const openEditor = (id: string) => {
    setNewNetwork(null);
    setSession((current) => ({ id, open: true, revision: current.revision + 1 }));
  };
  const openCreator = () => {
    setNewNetwork(newNetworkDraft(networks));
    setSession((current) => ({ id: '', open: true, revision: current.revision + 1 }));
  };
  const target = newNetwork ?? network;
  const editor = target && <NetworkEditor key={session.revision} network={target} creating={Boolean(newNetwork)} open={session.open}
    onOpenChange={(open) => setSession((current) => ({ ...current, open }))} />;
  return { openEditor, openCreator, editor };
}
