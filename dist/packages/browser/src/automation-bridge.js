import { Control, InputElement, TextBox, TextBoxAutomationPeer, KeyEventArgs, ModifiersFromDom,
    AutomationProperties, GetAutomationAriaProperties } from '@wieslawsoltes/avalonia-controls';

const keys = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space' };

/** Incremental DOM projection of the retained automation tree.
 *
 * Painting is not a semantic change. Reconcile structure only when membership,
 * order or visibility changes; project attributes only for dirty peers. Native
 * elements remain alive across row recycling. LabeledBy dependencies are tracked
 * explicitly so a label update also refreshes its consumers (including chains).
 */
export class BrowserAutomationBridge {
    constructor(root) {
        this.Root = root;
        this.Records = new Map();
        this.Dirty = new Set();
        this.StructureDirty = true;
        this._dependents = new Map();
        this._dependencySubscriptions = new Map();
        this._focus = undefined;
        this._editorParent = null;
        this.Statistics = { StructurePasses: 0, IncrementalPasses: 0, PeerVisits: 0,
            Projections: 0, AttributeWrites: 0, NodesCreated: 0, NodesRemoved: 0 };
    }
    get NeedsUpdate() { return this.StructureDirty || this.Dirty.size > 0 || this._focus !== this.Root.FocusManager.FocusedElement; }
    Invalidate(control, structure = false, subtree = false) {
        if (structure) this.StructureDirty = true;
        if (!control) return;
        const pending = [control];
        if (subtree) pending.push(...control.GetVisualDescendants());
        const seen = new Set();
        for (let i = 0; i < pending.length; ++i) {
            const owner = pending[i];
            if (seen.has(owner)) continue;
            seen.add(owner); this.Dirty.add(owner);
            for (const dependent of this._dependents.get(owner) ?? []) pending.push(dependent);
        }
    }
    _Attribute(element, name, value) {
        value = value == null ? null : String(value);
        if (element.getAttribute(name) === value) return;
        if (value == null) element.removeAttribute(name); else element.setAttribute(name, value);
        this.Statistics.AttributeWrites++;
    }
    _Attributes(element, values, previous) {
        for (const name of Object.keys(previous)) if (!(name in values)) this._Attribute(element, name, null);
        for (const [name, value] of Object.entries(values)) this._Attribute(element, name, value);
    }
    _Create(peer) {
        const root = this.Root, owner = peer.Owner, element = root._document.createElement('div');
        element.id = `avalonia-peer-${owner.VisualId}`; element.tabIndex = -1;
        const activate = event => {
            if (!peer.IsEnabled()) return;
            event.stopPropagation();
            if (owner.Focusable) owner.Focus();
            const invoke = peer.GetPattern('Invoke'), select = peer.GetPattern('SelectionItem'), expand = peer.GetPattern('ExpandCollapse');
            if (invoke) invoke.Invoke();
            else if (select) select.Select();
            else if (expand) expand.ExpandCollapseState === 1 ? expand.Collapse() : expand.Expand();
        };
        element.addEventListener('click', activate);
        element.addEventListener('keydown', event => {
            if (peer.GetPattern('RangeValue') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                const args = new KeyEventArgs(InputElement.KeyDownEvent, owner, keys[event.key] ?? event.key, ModifiersFromDom(event), event);
                owner.RaiseEvent(args); if (args.Handled) { event.preventDefault(); event.stopPropagation(); }
            } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event); }
        });
        element.addEventListener('focus', () => { if (owner.Focusable && peer.IsEnabled()) owner.Focus(); });
        const record = { Owner: owner, Peer: peer, Element: element, Attributes: {}, Dependencies: [], HasChildren: false };
        this.Records.set(owner, record); root._ariaNodes.set(owner, element); this.Statistics.NodesCreated++;
        return record;
    }
    _SetDependencies(record, sources) {
        // A label may live outside the visual tree (and therefore has no root
        // invalidation hook). Share one subscription per source, including
        // transitive LabeledBy chains. Diff links rather than resubscribing on
        // every value update; release them when the last consumer disappears.
        for (const source of record.Dependencies) if (!sources.has(source)) {
            const consumers = this._dependents.get(source);
            consumers?.delete(record.Owner);
            if (!consumers?.size) {
                this._dependents.delete(source);
                for (const subscription of this._dependencySubscriptions.get(source) ?? []) subscription.Dispose();
                this._dependencySubscriptions.delete(source);
            }
        }
        for (const source of sources) if (!record.Dependencies.includes(source)) {
            let consumers = this._dependents.get(source);
            if (!consumers) {
                this._dependents.set(source, consumers = new Set());
                const invalidate = () => this.Root._InvalidateAutomation(source);
                this._dependencySubscriptions.set(source, [source.PropertyChanged.Add(invalidate), source.Disposed.Add(invalidate)]);
            }
            consumers.add(record.Owner);
        }
        record.Dependencies = [...sources];
    }
    _Unlink(record) { this._SetDependencies(record, new Set()); }
    _NameDependencies(owner) {
        const sources = new Set(), visited = new Set([owner]), pending = [owner];
        for (let i = 0; i < pending.length; ++i) {
            const control = pending[i];
            for (const source of [AutomationProperties.GetLabeledBy(control), control.Content instanceof Control ? control.Content : null]) {
                if (!(source instanceof Control) || source.IsDisposed || visited.has(source)) continue;
                visited.add(source); sources.add(source); pending.push(source);
            }
        }
        return sources;
    }
    _Project(record) {
        const root = this.Root, owner = record.Owner, peer = record.Peer, element = record.Element;
        const attributes = GetAutomationAriaProperties(peer);
        this.Statistics.Projections++;
        if (peer instanceof TextBoxAutomationPeer && owner === root.FocusManager.FocusedElement) {
            const input = root._textInput;
            if (input) {
                this._Attributes(input, attributes, this._inputAttributes ?? {});
                this._inputAttributes = { ...attributes };
                input.id ||= `avalonia-editor-${root.VisualId}`;
            }
            attributes['aria-hidden'] = 'true';
        }
        const native = owner.NativeHandle?.Handle;
        if(owner.WorkerModule && root.IsWorkerRoot)attributes['aria-owns']=`avalonia-native-${owner.VisualId}`;
        if (native?.nodeType === 1) { native.id ||= `avalonia-native-${owner.VisualId}`; attributes['aria-owns'] = native.id; }
        this._Attributes(element, attributes, record.Attributes);
        record.Attributes = attributes;
        if (!record.HasChildren && peer instanceof TextBoxAutomationPeer) {
            const value = peer.Value;
            if (element.textContent !== value) element.textContent = value;
        } else if (!record.HasChildren && element.childNodes.length) element.textContent = '';
        this._SetDependencies(record, this._NameDependencies(owner));
    }
    Flush() {
        const root = this.Root;
        if (!root._aria || !this.NeedsUpdate) return;
        const focus = root.FocusManager.FocusedElement;
        if (focus !== this._focus) {
            this.Invalidate(this._focus); this.Invalidate(focus);
            this._focus = focus;
        }
        // Consume a snapshot. A custom peer may invalidate while being queried;
        // such work stays queued for the next frame rather than being lost.
        const dirty = this.Dirty; this.Dirty = new Set();
        const structural = this.StructureDirty; this.StructureDirty = false;
        this._Attribute(root._aria, 'role', 'application');
        this._Attribute(root._aria, 'aria-label', root.Title || 'Avalonia application');
        if (structural) {
            this.Statistics.StructurePasses++;
            const alive = new Set(), desired = new Map();
            const visit = (peer, parent) => {
                const owner = peer?.Owner;
                if (!owner || owner.IsDisposed || !owner.IsEffectivelyVisible) return;
                this.Statistics.PeerVisits++;
                if (!peer.IsControlElement()) { for (const child of peer.GetChildren()) visit(child, parent); return; }
                alive.add(owner);
                const existing = this.Records.get(owner), record = existing ?? this._Create(peer), element = record.Element;
                let order = desired.get(parent); if (!order) desired.set(parent, order = []); order.push(element);
                const children = peer.GetChildren();
                const childrenChanged = record.HasChildren !== (children.length > 0);
                record.HasChildren = children.length > 0;
                if (!existing || dirty.has(owner) || childrenChanged) this._Project(record);
                for (const child of children) visit(child, element);
            };
            for (const peer of root.GetOrCreateAutomationPeer().GetChildren()) visit(peer, root._aria);
            for (const [owner, record] of this.Records) if (!alive.has(owner)) {
                this._Unlink(record); record.Element.remove(); this.Records.delete(owner); root._ariaNodes.delete(owner);
                this.Statistics.NodesRemoved++;
            }
            // Raw (non-control) peers are flattened into their nearest exposed
            // parent, so this also handles reordering through unexposed panels.
            for (const [parent, children] of desired) {
                let next = parent.firstChild;
                for (const child of children) {
                    if (child !== next) parent.insertBefore(child, next);
                    next = child.nextSibling;
                }
            }
        } else {
            this.Statistics.IncrementalPasses++;
            for (const owner of dirty) {
                const record = this.Records.get(owner);
                if (record && !owner.IsDisposed) this._Project(record);
            }
        }
        const editorRecord = focus instanceof TextBox ? this.Records.get(focus) : null;
        const editorParent = editorRecord?.Element.parentNode ?? null;
        const input = root._textInput;
        if (this._editorParent && this._editorParent !== editorParent) {
            const tokens = (this._editorParent.getAttribute('aria-owns') ?? '').split(/\s+/).filter(id => id && id !== this._editorId);
            this._Attribute(this._editorParent, 'aria-owns', tokens.length ? tokens.join(' ') : null);
        }
        if (editorParent && input) {
            const tokens = new Set((editorParent.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean));
            if (this._editorId) tokens.delete(this._editorId);
            tokens.add(input.id); this._Attribute(editorParent, 'aria-owns', [...tokens].join(' '));
        }
        this._editorParent = editorParent; this._editorId = editorParent ? input?.id : null;
        const active = root._ariaNodes.get(focus);
        this._Attribute(root._canvas, 'aria-activedescendant', active && !(focus instanceof TextBox) && !focus?.NativeHandle ? active.id : null);
        this._Attribute(root._canvas, 'role', 'application');
    }
    Dispose() {
        for (const subscriptions of this._dependencySubscriptions.values()) for (const subscription of subscriptions) subscription.Dispose();
        this._dependencySubscriptions.clear();
        this.Records.clear(); this.Dirty.clear(); this._dependents.clear();
        this.Root._ariaNodes.clear(); this._editorParent = null; this._focus = null;
    }
}
