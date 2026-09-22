import { Point } from "../../base/src/index.js";
import { Color } from "../../media/src/index.js";

const forbidden = new Set(['__proto__', 'prototype', 'constructor', 'call', 'apply', 'bind']);
const vector = (x=0,y=x,z=0) => ({X:Number(x),Y:Number(y),Z:Number(z)});
const map = (a,b,fn) => typeof a === 'object' || typeof b === 'object'
    ? Object.fromEntries([...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].map(k => [k, fn(typeof a==='number'?a:a[k],typeof b==='number'?b:b[k])])) : fn(a,b);
const functions = Object.freeze({
    Abs: Math.abs, Sin: Math.sin, Cos: Math.cos, Tan: Math.tan, Acos: Math.acos, Asin: Math.asin, Atan: Math.atan,
    Atan2: Math.atan2, Sqrt: Math.sqrt, Pow: Math.pow, Floor: Math.floor, Ceil: Math.ceil, Round: Math.round,
    Min: Math.min, Max: Math.max, Clamp: (x,a,b)=>Math.max(a,Math.min(b,x)),
    Lerp: (a,b,t)=>map(a,b,(x,y)=>x+(y-x)*t), Vector2: (x,y=x)=>new Point(x,y), Vector3: vector,
    Color: (a,r,g,b)=>new Color(a,r,g,b), Pi: ()=>Math.PI,
});

/** Restricted expression AST: no eval, no statements, no method invocation, no prototype traversal. */
export class CompositionExpression {
    constructor(text) { this.Text=String(text); this.Ast=parse(this.Text); }
    Evaluate(environment = {}) { return evaluate(this.Ast,environment); }
}
function parse(source) {
    const tokens=[]; const lexer=/\s*(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%<>()!?:.,])/gy;
    let offset=0;
    while(offset<source.length) {
        if (!source.slice(offset).trim()) break;
        lexer.lastIndex=offset;const m=lexer.exec(source);
        if(!m)throw new SyntaxError(`Invalid composition expression at character ${offset}.`);
        tokens.push(m[1]);offset=lexer.lastIndex;
        if(tokens.length>4096)throw new RangeError('Composition expression token limit exceeded.');
    }
    let i=0,depth=0;
    const take=t=>{const r=tokens[i++];if(t&&r!==t)throw new SyntaxError(`Expected '${t}', got '${r}'.`);return r;};
    const precedence={'||':1,'&&':2,'==':3,'!=':3,'===':3,'!==':3,'<':4,'>':4,'<=':4,'>=':4,'+':5,'-':5,'*':6,'/':6,'%':6};
    const primary=()=>{
        if(++depth>128)throw new RangeError('Composition expression nesting limit exceeded.');
        let node,t=take();
        if(['+','-','!'].includes(t))node={kind:'unary',op:t,child:primary()};
        else if(t==='('){node=expression();take(')');}
        else if(/^(?:\d|\.\d)/.test(t??''))node={kind:'literal',value:Number(t)};
        else if(t==='true'||t==='false')node={kind:'literal',value:t==='true'};
        else if(/^[A-Za-z_$][\w$]*$/.test(t??'')&&!forbidden.has(t)) {
            if(tokens[i]==='(') {
                if(!Object.hasOwn(functions,t)||typeof functions[t]!=='function')throw new SyntaxError(`Unknown composition function '${t}'.`);
                take('(');const args=[];if(tokens[i]!==')'){do{args.push(expression());if(tokens[i]!==',')break;take(',');}while(true);}take(')');
                node={kind:'call',name:t,args};
            } else node={kind:'name',name:t};
        } else throw new SyntaxError(`Invalid expression token '${t}'.`);
        while(tokens[i]==='.') {
            take('.');const key=take();
            if(!/^[A-Za-z_$][\w$]*$/.test(key??'')||forbidden.has(key))throw new SyntaxError('Unsafe expression member.');
            node={kind:'member',object:node,key};
        }
        depth--;return node;
    };
    const expression=(min=0)=>{
        let left=primary();
        while(precedence[tokens[i]]!==undefined&&precedence[tokens[i]]>=min){const op=take(),right=expression(precedence[op]+1);left={kind:'binary',op,left,right};}
        if(min===0&&tokens[i]==='?'){take('?');const yes=expression();take(':');left={kind:'conditional',condition:left,yes,no:expression()};}
        return left;
    };
    if(!tokens.length)throw new SyntaxError('Composition expression cannot be empty.');
    const ast=expression();if(i!==tokens.length)throw new SyntaxError(`Unexpected expression token '${tokens[i]}'.`);return ast;
}
function evaluate(node,env) {
    switch(node.kind) {
        case 'literal':return node.value;
        case 'name':if(node.name==='Pi')return Math.PI;if(!Object.hasOwn(env,node.name))throw new ReferenceError(`Expression parameter '${node.name}' is not defined.`);return env[node.name];
        case 'member':{
            const owner=evaluate(node.object,env);
            if(owner?.GetExpressionValue)return owner.GetExpressionValue(node.key);
            if(owner==null||!Object.hasOwn(owner,node.key))throw new ReferenceError(`Expression member '${node.key}' is not available.`);
            return owner[node.key];
        }
        case 'call':return functions[node.name](...node.args.map(x=>evaluate(x,env)));
        case 'unary':{const v=evaluate(node.child,env);return node.op==='!'?!v:node.op==='-'?map(0,v,(a,b)=>a-b):v;}
        case 'conditional':return evaluate(node.condition,env)?evaluate(node.yes,env):evaluate(node.no,env);
        case 'binary':{
            const a=evaluate(node.left,env);if(node.op==='&&')return a&&evaluate(node.right,env);if(node.op==='||')return a||evaluate(node.right,env);
            const b=evaluate(node.right,env);
            switch(node.op){case '+':return map(a,b,(x,y)=>x+y);case '-':return map(a,b,(x,y)=>x-y);case '*':return map(a,b,(x,y)=>x*y);case '/':return map(a,b,(x,y)=>x/y);case '%':return map(a,b,(x,y)=>x%y);case '==':case '===':return a===b;case '!=':case '!==':return a!==b;case '<':return a<b;case '>':return a>b;case '<=':return a<=b;case '>=':return a>=b;}
        }
    }
    throw new Error('Invalid expression AST.');
}
