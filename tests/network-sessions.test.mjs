import assert from 'node:assert/strict';
import test from 'node:test';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';
import { configurationDraft } from '../src/features/networks/configuration.ts';
import { documentFromNetworks, emptyDocument } from '../src/features/networks/persistence.ts';
import { isConnected } from '../src/features/networks/model.ts';

function profile(name, id = crypto.randomUUID()) {
  const network = newNetworkDraft([], id);
  network.savedConfig.name = name; network.savedConfig.servers = ['tcp://example.com:11010'];
  network.alias = name;
  return network;
}
function native(initial = [profile('office'), profile('game')]) {
  let states = [];
  let fail = null;
  const calls = [];
  const runtime = Object.assign(async (op) => {
    calls.push(structuredClone(op));
    if (op.action === 'stop' || op.action === 'restart') states = states.filter(s => s.id !== op.id);
    if (fail?.(op)) throw { code: fail(op) };
    if (op.action !== 'stop') states.push({id:op.id,state:'running',runningConfig:structuredClone(op.config),deviceName:op.config.tunName,
      virtualIp:'10.42.0.2',peerCount:0,directPeerCount:0,error:null});
    return structuredClone(states);
  }, {snapshot:async()=>structuredClone(states)});
  const store = createNetworkStore(initial, runtime);
  return {store,runtime,calls, fail:(fn)=>{fail=fn;},states:(next)=>{states=next;}};
}
const get = (store,id) => store.getState().networks.find(n=>n.id===id);

test('native readiness is driven by snapshots; an empty network is running without claiming peers', async()=>{
  const f=native(); const id=f.store.getState().networks[0].id;
  assert.equal(await f.store.getState().toggleConnection(id),true);
  const network=get(f.store,id);
  assert.equal(network.coreState,'running'); assert.equal(network.peerCount,0); assert.equal(isConnected(network),false);
  assert.equal(network.virtualIp,'10.42.0.2'); assert.equal(network.trafficTotals,null);
});

test('a failed new configuration is not restored, and the next attempt uses saved new parameters', async()=>{
  const f=native(); const [a,b]=f.store.getState().networks.map(n=>n.id);
  await f.store.getState().toggleConnection(a); await f.store.getState().toggleConnection(b);
  const before=structuredClone(get(f.store,b));
  f.fail(op=>op.id===a && op.action==='restart' ? 'tun_failed' : null);
  const result=await f.store.getState().saveConfiguration(a,{...configurationDraft(get(f.store,a)),secret:'new-key'},'now');
  assert.equal(await result.completion,false);
  assert.equal(get(f.store,a).coreState,'stopped'); assert.equal(get(f.store,a).runningConfig,null);
  assert.equal(get(f.store,a).connectionError.code,'tun_failed'); assert.equal(get(f.store,a).savedConfig.secret,'new-key');
  assert.deepEqual(get(f.store,b),before);
  assert.equal(f.calls.filter(op=>op.id===a).length,2);
  await f.store.getState().toggleConnection(a);
  assert.equal(f.calls.at(-1).config.secret,'new-key');
});

test('same-network profiles cannot run together, including during a pending start', async()=>{
  const a=profile('office'), b=profile('office'); const f=native([a,b]);
  let resolve;
  const command=f.runtime;
  const runtime=Object.assign(op=>new Promise(r=>{resolve=()=>command(op).then(r);}),{snapshot:command.snapshot});
  const store=createNetworkStore([a,b],runtime);
  const first=store.getState().toggleConnection(a.id);
  assert.equal(await store.getState().toggleConnection(b.id),false);
  assert.equal(get(store,b.id).connectionError.code,'network_already_running');
  resolve(); await first;
  assert.equal(f.calls.length,1);
});

test('a delayed snapshot cannot undo a newer completed start', async()=>{
  const f=native(); const id=f.store.getState().networks[0].id;
  let resolve;
  f.runtime.snapshot=()=>new Promise(r=>{resolve=r;});
  const oldRead=f.store.getState().refreshRuntime();
  await f.store.getState().toggleConnection(id);
  resolve([]); await oldRead;
  assert.equal(get(f.store,id).coreState,'running');
});

