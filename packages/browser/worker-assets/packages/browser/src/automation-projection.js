/** A semantic-tree adapter, not a DOM implementation. Only the operations used
 * by BrowserAutomationBridge are supported. It records mutations for the browser
 * host; actual DOM ownership and native event delivery stay in the document. */
export class AutomationProjection {
    constructor(send) { this.Send = send; this.Nodes = new Map(); this.Operations = []; this.NextId = 10; }
    Create(id, tag = 'div', existing = false) {
        if (this.Nodes.has(id)) return this.Nodes.get(id);
        const node = new ProjectionNode(this, id, tag); this.Nodes.set(id, node);
        if (!existing) this.Operations.push(['create', id, tag]); return node;
    }
    createElement(tag) {
        if (tag !== 'div') throw new Error(`The UI-worker semantic projection cannot create DOM '${tag}'. Use a registered browser host module.`);
        return this.Create(this.NextId++, tag);
    }
    Flush() { if (this.Operations.length) { const ops = this.Operations; this.Operations = []; this.Send({ Type:'automation', Operations:ops }); } }
    Dispatch(id, name, data) { const node = this.Nodes.get(id); if (!node) return; const event={...data,preventDefault(){},stopPropagation(){}}; for(const callback of node.Events.get(name)??[])callback(event); }
    Dispose() { this.Nodes.clear(); this.Operations.length=0; }
}
class ProjectionNode {
    constructor(owner, id, tag) { this.Owner=owner; this.NodeId=id; this.tagName=tag; this.nodeType=1; this.Attributes=new Map(); this.childNodes=[]; this.parentNode=null; this.Events=new Map(); this._text=''; }
    get id(){return this.getAttribute('id')??'';} set id(v){this.setAttribute('id',v);}
    get tabIndex(){return +(this.getAttribute('tabindex')??-1);} set tabIndex(v){this.setAttribute('tabindex',v);}
    get firstChild(){return this.childNodes[0]??null;} get nextSibling(){const a=this.parentNode?.childNodes;return a?.[a.indexOf(this)+1]??null;}
    getAttribute(k){return this.Attributes.get(k)??null;}
    setAttribute(k,v){v=String(v);if(this.Attributes.get(k)===v)return;this.Attributes.set(k,v);this.Owner.Operations.push(['attr',this.NodeId,k,v]);}
    removeAttribute(k){if(!this.Attributes.delete(k))return;this.Owner.Operations.push(['attr',this.NodeId,k,null]);}
    insertBefore(child,next){if(child===next)return; const old=child.parentNode;if(old)old.childNodes.splice(old.childNodes.indexOf(child),1); const index=next==null?this.childNodes.length:this.childNodes.indexOf(next);if(index<0)throw new Error('Invalid semantic sibling.');this.childNodes.splice(index,0,child);child.parentNode=this;this._text='';this.Owner.Operations.push(['insert',this.NodeId,child.NodeId,next?.NodeId??null]);return child;}
    append(...children){for(const c of children)this.insertBefore(c,null);}
    remove(){if(this.parentNode){const p=this.parentNode;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentNode=null;}this.Owner.Operations.push(['remove',this.NodeId]);this.Owner.Nodes.delete(this.NodeId);}
    get textContent(){return this._text;}
    set textContent(value){value=String(value??'');if(this._text===value&&!this.childNodes.length)return;for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];this._text=value;this.Owner.Operations.push(['text',this.NodeId,value]);}
    addEventListener(name,callback){let events=this.Events.get(name);if(!events)this.Events.set(name,events=new Set());events.add(callback);}
    removeEventListener(name,callback){this.Events.get(name)?.delete(callback);}
}
