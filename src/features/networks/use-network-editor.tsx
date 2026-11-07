import { useState } from 'react';
import { NetworkEditor } from './NetworkEditor';
import { useNetworkStore } from './store';

// Pages identify the target; session keys, fresh drafts and exit animation live here.
export function useNetworkEditor() {
  const [session, setSession] = useState({ id: '', open: false, revision: 0 });
  const network = useNetworkStore((state) => state.networks.find((item) => item.id === session.id));
  const openEditor = (id: string) => setSession((current) => ({ id, open: true, revision: current.revision + 1 }));
  const editor = network && <NetworkEditor key={session.revision} network={network} open={session.open}
    onOpenChange={(open) => setSession((current) => ({ ...current, open }))} />;
  return { openEditor, editor };
}
