import * as A from '@wieslawsoltes/avalonia';
const control = (Type, properties = {}) => Object.assign(new Type(), properties);
const label = (value, size = 16) => control(A.TextBlock, { Text: value, FontSize: size, Foreground: '#ffffff', TextWrapping: 'Wrap' });

class PatternControl extends A.Control {
    constructor() { super(); this.DrawCount = 0; this.Phase = 0; }
    Render(context) {
        ++this.DrawCount;
        const gradient = new A.LinearGradientBrush();
        gradient.GradientStops.AddRange([new A.GradientStop(A.Color.Parse('#5743AE'), 0), new A.GradientStop(A.Color.Parse('#229DA2'), 1)]);
        context.DrawRectangle(gradient, null, new A.Rect(this.Bounds.Size), 12);
        for (let i = 0; i < 52; ++i) {
            const x = (i * 37 + this.Phase * 17) % Math.max(1, this.Bounds.Width);
            const y = (i * 61 + this.Phase * 11) % Math.max(1, this.Bounds.Height);
            context.DrawEllipse(i % 2 ? '#33FFFFFF' : '#449CB7F6', null, new A.Rect(x - 15, y - 15, 30 + i % 25, 30 + i % 25));
        }
    }
}
export class TriangleControl extends A.OpenGlControlBase {
    constructor() { super(); this.Angle = 0; this.FrameCount = 0; this.InitCount = 0; this.DeinitCount = 0; this.LostCount = 0; }
    OnOpenGlInit() {
        this.InitCount++;
        this.Program = this.Context.CreateProgram(`#version 300 es
precision highp float;
uniform float angle; out vec3 vColor;
const vec2 positions[3] = vec2[3](vec2(0.0,0.8),vec2(-0.76,-0.62),vec2(0.76,-0.62));
const vec3 colors[3] = vec3[3](vec3(0.67,0.5,1.0),vec3(0.12,0.84,0.85),vec3(1.0,0.73,0.43));
void main(){vec2 p=positions[gl_VertexID];float c=cos(angle),s=sin(angle);gl_Position=vec4(c*p.x-s*p.y,s*p.x+c*p.y,0.0,1.0);vColor=colors[gl_VertexID];}`,
`#version 300 es
precision highp float; in vec3 vColor; out vec4 fragColor; void main(){fragColor=vec4(vColor,1.0);}`);
        this.Uniform = this.Context.Gl.getUniformLocation(this.Program, 'angle');
    }
    OnOpenGlRender(api) {
        const gl = api.Context;
        gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.clearColor(.065, .075, .13, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.Program); gl.uniform1f(this.Uniform, this.Angle); gl.drawArrays(gl.TRIANGLES, 0, 3); ++this.FrameCount;
    }
    OnOpenGlLost() { this.LostCount++; this.Program = null; }
    OnOpenGlDeinit(api) { this.DeinitCount++; if (this.Program) api.Context.deleteProgram(this.Program); this.Program = null; }
}

