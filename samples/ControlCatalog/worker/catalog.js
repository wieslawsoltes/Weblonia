import * as A from "../../../packages/browser/worker-assets/packages/avalonia/src/index.js";
import { ReactiveObject, ReactiveCommand } from "../../../packages/browser/worker-assets/vendor/reactiveweb.browser.js";
import { Subject, debounceTime, distinctUntilChanged } from "../../../packages/browser/worker-assets/vendor/rxjs.js";
import { GetRuntimeDiagnostics, GetVisualTree } from "../../../packages/browser/worker-assets/packages/diagnostics/src/index.js";
import { Catalog } from './manifest.js';
import { ConfigureExtendedPage } from './extensions.js';
import { Builders, Sources } from './compiled/index.js';
const $ = (type, properties = {}, children = []) => {
    const c = new type();
    Object.assign(c, properties);
    if (c.Children?.AddRange)
        c.Children.AddRange(children);
    return c;
};
const text = (value, size = 14, properties = {}) => $(A.TextBlock, { Text: String(value), FontSize: size, TextWrapping: 'Wrap', ...properties });
const stack = (children, spacing = 12) => $(A.StackPanel, { Spacing: spacing }, children);
const row = children => $(A.StackPanel, { Orientation: 'Horizontal', Spacing: 12 }, children);
const card = (title, content) => {
    const b = new A.Border(stack([text(title, 17, { FontWeight: 'SemiBold' }), content], 18));
    b.Classes.Add('card');
    return b;
};
const button = (label, action, properties = {}) => {
    const b = $(A.Button, { Content: label, ...properties });
    b.Click.Add(action);
    return b;
};
function resource(target, property, key) {
    target.Bind(A.AvaloniaProperty.FindRegistered(target, property), A.GetResourceObservable(target, `System${key}Brush`));
}
class DrawingDemo extends A.Control {
    MeasureOverride() {
        return new A.Size(680, 350);
    }
    Render(ctx) {
        const width = this.Bounds.Width, height = this.Bounds.Height;
        const gradient = new A.LinearGradientBrush();
        gradient.GradientStops.Add(new A.GradientStop(A.Color.Parse('#7862E5'), 0));
        gradient.GradientStops.Add(new A.GradientStop(A.Color.Parse('#3B93B1'), 1));
        ctx.DrawRectangle(gradient, null, new A.Rect(0, 0, width, height), 12);
        for (let i = 0; i < 18; i++) {
            const x = width * i / 17;
            ctx.DrawLine(new A.Pen('#22FFFFFF', 1), new A.Point(x, 0), new A.Point(x, height));
        }
        for (let y = 0; y < height; y += 26)
            ctx.DrawLine(new A.Pen('#22FFFFFF', 1), new A.Point(0, y), new A.Point(width, y));
        const save = ctx.PushTransform(A.Matrix.CreateTranslation(width * .68, height * .52));
        try {
            for (let i = 0; i < 7; i++) {
                const state = ctx.PushTransform(A.Matrix.CreateRotation(i * Math.PI / 7));
                try {
                    ctx.DrawEllipse(null, new A.Pen('#BBFFFFFF', 1.3), new A.Rect(-118, -47, 236, 94));
                }
                finally {
                    state.Dispose();
                }
            }
            ctx.DrawEllipse('#FFFFFF', null, new A.Rect(-9, -9, 18, 18));
        }
        finally {
            save.Dispose();
        }
        this.DrawText(ctx, 'Draw once.\nRender anywhere.', new A.Rect(35, 36, width * .50, 140), { Foreground: '#FFFFFF', FontSize: 30 });
        this.DrawText(ctx, 'PATHS  /  GRADIENTS  /  TRANSFORMS', new A.Rect(36, height - 60, width - 70, 30), { Foreground: '#CCFFFFFF', FontSize: 11 });
    }
}
export class CatalogController {
    constructor() {
        this.Model = new ReactiveObject({ Query: '', CurrentTitle: 'Build for the browser.', Breadcrumb: 'AVALONIA WEB  /  CONTROL CATALOG', Description: 'The familiar retained UI model, reimplemented in JavaScript and rendered by native Skia.', Status: 'Ready · JavaScript runtime · XamlX compiler integration', RendererStatus: 'Native Skia · loading' });
        this._query = new Subject();
        this._query.pipe(debounceTime(100), distinctUntilChanged()).subscribe(() => this.BuildNavigation());
        this.Model.WhenAnyValue('Query').subscribe(q => this._query.next(q));
        this._pageLifetime = new A.CompositeDisposable();
        this._generation = 0;
        this._pageCounter = 0;
    }
    CreateView() {
        this.View = Builders.MainView(new A.AvaloniaXamlServices({ DataContext: this.Model, CodeBehind: this }));
        this.BuildNavigation();
        return this.View;
    }
    Find(name) {
        return this.View.FindControl(name);
    }
    async Start(root) {
        this.Root = root;
        this._notifications = new A.WindowNotificationManager(root);
        root.AllowDrop = true;
        root.Drop.Add((_, e) => this._OnDrop(e));
        root.RenderError.Add((_, e) => {
            this.Errors.push(e.Error.message);
            this.Model.Status = `Render error: ${e.Error.message}`;
        });
        root.Resized.Add((_, e) => {
            const narrow = e.ClientSize.Width < 850;
            this.Find('Workspace').ColumnDefinitions.Get(0).Width = new A.GridLength(narrow ? 208 : 258);
        });
        this.Errors = [];
        await this.Home();
    }
    BuildNavigation() {
        if (!this.View)
            return;
        const panel = this.Find('NavigationItems');
        const old = panel.Children.ToArray();
        panel.Children.Clear();
        for (const c of old)
            c.Dispose();
        let category = null;
        const query = this.Model.Query.trim().toLowerCase();
        this._nav = new Map();
        for (const entry of Catalog) {
            if (query && !`${entry.Title} ${entry.Category}`.toLowerCase().includes(query))
                continue;
            if (category !== entry.Category) {
                category = entry.Category;
                const label = text(category.toUpperCase(), 10, { FontWeight: 'SemiBold', Margin: new A.Thickness(10, 16, 0, 5) });
                label.Classes.Add('muted');
                panel.Children.Add(label);
            }
            const nav = button(`${entry.Status === 'not-implemented' ? '◌' : '·'}   ${entry.Title}`, () => this.Navigate(entry.Id), { Height: 33, FontSize: 13, Name: `Nav_${entry.Id}` });
            nav.Classes.Add('nav');
            if (this.CurrentId === entry.Id)
                nav.Classes.Add('selected');
            panel.Children.Add(nav);
            this._nav.set(entry.Id, nav);
        }
    }
    _ReplacePage(page) {
        const host = this.Find('PageHost'), prior = host.Content;
        host.Content = null;
        prior?.Dispose();
        host.Content = page;
        this.Find('PageScroll').Offset = new A.Point();
        this._pageLifetime.Clear();
        this.Page = page;
    }
    async Home() {
        this.CurrentId = null;
        this.Model.CurrentTitle = 'Build for the browser.';
        this.Model.Breadcrumb = 'AVALONIA WEB  /  OVERVIEW';
        this.Model.Description = 'Explore controls, data binding, XAML compilation and browser services in one retained UI runtime.';
        this.Find('SourcePane').IsVisible = false;
        const hero = new DrawingDemo();
        hero.Height = 230;
        const body = stack([hero], 20);
        const counts = row([this._Metric('18', 'workspace packages'), this._Metric('74', 'tracked catalog routes'), this._Metric('74', 'browser demonstrations'), this._Metric('75', 'AOT XAML modules')]);
        body.Children.Add(counts);
        const grid = new A.Grid();
        grid.ColumnDefinitions = '*,*';
        grid.RowDefinitions = 'Auto,Auto,Auto';
        grid.ColumnSpacing = 18;
        grid.RowSpacing = 18;
        const tiles = [['Buttons', 'Basic input', 'Buttons, checkboxes, sliders and keyboard commands.'], ['ListBox', 'Collections & data', 'Virtual lists and tables, selection and hierarchical trees.'], ['TextBox', 'Text & binding', 'Two-way ReactiveWeb models, text editing and browser IME.'], ['CustomDrawing', 'Media & graphics', 'Native Skia geometry, clipping, gradients and transforms.'], ['NavigationPage', 'Navigation & pages', 'Navigation stacks, tabs, drawers and collapsible panes.'], ['Dialogs', 'Window & platform', 'Browser-owned windows, clipboard and file services.']];
        for (const [i, [id, title, detail]] of tiles.entries()) {
            const content = stack([text(detail, 13), button('Explore  →', () => this.Navigate(id), { HorizontalAlignment: 'Left', Margin: new A.Thickness(0, 6, 0, 0) })]);
            const tile = card(title, content);
            A.Grid.SetRow(tile, Math.floor(i / 2));
            A.Grid.SetColumn(tile, i % 2);
            grid.Children.Add(tile);
        }
        body.Children.Add(grid);
        body.Children.Add(text('This alpha is a JavaScript reimplementation, not full Avalonia or XamlX parity. Every route exposes its source; browser adaptations and remaining conformance boundaries are documented explicitly.', 12, { Margin: new A.Thickness(0, 2) }));
        this._ReplacePage(body);
        this.BuildNavigation();
        this._UpdateStatus();
        return body;
    }
    _Metric(value, label) {
        const b = new A.Border(stack([text(value, 27, { FontWeight: 'SemiBold' }), text(label, 11)], 4));
        b.Padding = new A.Thickness(16, 12);
        b.CornerRadius = new A.CornerRadius(7);
        resource(b, 'Background', 'Surface');
        b.MinWidth = 135;
        return b;
    }
    CreateModel() {
        const vm = new ReactiveObject({ Name: 'Ada Lovelace', Checked: true, Value: 42, Counter: 0, Languages: ['C#', 'JavaScript', 'TypeScript', 'F#', 'Rust', 'Swift', 'Kotlin', 'Python'], LargeItems: Array.from({ length: 10000 }, (_, i) => `Item ${String(i).padStart(5, '0')}  ·  Retained visual collection`), Rows: Array.from({ length: 180 }, (_, i) => ({ Component: ['Avalonia.Base', 'Avalonia.Controls', 'Avalonia.Skia', 'XamlX', 'ReactiveUI'][i % 5], Category: ['Runtime', 'Controls', 'Renderer', 'Compiler', 'MVVM'][i % 5], Exports: 10 + i * 3, Enabled: i % 4 !== 0 })) });
        vm.IncrementCommand = ReactiveCommand.Create(() => vm.Counter++);
        vm.ResetCommand = ReactiveCommand.Create(() => vm.Counter = 0);
        return vm;
    }
    async Navigate(id) {
        const entry = Catalog.find(e => e.Id === id);
        if (!entry)
            throw new Error(`Unknown catalog route ${id}.`);
        const generation = ++this._generation;
        this.CurrentId = id;
        this.Model.CurrentTitle = entry.Title;
        this.Model.Breadcrumb = `${entry.Category.toUpperCase()}  /  ${entry.Title}`;
        this.Model.Description = entry.Description;
        this.Find('SourceEditor').Text = Sources[id];
        try {
            const vm = this.CreateModel();
            const page = Builders[id](new A.AvaloniaXamlServices({ DataContext: vm, CodeBehind: this }));
            this._ReplacePage(page);
            this.PageModel = vm;
            this._pageLifetime.Add(vm);
            this._pageLifetime.Add(vm.IncrementCommand);
            this._pageLifetime.Add(vm.ResetCommand);
            await this.ConfigurePage(id, page, vm);
            if (generation !== this._generation)
                return;
            this.BuildNavigation();
            this.Model.Status = entry.Status === 'not-implemented' ? `Not implemented · ${entry.Title} · see compatibility notes` : `${entry.Title} · JavaScript demonstration · AOT XAML construction`;
            await this.Root.RenderNow();
            this._UpdateStatus(false);
            return page;
        }
        catch (error) {
            this.Errors.push(`${id}: ${error.message}`);
            this.Model.Status = `${id}: ${error.message}`;
            this._ReplacePage(card('Page failed', text(error.stack, 13)));
            throw error;
        }
    }
    async ConfigurePage(id, page, vm) {
        const find = name => page.FindControl(name);
        this.PageFind = find;
        await ConfigureExtendedPage(this, id, page, vm);
        if (id === 'ButtonSpinner')
            find('Spinner').Spin.Add((_, e) => vm.Counter += e.Direction === 'Increase' ? 1 : -1);
        if (id === 'ComboBox')
            find('Combo').SelectionChanged.Add(() => find('ChoiceText').Text = `Selected: ${find('Combo').SelectedItem}`);
        if (id === 'ListBox')
            find('VirtualList').SelectionChanged.Add(() => {
                find('ListSelection').Text = `Selected index: ${find('VirtualList').SelectedIndex}\nRealized: ${find('VirtualList').GetRealizedContainers().length}`;
            });
        if (id === 'PipsPager')
            this._pageLifetime.Add(find('Pips').GetObservable(A.PipsPager.SelectedPageIndexProperty).subscribe(index => find('PipsText').Text = `Page ${index + 1} of 7`));
        if (id === 'TreeView') {
            const tree = find('Tree');
            tree.ItemsSource = [{ Header: 'AvaloniaWeb', Children: [{ Header: 'packages', Children: ['base', 'controls', 'media', 'browser', 'skia', 'xamlx'].map(Header => ({ Header, Children: [{ Header: 'src/index.js' }] })) }, { Header: 'samples', Children: [{ Header: 'ControlCatalog', Children: [{ Header: 'MainView.axaml' }, { Header: 'app.js' }] }] }, { Header: 'tests' }] }];
            tree.ExpandSubTree(tree.ItemsSource[0]);
        }
        if (id === 'Calendar')
            find('Calendar').SelectedDatesChanged.Add(() => find('DateText').Text = find('Calendar').SelectedDate?.toLocaleDateString() ?? 'None');
        if (id === 'CalendarDatePicker')
            find('DatePicker').SelectedDateChanged.Add(() => find('DateText').Text = find('DatePicker').SelectedDate?.toLocaleDateString() ?? 'None');
        if (['Menu', 'CommandBar'].includes(id)) {
            const menu = find('MenuHost');
            for (const [header, values] of [['File', ['New', 'Open', 'Save']], ['Edit', ['Undo', 'Redo', 'Copy', 'Paste']], ['View', ['Light theme', 'Dark theme']]]) {
                const item = new A.MenuItem(header);
                for (const label of values) {
                    const child = new A.MenuItem(label);
                    child.Click.Add(() => {
                        find('MenuStatus').Text = `${header} → ${label}`;
                        if (label.includes('theme'))
                            this.SetTheme(label.startsWith('Dark') ? 'Dark' : 'Light');
                    });
                    item.Items.Add(child);
                }
                menu.Items.Add(item);
            }
        }
        if (['TabControl', 'TabbedPage', 'TabStrip'].includes(id)) {
            const tabs = find('Tabs');
            for (const label of ['Overview', 'Details', 'Activity']) {
                const item = new A.TabItem();
                item.Header = label;
                item.Content = new A.Border(text(`${label} content`, 25));
                item.Content.Padding = new A.Thickness(30);
                tabs.Items.Add(item);
            }
            tabs.SelectedIndex = 0;
        }
        if (['Carousel', 'CarouselPage'].includes(id)) {
            const carousel = find('Carousel');
            for (const [i, color] of ['#6757D9', '#29988B', '#BD7453'].entries()) {
                const b = new A.Border(text(`Slide ${i + 1}`, 35, { Foreground: A.Brushes.White, HorizontalAlignment: 'Center', VerticalAlignment: 'Center' }));
                b.Background = color;
                b.CornerRadius = new A.CornerRadius(10);
                carousel.Items.Add(b);
            }
            carousel.SelectedIndex = 0;
        }
        if (['SplitView', 'DrawerPage'].includes(id)) {
            const split = find('Split');
            split.Pane = new A.Border(stack([text('Navigation', 18), text('Overview'), text('Projects'), text('Settings')]));
            split.Pane.Padding = new A.Thickness(18);
            resource(split.Pane, 'Background', 'Selection');
            split.Content = new A.Border(text('The content remains in the same visual tree.', 20));
            split.Content.Padding = new A.Thickness(25);
            split.OpenPaneLength = 220;
        }
        if (id === 'NavigationPage')
            await find('Navigator').PushAsync(this.MakePage(1));
        if (id === 'FlexPanel' || id === 'WrapPanel') {
            const panel = find(id === 'FlexPanel' ? 'Flex' : 'Wrap');
            for (let i = 0; i < 16; i++) {
                const b = button(`Item ${i + 1}`, () => vm.Counter++, { Width: 135, Height: 42, Margin: new A.Thickness(5) });
                panel.Children.Add(b);
            }
        }
        if (id === 'ScrollViewer') {
            const viewer = find('DemoScrollViewer');
            for (let i = 0; i < 100; i++)
                find('ScrollItems').Children.Add(button(`Scrollable item ${i + 1} · a wide content surface · drag either thumb without activating this button`, () => vm.Counter++, { Height: 38 }));
            this._pageLifetime.Add(find('OverlayScrollBars').GetObservable(A.CheckBox.IsCheckedProperty).subscribe(value => viewer.AllowAutoHide = !!value));
            this._pageLifetime.Add(find('DeferredScrollBars').GetObservable(A.CheckBox.IsCheckedProperty).subscribe(value => viewer.IsDeferredScrollingEnabled = !!value));
            this._pageLifetime.Add(find('ScrollHome').Click.Add(() => viewer.ScrollToHome()));
            this._pageLifetime.Add(find('ScrollEnd').Click.Add(() => viewer.ScrollToEnd()));
            this._pageLifetime.Add(viewer.ScrollChanged.Add(() => find('ScrollPosition').Text = `Offset ${viewer.Offset.X.toFixed(0)}, ${viewer.Offset.Y.toFixed(0)} · viewport ${viewer.Viewport.Width.toFixed(0)} × ${viewer.Viewport.Height.toFixed(0)}`));
        }
        if (id === 'TextBox') {
            find('LongDocumentEditor').Text = Array.from({ length: 1000 }, (_, i) => `${String(i+1).padStart(4, '0')}    office affinity · source text · ${'horizontal and vertical scrolling  '.repeat(4)}`).join('\n');
        }
        if (id === 'CustomDrawing')
            find('DrawingHost').Content = new DrawingDemo();
        if (id === 'Image') {
            const canvas = typeof document === 'undefined' ? new OffscreenCanvas(720,300) : document.createElement('canvas');
            canvas.width = 720;
            canvas.height = 300;
            const c = canvas.getContext('2d'), g = c.createLinearGradient(0, 0, 720, 300);
            g.addColorStop(0, '#6757D9');
            g.addColorStop(1, '#29988B');
            c.fillStyle = g;
            c.fillRect(0, 0, 720, 300);
            for (let i = 0; i < 12; i++) {
                c.strokeStyle = '#ffffff88';
                c.lineWidth = 2;
                c.beginPath();
                c.arc(360, 150, 20 + i * 13, 0, Math.PI * 2);
                c.stroke();
            }
            const bitmap = new A.Bitmap(canvas.convertToBlob ? new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()) : canvas.toDataURL());
            await A.SkiaPlatform.Instance.LoadBitmap(bitmap);
            this._pageLifetime.Add(bitmap);
            find('BitmapImage').Source = bitmap;
        }
        if (id === 'TransitioningContentControl')
            find('TransitionHost').Content = this.MakePage(1);
        if (id === 'DataValidation') {
            const validator = { Convert: value => value, ConvertBack: value => {
                    if (String(value).trim().length < 3)
                        throw new Error('Use at least three characters.');
                    return value;
                } };
            const editor = find('Validated');
            editor.Bind(A.TextBox.TextProperty, new A.Binding({ Path: 'Name', Source: vm, Mode: 'TwoWay', Converter: validator }));
            this._pageLifetime.Add(A.BindingOperations.ValidationChanged.Add((target, e) => {
                if (target === editor)
                    find('ValidationText').Text = e.Error?.message ?? '';
            }));
        }
        if (id === 'Accelerator')
            find('AcceleratorTarget').KeyDown.Add((_, e) => {
                if (e.Key.toLowerCase() === 'k' && e.KeyModifiers & 10) {
                    find('AcceleratorTarget').OnClick();
                    e.Handled = true;
                }
            });
        if (id === 'Focus')
            for (const control of [find('FocusOne'), find('FocusTwo')])
                control.GotFocus.Add(() => find('FocusStatus').Text = `Focused: ${control.Name}`);
        if (id === 'Pointers') {
            const area = find('PointerArea');
            area.PointerMoved.Add((_, e) => {
                const p = e.GetPosition(area);
                find('PointerText').Text = `Pointer ${e.Pointer.Id} · ${e.Pointer.Type}\nX ${p.X.toFixed(1)}  /  Y ${p.Y.toFixed(1)}`;
            });
            area.PointerPressed.Add((_, e) => {
                e.Pointer.Capture(area);
                find('PointerText').Text = `Pointer captured · ${e.Pointer.Type}`;
            });
            area.PointerReleased.Add((_, e) => {
                e.Pointer.Capture(null);
                find('PointerText').Text = 'Pointer released';
            });
        }
        if (id === 'Gestures') {
            const area = find('PointerArea'), visual = find('GestureVisual'), scroll = find('GestureScroll');
            let baseScale = 1, scale = 1, degrees = 0, taps = 0;
            const update = () => find('GestureStatus').Text = `Taps: ${taps} · scroll offset: ${scroll.Offset.Y.toFixed(0)}`;
            area.Pinch.Add((_, e) => {
                scale = Math.max(.3, Math.min(3, baseScale * e.Scale));
                degrees += e.AngleDelta;
                visual.RenderTransform = A.TransformOperations.Parse(`rotate(${degrees}deg) scale(${scale})`);
                find('PointerText').Text = `Scale ${scale.toFixed(2)} · rotation ${degrees.toFixed(1)}°`;
                e.Handled = true;
            });
            area.PinchEnded.Add(() => { baseScale = scale; });
            for (let i = 0; i < 40; i++) {
                const button = new A.Button(`Item ${i + 1} — tap or drag`); button.Height = 42;
                button.Click.Add(() => { taps++; update(); });
                find('GestureItems').Children.Add(button);
            }
            scroll.ScrollChanged.Add(update);
        }
        if (id === 'PlatformInformation')
            find('PlatformDetails').Text = JSON.stringify({ JavaScript: navigator.userAgent, SecureContext: isSecureContext, DevicePixelRatio: this.Root.RenderScaling, WebGPU: !!navigator.gpu, Runtime: GetRuntimeDiagnostics(this.Root) }, null, 2);
        if (id === 'PlatformSettings')
            find('PlatformDetails').Text = JSON.stringify({ ColorScheme: this.Root.PlatformSettings.GetColorValues().ThemeVariant.Key === 'Dark' ? 'Dark' : 'Light', ReducedMotion: this.Root.PlatformSettings.ReducedMotion, Languages: navigator.languages, HardwareConcurrency: navigator.hardwareConcurrency, PointerCoarse: this.Root.HostSnapshot?.Media['(pointer: coarse)'] ?? matchMedia('(pointer: coarse)').matches }, null, 2);
        if (id === 'Screens')
            find('PlatformDetails').Text = JSON.stringify({ PrimaryScreen: { Width: this.Root.Screens.Primary.Bounds.Width, Height: this.Root.Screens.Primary.Bounds.Height, AvailableWidth: this.Root.Screens.Primary.WorkingArea.Width, AvailableHeight: this.Root.Screens.Primary.WorkingArea.Height, ColorDepth: this.Root.HostSnapshot?.Screen.colorDepth ?? screen.colorDepth }, MultiScreenPermissionApi: typeof window !== 'undefined' && 'getScreenDetails' in window, Note: 'Additional display enumeration requires browser support and user permission.' }, null, 2);
    }
    MakePage(index) {
        const page = new A.ContentPage();
        page.Title = `Page ${index}`;
        const border = new A.Border(stack([text(`Page ${index}`, 28), text('Push another page or return to the previous entry.', 14)]));
        border.Padding = new A.Thickness(28);
        border.CornerRadius = new A.CornerRadius(8);
        resource(border, 'Background', 'Selection');
        page.Content = border;
        return page;
    }
    ToggleSource() {
        const p = this.Find('SourcePane');
        p.IsVisible = !p.IsVisible;
        if (!this.CurrentId)
            this.Find('SourceEditor').Text = Sources.Buttons;
    }
    async ApplyXaml() {
        try {
            const source = this.Find('SourceEditor').Text;
            const compiler = new A.AvaloniaXamlCompiler();
            const compiled = compiler.Compile(source, { SourceFile: 'LiveEditor.axaml' });
            const page = compiled.Build({ DataContext: this.PageModel ?? this.CreateModel(), CodeBehind: this });
            const old = this.Find('PageHost').Content;
            this.Find('PageHost').Content = null;
            old?.Dispose();
            this.Find('PageHost').Content = page;
            this.Page = page;
            this.Model.Status = `Compiled ${compiled.JavaScript.length.toLocaleString()} bytes of JavaScript · preview updated`;
        }
        catch (error) {
            this.Model.Status = `XAML error: ${error.message}`;
            this._notifications.Show(new A.Notification('XAML compilation error', error.message, 'Error', 8000));
        }
    }
    ToggleTheme() {
        this.SetTheme(A.Application.Current.ActualThemeVariant.Key === 'Dark' ? 'Light' : 'Dark');
    }
    SetTheme(theme) {
        A.Application.Current.RequestedThemeVariant = theme;
        resource(this.Root, 'Foreground', 'Text');
        for (const win of A.Window.Windows) {
            win.RequestedThemeVariant = theme;
            resource(win, 'Foreground', 'Text');
        }
        this.Model.Status = `Theme changed to ${theme} · dynamic resources updated`;
    }
    LightTheme() {
        this.SetTheme('Light');
    }
    DarkTheme() {
        this.SetTheme('Dark');
    }
    NewWindow() {
        try {
            const w = new A.Window();
            w.Title = 'AvaloniaWeb — browser window';
            w.Width = 720;
            w.Height = 520;
            const panel = stack([text('A real browser window.', 30), text('Independent TopLevel, input route, layout manager and Skia surface.', 15), button('Close this window', () => w.Close())], 20);
            panel.Margin = new A.Thickness(32);
            w.Content = panel;
            w.RequestedThemeVariant = A.Application.Current.ActualThemeVariant;
            resource(w, 'Foreground', 'Text');
            w.Show(this.Root, { Backend: this.Root.Renderer.Backend });
            w.WhenOpened.catch(e => this.Model.Status = e.message);
            this.LastWindow = w;
        }
        catch (error) {
            this.Model.Status = error.message;
        }
    }
    async OpenDialog() {
        const d = new A.Window();
        d.Title = 'Dialog result';
        d.Width = 480;
        d.Height = 260;
        const content = stack([text('Continue with this action?', 24), text('The owner is disabled while this browser window is open.'), row([button('Cancel', () => d.Close(false)), button('Continue', () => d.Close(true), {})])]);
        content.Margin = new A.Thickness(28);
        d.Content = content;
        this.LastDialog = d;
        try {
            const result = await d.ShowDialog(this.Root, { Backend: this.Root.Renderer.Backend });
            this.PageFind('DialogResult').Text = `Dialog returned: ${result}`;
        }
        catch (error) {
            this.PageFind('DialogResult').Text = error.message;
        }
    }
    async OpenFile() {
        try {
            const files = await this.Root.StorageProvider.OpenFilePickerAsync({ Title: 'Open a file', AllowMultiple: false });
            this.PageFind('DialogResult').Text = files.length ? `Selected: ${files[0].Name}` : 'File selection canceled.';
        }
        catch (error) {
            this.PageFind('DialogResult').Text = error.message;
        }
    }
    async Copy() {
        try {
            await this.Root.Clipboard.SetTextAsync(this.PageFind('ClipboardText').Text);
            this.PageFind('ClipboardStatus').Text = 'Copied.';
        }
        catch (e) {
            this.PageFind('ClipboardStatus').Text = e.message;
        }
    }
    async Paste() {
        try {
            this.PageFind('ClipboardText').Text = await this.Root.Clipboard.GetTextAsync();
        }
        catch (e) {
            this.PageFind('ClipboardStatus').Text = e.message;
        }
    }
    Previous() {
        this.PageFind('Carousel').Previous();
    }
    Next() {
        this.PageFind('Carousel').Next();
    }
    JumpToEnd() {
        this.PageFind('VirtualList').SelectedIndex = 9999;
        this.PageFind('VirtualList').ScrollIntoView(9999);
    }
    TogglePane() {
        this.PageFind('Split').IsPaneOpen = !this.PageFind('Split').IsPaneOpen;
    }
    PushPage() {
        this.PageFind('Navigator').PushAsync(this.MakePage(this.PageFind('Navigator').NavigationStack.length + 1));
    }
    PopPage() {
        this.PageFind('Navigator').PopAsync();
    }
    ChangeContent() {
        this.PageFind('TransitionHost').Content = this.MakePage(++this._pageCounter + 1);
    }
    FocusFirst() {
        this.PageFind('FocusOne').Focus();
    }
    Notify() {
        this._notifications.Show(new A.Notification('Changes saved', 'Rendered as retained controls inside the browser TopLevel.', 'Success'));
    }
    Refresh() {
        const refresh = this.PageFind('Refresh');
        const subscription = refresh.RefreshRequested.Add((_, e) => {
            const d = e.GetDeferral();
            queueMicrotask(() => {
                this.PageFind('RefreshText').Text = `Updated ${new Date().toLocaleTimeString()}`;
                d.Complete();
                subscription.Dispose();
            });
        });
        refresh.RequestRefresh();
    }
    OpenFlyout() {
        const target = this.PageFind('FlyoutTarget');
        let f;
        if (this.CurrentId === 'ContextMenu') {
            f = new A.ContextMenu();
            f.Items.AddRange(['Cut', 'Copy', 'Paste'].map(x => new A.MenuItem(x)));
        }
        else {
            f = new A.Flyout(stack([text('A retained flyout', 19), text('No HTML popup widget is used.'), button('Dismiss', () => f.Hide())]));
        }
        this._pageLifetime.Add(f);
        f.ShowAt(target);
    }
    async Fullscreen() {
        try {
            await this.Root.SetFullScreenAsync(true);
        }
        catch (error) {
            this.Model.Status = error.message;
        }
    }
    _OnDrop(e) {
        if (this.CurrentId !== 'DragDrop')
            return;
        const data = e.Data ?? e.DataTransfer ?? e.OriginalEvent?.dataTransfer;
        this.PageFind('DropText').Text = data?.files?.length ? [...data.files].map(f => f.name).join('\n') : data?.getData?.('text/plain') || 'Drop received.';
    }
    _UpdateStatus(reset = true) {
        if (!this.Root)
            return;
        const diagnostics = GetRuntimeDiagnostics(this.Root);
        this.Model.RendererStatus = `SKIA ${String(this.Root.Renderer.Backend ?? 'canvas').toUpperCase()}  ·  ${diagnostics.VisualCount} visuals  ·  ${this.Root.RenderScaling}×`;
        if (reset)
            this.Model.Status = 'Ready · Native SkiaSharpWeb + ReactiveWeb/RxJS · Alpha compatibility';
    }
}
export class CatalogApplication extends A.Application {
    Initialize() {
        new A.FluentTheme().Install(this);
        this.Name = 'AvaloniaWeb ControlCatalog';
        this.RequestedThemeVariant = 'Light';
    }
}

