/** Request/reply control plane. Scene payloads use a separate direct channel. */
export class ThreadChannel {
    constructor(port,{OnEvent,OnRequest,OnError,Timeout=30000,MaxRequests=128}={}){this.Port=port;this.OnEvent=OnEvent;this.OnRequest=OnRequest;this.OnError=OnError;this.Timeout=Timeout;this.MaxRequests=MaxRequests;this.Next=1;this.Requests=new Map();this.Disposed=false;port.onmessage=e=>this._Receive(e.data);port.onmessageerror=()=>this.OnError?.(new Error('Thread channel deserialization failed.'));port.start();}
    Send(message,transfer=[]){if(!this.Disposed)this.Port.postMessage(message,transfer);}
    RequestAsync(method,value=null,transfer=[]){if(this.Disposed)return Promise.reject(new Error('Thread channel disposed.'));if(this.Requests.size>=this.MaxRequests)return Promise.reject(new Error('Thread request queue is full.'));const id=this.Next++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.Requests.delete(id);reject(new Error(`Thread request '${method}' timed out.`));},this.Timeout);this.Requests.set(id,{resolve,reject,timer});try{this.Send({Type:'rpc',Id:id,Method:method,Value:value},transfer);}catch(e){clearTimeout(timer);this.Requests.delete(id);reject(e);}});}
    async _Receive(m){if(this.Disposed)return;if(m.Type==='rpc-result'){const request=this.Requests.get(m.Id);if(!request)return;this.Requests.delete(m.Id);clearTimeout(request.timer);if(m.Error){const e=new Error(m.Error.Message);e.name=m.Error.Name;request.reject(e);}else request.resolve(m.Value);return;}
        if(m.Type==='rpc'){try{if(!this.OnRequest)throw new Error(`No service handler for '${m.Method}'.`);const result=await this.OnRequest(m.Method,m.Value);if(result?.__TransferResult)this.Send({Type:'rpc-result',Id:m.Id,Value:result.Value},result.Transfer);else this.Send({Type:'rpc-result',Id:m.Id,Value:result});}catch(e){this.Send({Type:'rpc-result',Id:m.Id,Error:{Name:e.name,Message:e.message,Stack:e.stack}});}return;}
        try{await this.OnEvent?.(m);}catch(e){this.OnError?.(e);}
    }
    Dispose(){if(this.Disposed)return;this.Disposed=true;for(const r of this.Requests.values()){clearTimeout(r.timer);r.reject(new Error('Thread channel disposed.'));}this.Requests.clear();this.Port.close();}
}
export const TransferResult=(Value,...Transfer)=>({__TransferResult:true,Value,Transfer});