export async function ConfigureExtendedPage(catalog, id, page, model) {
    const find = name => page.FindControl(name), life = catalog._pageLifetime;
    if (id === 'ContainerQueries') {
        const slider = find('ContainerWidth'), host = find('QueryHost'), status = find('QueryStatus');
        life.Add(slider.GetObservable(A.Slider.ValueProperty).subscribe(width => { host.Width = Math.round(width); status.Text = `${Math.round(width)} px · query threshold 380 px`; }));
    }
    if (id === 'Acrylic') {
        const grid = new A.Grid(), pattern = new PatternControl(), panel = new A.StackPanel(); panel.Spacing = 14;
        panel.Children.AddRange([label('Light, color, material.', 27), label('The geometry behind this panel is sampled and blurred by native Skia.', 16)]);
        const acrylic = new A.ExperimentalAcrylicBorder(panel);
        acrylic.Material = new A.ExperimentalAcrylicMaterial({ TintColor: '#32295A', TintOpacity: .35, BlurRadius: 18 });
        acrylic.Padding = new A.Thickness(24); acrylic.Margin = new A.Thickness(44); acrylic.CornerRadius = new A.CornerRadius(16);
        acrylic.BorderBrush = '#55FFFFFF'; acrylic.BorderThickness = new A.Thickness(1);
        grid.Children.AddRange([pattern, acrylic]); find('AcrylicSlot').Child = grid; catalog.AcrylicMaterial = acrylic.Material;
        life.Add(find('AcrylicTint').GetObservable(A.Slider.ValueProperty).subscribe(v => acrylic.Material.TintOpacity = v));
        life.Add(find('AcrylicBlur').GetObservable(A.Slider.ValueProperty).subscribe(v => acrylic.Material.BlurRadius = v));
    }
    if (id === 'BitmapCache') {
        const cached = new PatternControl(), direct = new PatternControl(); cached.CacheMode = new A.BitmapCache();
        A.Grid.SetColumn(direct, 1); find('CacheSlot').Children.AddRange([cached, direct]); catalog.CacheDemo = { Cached: cached, Direct: direct };
        const update = async () => { await catalog.Root.RenderNow(); find('CacheStatus').Text = `Actual Render calls — cached: ${cached.DrawCount}; uncached: ${direct.DrawCount}`; };
        life.Add(find('RedrawCache').Click.Add(update));
        life.Add(find('InvalidateCache').Click.Add(() => { cached.Phase++; direct.Phase++; cached.InvalidateVisual(); direct.InvalidateVisual(); update(); }));
        find('CacheStatus').Text = 'Use Redraw host, then Change geometry, to inspect cache reuse.';
    }
    if (id === 'Composition') {
        const host = find('CompositionHost'), compositor = A.ElementComposition.GetElementVisual(host).Compositor;
        const group = compositor.CreateContainerVisual(), tile = compositor.CreateSolidColorVisual(A.Color.Parse('#9D83FB'));
        tile.Size = { X: 96, Y: 96 }; tile.Offset = { X: 24, Y: 72, Z: 0 };
        const follower = compositor.CreateSolidColorVisual(A.Color.Parse('#53CDC1')); follower.Size = { X: 42, Y: 42 }; follower.Offset = { X: 180, Y: 99, Z: 0 };
        group.Children.Add(tile); group.Children.Add(follower); A.ElementComposition.SetElementChildVisual(host, group);
        await compositor.RequestCommitAsync();
        const animation = compositor.CreateScalarKeyFrameAnimation(); animation.Duration = 1800; animation.IterationBehavior = 'Forever'; animation.Direction = 'Alternate';
        animation.InsertKeyFrame(0, 24); animation.InsertKeyFrame(1, 340);
        const expression = compositor.CreateExpressionAnimation('Vector3(440 - leader.Offset.X, 100 + Sin(leader.Offset.X / 40) * 50, 0)'); expression.SetReferenceParameter('leader', tile);
        const implicitOffset=compositor.CreateVector3KeyFrameAnimation();implicitOffset.Duration=650;implicitOffset.Target='Offset';implicitOffset.InsertExpressionKeyFrame(1,'this.FinalValue');
        const implicitScale=compositor.CreateVector3KeyFrameAnimation();implicitScale.Duration=650;implicitScale.Target='Scale';implicitScale.InsertKeyFrame(.5,{X:1.12,Y:1.12,Z:1});implicitScale.InsertKeyFrame(1,{X:1,Y:1,Z:1});
        const implicitGroup=compositor.CreateAnimationGroup();implicitGroup.Add(implicitOffset);implicitGroup.Add(implicitScale);
        const implicitAnimations=compositor.CreateImplicitAnimationCollection();implicitAnimations.Add('Offset',implicitGroup);
        catalog.CompositionDemo = { Compositor: compositor, Group: group, Tile: tile, Follower: follower, Animation: animation, ImplicitAnimations:implicitAnimations };
        life.Add(find('MoveImplicitComposition').Click.Add(()=>{
            // Stop the forever demo only on entry. Repeated destination changes
            // interrupt the implicit run from its current rendered presentation.
            if(tile.ImplicitAnimations!==implicitAnimations){tile.StopAllAnimations();follower.StopAllAnimations();tile.ImplicitAnimations=implicitAnimations;follower.ImplicitAnimations=implicitAnimations;}
            const destination=tile.Offset.X<100?Math.max(100,Math.min(340,host.Bounds.Width-112)):24;
            tile.Offset={X:destination,Y:72,Z:0};follower.Offset={X:destination<100?180:24,Y:99,Z:0};
            find('CompositionStatus').Text='Implicit group · Offset + Scale · click again to retarget';
        }));
        life.Add(find('ClearImplicitComposition').Click.Add(()=>{
            tile.ImplicitAnimations=null;follower.ImplicitAnimations=null;tile.StopAllAnimations();follower.StopAllAnimations();
            find('CompositionStatus').Text='Implicit definitions detached · base destinations retained';
        }));
        life.Add(find('AnimateComposition').Click.Add(() => { tile.ImplicitAnimations=null;follower.ImplicitAnimations=null;tile.StopAllAnimations();follower.StopAllAnimations();tile.StartAnimation('Offset.X', animation); follower.StartAnimation('Offset', expression); find('CompositionStatus').Text = 'Running · keyframes + expression animation'; }));
        life.Add(find('StopComposition').Click.Add(() => { tile.StopAllAnimations(); follower.StopAllAnimations(); find('CompositionStatus').Text = 'Stopped · base values restored'; }));
        life.Add(A.Disposable.Create(() => { tile.StopAnimation('Offset.X'); follower.StopAnimation('Offset'); implicitAnimations.Dispose();implicitGroup.Dispose();implicitOffset.Dispose();implicitScale.Dispose();group.Dispose(); tile.Dispose(); follower.Dispose(); animation.Dispose(); expression.Dispose(); }));
        find('CompositionStatus').Text = 'Ready · committed child visuals attached to the control';
    }
    if (['OpenGL', 'OpenGLLease', 'OpenGLInterop'].includes(id)) {
        const gl = new TriangleControl(), status = find('GlStatus');
        // A capability absence is displayed explicitly; it is not a fake rendering fallback.
        const probe = (catalog.Root.IsWorkerRoot ? new OffscreenCanvas(1,1) : catalog.Root._document.createElement('canvas')), available = probe.getContext('webgl2');
        if (!available) { status.Text = 'WebGL2 is unavailable in this browser/device. This demonstration is capability-skipped.'; catalog.GlDemo = null; return; }
        available.getExtension('WEBGL_lose_context')?.loseContext();
        catalog.GlDemo = gl;
        life.Add(gl.RenderError.Add((_, e) => { status.Text = e.Error.message; }));
        if (id === 'OpenGLInterop') { gl.Margin = new A.Thickness(24); gl.Opacity = .92; gl.RenderTransform = new A.RotateTransform(3); }
        find('GlSlot').Child = gl;
        life.Add(find('GlRedraw').Click.Add(() => { gl.Angle += .35; gl.RequestNextFrameRendering(); status.Text = `Requested frame · angle ${gl.Angle.toFixed(2)} radians`; }));
        life.Add(find('GlLease').Click.Add(() => {
            if (!gl.Context || !gl.IsInitializedSuccessfully) return;
            const native = gl.Context.Gl, before = Array.from(native.getParameter(native.VIEWPORT));
            const lease = gl.Context.MakeCurrent(); try { native.viewport(5, 6, 7, 8); native.clearColor(1, 0, 0, 1); } finally { lease.Dispose(); }
            const after = Array.from(native.getParameter(native.VIEWPORT)), restored = before.every((x, i) => x === after[i]);
            status.Text = restored ? 'Lease restored viewport and documented GL states.' : 'State restoration failed.';
        }));
        status.Text = 'WebGL2 · native shader → RGBA readback → Skia image';
    }
    if (id === 'NativeEmbed' && catalog.Root.IsWorkerRoot) {
        const host=new A.HtmlControlHost();host.WorkerModule=catalog.Root.HostSnapshot.NativeDemoModule;host.WorkerState={Name:model.Name};catalog.NativeDemo=host;
        life.Add(host.NativeMessage.Add((_,e)=>{model.Name=String(e.Value.Name??'');find('NativeModelEditor').Text=model.Name;}));
        life.Add(find('NativeModelEditor').GetObservable(A.TextBox.TextProperty).subscribe(value=>{host.WorkerState={Name:value??''};host.GetVisualRoot()?._RequestRender();}));find('NativeSlot').Child=host;
    }
    if (id === 'NativeEmbed' && !catalog.Root.IsWorkerRoot) {
        const host = new A.HtmlControlHost(); catalog.NativeDemo = host;
        host.NativeControlFactory = parent => {
            const doc = parent.Handle.ownerDocument, section = doc.createElement('section');
            section.style.cssText = 'box-sizing:border-box;height:100%;padding:18px;background:#eeeafa;border:1px solid #cdc2ec;border-radius:12px;font:14px system-ui;color:#3d3555;';
            const label = doc.createElement('label'); label.textContent = 'Native browser input · connected to ReactiveWeb';
            label.style.cssText = 'display:grid;gap:12px';
            const input = doc.createElement('input'); input.id = 'native-demo-input'; input.type = 'text'; input.value = model.Name;
            input.style.cssText = 'box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #9886c8;border-radius:6px;font:16px system-ui;';
            label.append(input); section.append(label);
            const changed = () => model.Name = input.value; input.addEventListener('input', changed);
            life.Add(A.Disposable.Create(() => input.removeEventListener('input', changed)));
            const text = find('NativeModelEditor'); life.Add(text.GetObservable(A.TextBox.TextProperty).subscribe(value => { if (input.value !== value) input.value = value ?? ''; }));
            return section;
        };
        find('NativeSlot').Child = host;
    }
}
