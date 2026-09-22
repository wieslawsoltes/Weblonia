import { Matrix, Vector } from "../../base/src/index.js";
import { Color } from "../../media/src/index.js";
const members = {
    Vector2:['X','Y'], Vector3:['X','Y','Z'], Vector4:['X','Y','Z','W'], Quaternion:['X','Y','Z','W'],
    Matrix3x2:['M11','M12','M21','M22','M31','M32'],
    Matrix4x4:Array.from({length:16},(_,i)=>`M${Math.floor(i/4)+1}${i%4+1}`),
};
/** JS struct adapter. Values are copied at public boundaries; Vector4 and
 * Quaternion retain distinct declared tags even though both contain X/Y/Z/W. */
export function CopyCompositionValue(type, value) {
    if (type === 'Scalar') { if (!Number.isFinite(value)) throw new TypeError('Scalar must be finite.'); return value; }
    if (type === 'Boolean') { if (typeof value !== 'boolean') throw new TypeError('Boolean must be true or false.'); return value; }
    if (type === 'Color') { const c=Color.Parse(value); return new Color(c.A,c.R,c.G,c.B); }
    const fields=members[type]; if (!fields) throw new TypeError(`Unknown composition value type '${type}'.`);
    if (!value || !fields.every(k=>Number.isFinite(value[k]))) throw new TypeError(`${type} requires finite ${fields.join(', ')} components.`);
    if(type==='Vector2')return new Vector(value.X,value.Y);
    if(type==='Matrix3x2')return new Matrix(...fields.map(k=>value[k]));
    return Object.fromEntries(fields.map(k=>[k,value[k]]));
}
export function DefaultCompositionValue(type) {
    if(type==='Scalar')return 0;if(type==='Boolean')return false;if(type==='Color')return new Color(0,0,0,0);
    return CopyCompositionValue(type,Object.fromEntries(members[type].map(k=>[k,0])));
}
export function ValidateCompositionKey(name) {
    if(typeof name!=='string'||!/^[A-Za-z]\w*$/.test(name)||['__proto__','prototype','constructor'].includes(name))throw new RangeError('Invalid composition parameter key.');
    return name;
}
export const CompositionValueTypes=Object.freeze(['Color','Matrix3x2','Matrix4x4','Quaternion','Scalar','Vector2','Vector3','Vector4','Boolean']);