test('failed status reads preserve the last active parameters and show unknown until resynchronized', async()=>{
  const f=native(); const id=f.store.getState().networks[0].id;
  await f.store.getState().toggleConnection(id);
  const query=f.runtime.snapshot;
  f.runtime.snapshot=async()=>{throw {code:'request_timeout'};};
  assert.equal(await f.store.getState().refreshRuntime(),false);
  assert.equal(get(f.store,id).coreState,'unknown'); assert.ok(get(f.store,id).runningConfig);
  assert.equal(await f.store.getState().toggleConnection(id),false);
  f.runtime.snapshot=query;
  await f.store.getState().refreshRuntime(); assert.equal(get(f.store,id).coreState,'running');
});

function automatic(failure) {
  const profiles=[profile('one'),profile('two'),profile('manual')];
  profiles[0].autoConnect=true; profiles[1].autoConnect=true;
  const f=native(profiles); if(failure)f.fail(failure);
  const document=documentFromNetworks(emptyDocument(),profiles,profiles[0].id);
  const storage={load:async()=>structuredClone(document),restore:async()=>structuredClone(document),save:async(next)=>next};
  const store=createNetworkStore([],f.runtime,{storage});
  return {...f,store,profiles};
}
async function idle(store) {
  for(let i=0;i<50;i++) {
    if(!store.getState().autoConnecting)return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('Automatic queue did not finish');
}

test('auto-connect continues after one failed configuration and never starts unselected preferences', async()=>{
  const f=automatic(op=>op.config?.name==='one'?'invalid_config':null);
  await f.store.getState().initialize(); await idle(f.store);
  assert.deepEqual(f.calls.map(op=>op.config.name),['one','two']);
  assert.equal(get(f.store,f.profiles[1].id).coreState,'running');
  assert.equal(f.store.getState().autoConnectCancelled,false);
});

test('cancelling UAC stops the startup queue, keeps preferences, and permits an explicit manual retry', async()=>{
  const f=automatic(()=> 'elevation_cancelled');
  await f.store.getState().initialize(); await idle(f.store);
  assert.equal(f.calls.length,1); assert.equal(f.store.getState().autoConnectCancelled,true);
  assert.equal(get(f.store,f.profiles[0].id).autoConnect,true);
  assert.equal(get(f.store,f.profiles[1].id).autoConnect,true);
  f.fail(null);
  assert.equal(await f.store.getState().toggleConnection(f.profiles[1].id),true);
  assert.equal(f.calls.length,2);
});

test('reloading configuration does not execute startup auto-connect a second time', async()=>{
  const f=automatic();
  await f.store.getState().initialize(); await idle(f.store);
  assert.equal(f.calls.length,2);
  await f.store.getState().initialize(); await idle(f.store);
  assert.equal(f.calls.length,2);
});

test('a blocked duplicate profile keeps its error visible across status refreshes', async()=>{
  const f=native([profile('office'),profile('office')]);
  const [a,b]=f.store.getState().networks.map(n=>n.id);
  await f.store.getState().toggleConnection(a);
  assert.equal(await f.store.getState().toggleConnection(b),false);
  await f.store.getState().refreshRuntime();
  assert.equal(get(f.store,b).connectionError.code,'network_already_running');
  await f.store.getState().toggleConnection(a);
  assert.equal(await f.store.getState().toggleConnection(b),true);
  assert.equal(get(f.store,b).connectionError,null);
});

test('a failed instance still owning resources must be stopped before deleting its configuration', async()=>{
  const f=native();const id=f.store.getState().networks[0].id;
  await f.store.getState().toggleConnection(id);
  const config=structuredClone(get(f.store,id).runningConfig);
  f.states([{id,state:'failed',runningConfig:config,deviceName:config.tunName,virtualIp:null,peerCount:0,directPeerCount:0,error:{code:'tun_failed'}}]);
  await f.store.getState().refreshRuntime();
  assert.equal(await f.store.getState().removeNetwork(id),false);
  assert.equal(await f.store.getState().toggleConnection(id),true);
  assert.equal(f.calls.at(-1).action,'stop');
  assert.equal(await f.store.getState().removeNetwork(id),true);
});

test('network summaries distinguish waiting, unknown and failed from a stopped network', async()=>{
  const {summaryKey}=await import('../src/features/networks/model.ts');
  const network=profile('office');
  assert.equal(summaryKey([network]),'allOffline');
  assert.equal(summaryKey([{...network,coreState:'running',peerCount:0}]),'networksWaiting');
  assert.equal(summaryKey([{...network,coreState:'unknown'}]),'networksUnknown');
  assert.equal(summaryKey([{...network,coreState:'failed'}]),'networksFailed');
  assert.equal(summaryKey([{...network,coreState:'running',peerCount:1}]),'networksOnline');
});
