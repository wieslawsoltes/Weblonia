/** Browser-owned module. Only state and messages cross the UI-worker boundary. */
export function CreateControl({Document:doc,Send}) {
    const section=doc.createElement('section');section.style.cssText='box-sizing:border-box;height:100%;padding:18px;background:#eeeafa;border:1px solid #cdc2ec;border-radius:12px;font:14px system-ui;color:#3d3555;';
    const label=doc.createElement('label');label.textContent='Native browser input · connected to ReactiveWeb';label.style.cssText='display:grid;gap:12px';
    const input=doc.createElement('input');input.id='native-demo-input';input.type='text';input.style.cssText='box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #9886c8;border-radius:6px;font:16px system-ui;';label.append(input);section.append(label);
    const changed=()=>Send({Name:input.value});input.addEventListener('input',changed);
    return {Element:section,Update:state=>{const text=state?.Name??'';if(input.value!==text)input.value=text;},Dispose:()=>{input.removeEventListener('input',changed);section.remove();}};
}
