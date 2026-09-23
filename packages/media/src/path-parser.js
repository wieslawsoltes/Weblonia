import { Point, Size } from '@wieslawsoltes/avalonia-base';

/** Bounded, non-evaluating SVG/Avalonia path grammar shared by both public Parse
 * methods. Relative commands and smooth controls are normalized to absolute
 * context operations. Unknown suffixes and malformed numeric/arc tokens fail. */
export function ParsePathMarkup(source, context) {
    const text = String(source); let pos = 0, command = '', previous = '', current = new Point(), start = current, control = current, open = false, operations = 0;
    if (text.length > 8 * 1024 * 1024) throw new RangeError('Path markup exceeds the 8 MiB limit.');
    const fail = message => { throw new SyntaxError(`${message} at path offset ${pos}.`); };
    const space = () => { while (pos < text.length && /\s/.test(text[pos])) pos++; };
    const numericToken = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
    const number = (flag = false) => {
        space(); if (text[pos] === ',') { pos++; space(); }
        if (flag) { if (text[pos] !== '0' && text[pos] !== '1') fail('An arc flag must be 0 or 1'); return Number(text[pos++]); }
        numericToken.lastIndex=pos; const match=numericToken.exec(text);
        if (!match) fail('Expected a finite number'); pos += match[0].length;
        const value = Number(match[0]); if (!Number.isFinite(value)) fail('Nonfinite path coordinate'); return value;
    };
    const point = relative => { const x = number(), y = number(); return new Point(x + (relative ? current.X : 0), y + (relative ? current.Y : 0)); };
    const mirror = () => new Point(current.X * 2 - control.X, current.Y * 2 - control.Y);
    space();
    if (text[pos] === 'F' || text[pos] === 'f') { pos++; context.SetFillRule(number(true) ? 'NonZero' : 'EvenOdd'); space(); }
    while (pos < text.length) {
        if (++operations > 200000) throw new RangeError('Path markup exceeds the operation limit.');
        if (/[a-zA-Z]/.test(text[pos])) command = text[pos++];
        else if (!command) fail('Expected a path command');
        const op = command.toUpperCase(), relative = command !== op;
        if (!'MLHVCSQTAZ'.includes(op)) fail(`Unknown path command '${command}'`);
        if (op === 'Z') {
            if (!open) fail('Close requires an open figure');
            context.EndFigure(true); current = start; open = false; command = ''; previous = 'Z'; space(); continue;
        }
        if (op === 'M') {
            const p = point(relative); if (open) context.EndFigure(false);
            context.BeginFigure(p, true); current = start = p; open = true; command = relative ? 'l' : 'L';
        } else {
            // An explicit segment after close starts at the closed figure origin.
            if (!open) { if (previous !== 'Z') fail('A path must begin with a move command'); context.BeginFigure(current, true); open = true; start = current; }
            if (op === 'L') { current = point(relative); context.LineTo(current); }
            else if (op === 'H') { current = new Point(number() + (relative ? current.X : 0), current.Y); context.LineTo(current); }
            else if (op === 'V') { current = new Point(current.X, number() + (relative ? current.Y : 0)); context.LineTo(current); }
            else if (op === 'C' || op === 'S') {
                const p1 = op === 'C' ? point(relative) : 'CS'.includes(previous) ? mirror() : current;
                const p2 = point(relative), p3 = point(relative); context.CubicBezierTo(p1, p2, p3); current = p3; control = p2;
            } else if (op === 'Q' || op === 'T') {
                const p1 = op === 'Q' ? point(relative) : 'QT'.includes(previous) ? mirror() : current;
                const p2 = point(relative); context.QuadraticBezierTo(p1, p2); current = p2; control = p1;
            } else if (op === 'A') {
                const size = new Size(number(), number()), rotation = number(), large = !!number(true), sweep = number(true), p = point(relative);
                if (size.Width < 0 || size.Height < 0) fail('Arc radii must be nonnegative');
                context.ArcTo(p, size, rotation, large, sweep ? 'Clockwise' : 'CounterClockwise'); current = p;
            }
        }
        previous = op; space();
        if (pos === text.length) break;
        // A comma is a parameter separator, not a command separator or suffix.
        if (text[pos] === ',' && (/^[,\s]*[a-zA-Z]/.test(text.slice(pos)) || /^[,\s]*$/.test(text.slice(pos)))) fail('Unexpected comma');
    }
    if (open) context.EndFigure(false);
}
