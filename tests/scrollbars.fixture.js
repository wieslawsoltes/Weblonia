/** Browser fixture uses the actual catalog's native Skia root and DOM input bridge. */
export async function MountScrollFixture(kind, options = {}) {
    const A = window.catalogApi, root = window.catalog.Root;
    root.FocusManager.Focus(null); root.LastRenderError = null;
    const old = root.Content; root.Content = null; old?.Dispose();
    const canvas = new A.Canvas(), c = new A[kind]();
    c.Name = 'Target'; c.Width = 420; c.Height = 280; c.AllowAutoHide = options.overlay ?? false;
    c.HorizontalScrollBarVisibility = 'Auto'; c.VerticalScrollBarVisibility = 'Auto';
    const fixture = window.scrollFixture = { Kind: kind, Control: c, Root: root, Clicks: 0 };
    if (kind === 'ScrollViewer') {
        const button = new A.Button('Content must never intercept scrollbar input');
        button.Width = 1500; button.Height = 4000;
        button.Background = '#E7EDF5'; button.Click.Add(() => fixture.Clicks++); c.Content = button;
    } else if (kind === 'ListBox') c.ItemsSource = Array.from({ length: 10000 }, (_, i) => `Item ${i} — long label ${'readable text '.repeat(12)}`);
    else if (kind === 'TreeView') c.ItemsSource = Array.from({ length: 1000 }, (_, i) => ({ Header: `Node ${i}`, Children: [{Header:`Child ${i}`}]}));
    else if (kind === 'TableView') {
        c.AutoGenerateColumns = false;
        c.Columns.Add(new A.TableViewColumn('Identifier', 'Id', 200));
        c.Columns.Add(new A.TableViewColumn('Description', 'Name', 700));
        c.Columns.Add(new A.TableViewColumn('Status', 'Status', 200));
        c.ItemsSource = Array.from({length:10000},(_,i)=>({Id:i,Name:`Dataset record ${i}`,Status:'Active'}));
    } else if (kind === 'TextBox') {
        c.AcceptsReturn = true; c.TextWrapping = 'NoWrap';
        c.Text = Array.from({length:300},(_,i)=>`${i}: office affinity — ${'long editable text '.repeat(10)}`).join('\n');
        c.CaretIndex = 4; c.SelectionStart = 1; c.SelectionEnd = 4;
        fixture.OriginalText = c.Text;
    }
    const heading = new A.TextBlock(`${kind} · real scrollbar interaction`); heading.FontSize=24; heading.FontWeight=600;
    A.Canvas.SetLeft(heading,48);A.Canvas.SetTop(heading,20);canvas.Children.Add(heading);
    A.Canvas.SetLeft(c,48);A.Canvas.SetTop(c,80);canvas.Children.Add(c);
    const help=new A.TextBlock('Native Skia rendering • two-axis dragging • page tracks • viewport clipping');help.FontSize=14;
    A.Canvas.SetLeft(help,48);A.Canvas.SetTop(help,390);canvas.Children.Add(help);
    root.Content = canvas; await root.RenderNow();
    return true;
}
export function ScrollGeometry(orientation='Vertical') {
    const A=window.catalogApi,f=window.scrollFixture,c=f.Control,b=c[orientation+'ScrollBar'],r=b.GetThumbBounds(),m=b.GetTransformToRoot();
    const point=m.Transform(new A.Point(r.X+r.Width/2,r.Y+r.Height/2));
    const track=m.Transform(new A.Point(b.Bounds.Width/2,b.Bounds.Height/2));
    return { x:point.X,y:point.Y,trackX:track.X,trackY:track.Y,length:b.GetTrackGeometry().Length,travel:b.GetTrackGeometry().Travel,
        maximum:b.Maximum,value:b.Value,visible:b.IsVisible,width:b.Bounds.Width,height:b.Bounds.Height,id:b.VisualId };
}
export function ScrollState() {
    const f=window.scrollFixture,c=f.Control,offset=c.Offset ?? c.ScrollOffset;
    return { x:offset.X,y:offset.Y,clicks:f.Clicks,selected:c.SelectedIndex??null,dragging:c.VerticalScrollBar.IsDragging||c.HorizontalScrollBar.IsDragging,
        selectedStart:c.SelectionStart,selectedEnd:c.SelectionEnd,caret:c.CaretIndex,textUnchanged:c.Text===f.OriginalText,
        realized:c.GetRealizedContainers?.().map(x=>x.ItemIndex),headerX:c.HeadersPresenter?.Children.Get(0)?.Bounds.X,
        error:f.Root.LastRenderError?.stack ?? null };
}
