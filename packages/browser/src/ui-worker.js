import { InitializeWorkerSkia } from '@wieslawsoltes/avalonia-skia';
import { WorkerTopLevel, InstallWorkerTopLevel, InstallWorkerWindowFactory } from './worker-top-level.js';
import { ThreadChannel, TransferResult } from './thread-channel.js';
let initialized=false;
export async function StartUiWorker(message,startup={}) {
    if(message?.Type!=='initialize'||initialized)return;initialized=true;
    const{Port,RenderPort,ApplicationModule,ApplicationExport,ApplicationOptions,Snapshot,Runtime}=message;
    let root,application,platform;const started=performance.timeOrigin+performance.now();let inputCount=0;
    const report=error=>channel.Send({Type:'application-error',Error:{Name:error.name,Message:error.message,Stack:error.stack}});
    const channel=new ThreadChannel(Port,{OnError:report,OnEvent:async m=>{if(m.Type==='events'){try{for(const event of m.Events){root?.ProcessHostMessage(event);inputCount++;}}finally{channel.Send({Type:'events-ack'});}}},OnRequest:async(method,value)=>{
        switch(method){
            case 'invoke':{const command=application?.Commands?.[value.Command];if(typeof command!=='function')throw new Error(`Application command '${value.Command}' is not registered.`);return command(value.Value);}
            case 'diagnostics':return{UI:{Thread:'avalonia-ui-worker',HasDocument:typeof document!=='undefined',StartedAt:started,Inputs:inputCount,LastUiFrame:root.LastUiFrame,WasmHeapBytes:platform.Api.CanvasKit.HEAPU8?.byteLength??null,ClientSize:{Width:root.ClientSize.Width,Height:root.ClientSize.Height},PendingFrames:root._frameId==null?0:1,LastError:root.LastRenderError?.message,Automation:root._automationBridge.Statistics},Renderer:await root.Renderer.GetDiagnosticsAsync()};
            case 'restart-renderer':await root.Renderer.RestartAsync();return true;
            case 'snapshot-png':{await root.RenderNow();const bytes=await root.Renderer.SnapshotPng();return TransferResult(bytes,bytes.buffer);}
            case 'dispose':{await application?.Dispose?.();root?.Dispose();platform?.Dispose();return true;}
            default:throw new Error(`Unknown UI-worker request '${method}'.`);
        }
    }});
    try{
        platform=await InitializeWorkerSkia(Runtime,startup);InstallWorkerWindowFactory(platform);
        startup.Progress?.('application-module',ApplicationModule);
        const module=await import(ApplicationModule),factory=module[ApplicationExport??'CreateWorkerApplication'];if(typeof factory!=='function')throw new TypeError('The application module must export its worker application factory.');
        application=await factory({Platform:platform,Options:ApplicationOptions,Snapshot,Host:channel,CreateTopLevel:()=>new WorkerTopLevel()});
        if(!application?.Root&&!application?.View)throw new TypeError('The application factory must return Root or View.');
        root=application.Root??new WorkerTopLevel();InstallWorkerTopLevel(root);if(application.View)root.Content=application.View;
        startup.Progress?.('renderer-channel');
        await root.AttachWorker(channel,RenderPort,platform,Snapshot);
        // AttachWorker installs the per-root event callback; the channel still
        // unwraps bounded input batches and acknowledges them independently of paint.
        channel.OnEvent=async m=>{if(m.Type==='render-worker-failed'){root.Renderer._Recover(new Error(m.Message));return;}if(m.Type==='events'){try{for(const event of m.Events){root.ProcessHostMessage(event);inputCount++;}}finally{channel.Send({Type:'events-ack'});}}};
        await application.Start?.(root);await root.RenderNow();channel.Send({Type:'ready'});
    }catch(error){root?.Dispose();platform?.Dispose();channel.Dispose();throw error;}
}