export async function CreateWorkerApplication(context) {
    A.ReactiveUI.UseReactiveUI();
    const app=new CatalogApplication();app.Initialize();
    const controller=new CatalogController(),root=context.CreateTopLevel();
    root.Content=controller.CreateView();resource(root,'Foreground','Text');
    app.ApplicationLifetime=new A.BrowserApplicationLifetime();app.ApplicationLifetime.MainWindow=root;app.ApplicationLifetime.MainView=root.Content;
    const find=name=>root.FindControl(name);
    const describe=c=>{if(!c)return null;const rect=new A.Rect(c.Bounds.Size).TransformToAABB(c.TransformToVisual(root)??A.Matrix.Identity);return{Name:c.Name,Type:c.constructor.name,Id:c.VisualId,Bounds:rect?{X:rect.X,Y:rect.Y,Width:rect.Width,Height:rect.Height}:null,...(c.PasswordChar?{}:{Text:c.Text}),Value:c.Value,Offset:(c.Offset??c.ScrollOffset)?{X:(c.Offset??c.ScrollOffset).X,Y:(c.Offset??c.ScrollOffset).Y}:null,CaretIndex:c.CaretIndex,SelectionStart:c.SelectionStart,SelectionEnd:c.SelectionEnd,SelectedIndex:c.SelectedIndex,IsChecked:c.IsChecked,IsEnabled:c.IsEffectivelyEnabled};};
    return {Root:root,Start:async()=>{await controller.Start(root);if(context.Options.Route)await controller.Navigate(context.Options.Route);},
        Commands:{
            Navigate:async id=>{if(id==='Home')await controller.Home();else await controller.Navigate(id);await root.RenderNow();return{Route:controller.CurrentId,Errors:controller.Errors};},
            GetControl:name=>describe(find(name)),
            GetState:()=>({Route:controller.CurrentId,Errors:controller.Errors,Focused:describe(root.FocusManager.FocusedElement),Text:root.FocusManager.FocusedElement?.PasswordChar?undefined:controller.PageModel?.Name,Counter:controller.PageModel?.Counter,Theme:app.ActualThemeVariant.Key}),
            SetControl:async v=>{const c=find(v.Name);if(!c)throw new Error('Unknown control.');if(!['Value','Text','SelectedIndex','IsChecked','IsEnabled','CaretIndex','SelectionStart','SelectionEnd','PasswordChar'].includes(v.Property))throw new Error('Unsupported development command.');c[v.Property]=v.Value;await root.RenderNow();return describe(c);},
            Scroll:async v=>{const c=find(v.Name);if(!c||!('Offset'in c)&&!('ScrollOffset'in c))throw new Error('Not a scrollable control.');if('Offset'in c)c.Offset=new A.Vector(v.X??0,v.Y??0);else c._SetTextScroll(new A.Point(v.X??0,v.Y??0));await root.RenderNow();return describe(c);},
            ScrollGeometry:name=>{const c=find(name);if(!c?._chrome)throw new Error('No scrollbar chrome.');const bar=b=>{const g=b.GetTrackGeometry(),r=b.GetThumbBounds(),m=b.GetTransformToRoot(),p=m.Transform(new A.Point(r.X+r.Width/2,r.Y+r.Height/2));return{X:p.X,Y:p.Y,Travel:g.Travel,Length:g.Length,Value:b.Value,Maximum:b.Maximum,Visible:b.IsVisible};};return{Horizontal:bar(c._chrome.Horizontal),Vertical:bar(c._chrome.Vertical),Scroll:describe(c)};},
            InvokeControl:async name=>{const c=find(name);if(!c?.OnClick)throw new Error('Not an invokable control.');c.OnClick();await root.RenderNow();return true;},
            MountCustomWorkerVisual:async()=>{
                const holder=new A.Border();holder.Height=180;holder.Width=360;
                controller._ReplacePage(holder);const handler=new A.CompositionCustomVisualHandler();
                handler.WorkerModule=root.HostSnapshot.CustomHandlerModule;handler.WorkerState={Color:'#d1495b'};
                const visual=root.Compositor.CreateCustomVisual(handler);visual.Size={X:360,Y:180};A.ElementComposition.SetElementChildVisual(holder,visual);
                controller.CustomWorkerVisual=visual;visual.SendHandlerMessage({Start:true});await root.RenderNow();return true;
            },
            SendCustomWorkerMessages:async value=>{const visual=controller.CustomWorkerVisual;if(!visual)throw new Error('Custom visual missing.');for(let i=0;i<(value.Count??1);i++)visual.SendHandlerMessage(value.Message??{Ping:true});await root.Compositor.RequestCommitAsync();await root.RenderNow();return{Pending:visual._workerMessages.length};},
            ClearCustomWorkerVisual:async()=>{controller.CustomWorkerVisual?.Dispose();controller.CustomWorkerVisual=null;await controller.Navigate('TableView');await root.RenderNow();return true;},
            RegisterTestFont:async url=>{const response=await fetch(url);if(!response.ok)throw new Error('Font request failed.');const bytes=new Uint8Array(await response.arrayBuffer());root.Platform.RegisterTypeface('ThreadConformance',bytes);return true;},
            SetNativeTextFace:async()=>{await controller.Navigate('TextBlock');const blocks=root.FindControl('PageHost').GetVisualDescendants().filter(c=>c instanceof A.TextBlock);for(const c of blocks)c.FontFamily='ThreadConformance';await root.RenderNow();return{TextBlocks:blocks.length};},
            GetThreadMetrics:()=>({UI:root.LastUiFrame,Recorder:root.Renderer.Recorder?.Statistics,Transport:root.Renderer.Statistics,Error:root.LastRenderError?.message}),
            BenchmarkFrames:async ({Kind='vertical',Frames=30}={})=>{
                const table=find('Table');if(!table)throw new Error('Navigate to TableView first.');const results=[];
                for(let i=0;i<Math.min(200,Frames);i++){const start=performance.now();if(Kind==='vertical')table._SetOffset((i*3%Math.max(4,table.ItemCount-20))*table.ItemHeight);else if(Kind==='horizontal')table._SetHorizontalOffset(i%2?120:0);await root.RenderNow();results.push({...root.LastUiFrame,SubmittedLatencyMilliseconds:performance.now()-start});}
                return{Samples:results,Rows:table.RealizedRowCount,Recorder:root.Renderer.Recorder?.Statistics,Transport:root.Renderer.Statistics,Error:root.LastRenderError?.stack??null};
            },

            SetThreadVisible:async value=>{root.Renderer.SetVisible(!!value);await root.RenderNow();return true;},
            BurstTextUpdates:async count=>{const c=find('NameEditor');if(!c)throw new Error('Navigate to TextBox first.');for(let i=0;i<Math.min(1000,count);i++){c.Text='Burst '+i;root.Renderer.Render();}await root.RenderNow();return {Text:c.Text,...root.Renderer.Statistics};},
            GetPlatform:()=>({ReducedMotion:root.PlatformSettings.ReducedMotion,Theme:root.PlatformSettings.GetColorValues().ThemeVariant.Key,Width:root.ClientSize.Width,Height:root.ClientSize.Height,Scale:root.RenderScaling}),
            NewModal:()=>{const child=new A.Window();child.Title='Threaded modal result';child.Width=430;child.Height=220;child.Content=new A.Border(new A.TextBlock('Close this window to return its result.'));controller.LastWindow=child;controller.ModalCompleted=false;controller.ModalResult=null;controller.ModalTask=child.ShowDialog(root,{Backend:'canvas'}).then(result=>{controller.ModalCompleted=true;controller.ModalResult=result;}).catch(error=>{controller.Model.Status=error.message;});return true;},
            GetModalState:()=>({Completed:controller.ModalCompleted,Result:controller.ModalResult,OwnerEnabled:root.IsEffectivelyEnabled}),
            CloseModal:value=>{controller.LastWindow?.Close(value);return true;},
            NewWindow:()=>{controller.NewWindow();return true;},
            GetWindowState:()=>({Exists:!!controller.LastWindow,Opened:controller.LastWindow?.IsAttachedToVisualTree??false,Error:controller.LastWindow?.LastRenderError?.message??null,OwnerEnabled:root.IsEffectivelyEnabled,Status:controller.Model.Status,Renderer:!!controller.LastWindow?.Renderer}),
            CloseWindow:()=>{controller.LastWindow?.Close();return true;},
            Focus:name=>{const c=find(name);c?.Focus();return !!c;},
            SetTheme:async theme=>{controller.SetTheme(theme);await root.RenderNow();return app.ActualThemeVariant.Key;},
            StartAnimation:async()=>{await controller.Navigate('Composition');find('AnimateComposition').OnClick();await root.RenderNow();return true;},
            StopAnimation:async()=>{find('StopComposition')?.OnClick();await root.RenderNow();return true;},
            Stall:milliseconds=>{const duration=Math.max(0,Math.min(2000,Number(milliseconds)||0)),start=performance.now();while(performance.now()-start<duration){}return{Milliseconds:performance.now()-start};},
            Invalidate:async()=>{root.InvalidateVisual();await root.RenderNow();return true;}
        },Dispose:()=>{controller._pageLifetime.Dispose();controller._notifications.Dispose();root.Dispose();}
    };
}
