import { NotSupportedException, Rect } from '@wieslawsoltes/avalonia-base';

export class BrowserClipboard {
    constructor(window) {
        this.Window = window;
    }
    async GetTextAsync() {
        if (!this.Window.navigator.clipboard?.readText)
            throw new NotSupportedException('Clipboard reading requires browser support, a secure context and permission.');
        return this.Window.navigator.clipboard.readText();
    }
    async SetTextAsync(text) {
        if (!this.Window.navigator.clipboard?.writeText)
            throw new NotSupportedException('Clipboard writing requires browser support and a secure context.');
        await this.Window.navigator.clipboard.writeText(String(text));
    }
    async ClearAsync() {
        await this.SetTextAsync('');
    }
}
export class BrowserStorageFile {
    constructor(file = null, handle = null) {
        this._file = file;
        this._handle = handle;
        this.Name = file?.name ?? handle?.name ?? '';
        this.Path = null;
    }
    async OpenReadAsync() {
        const file = this._file ?? await this._handle.getFile();
        return new Uint8Array(await file.arrayBuffer());
    }
    async OpenWriteAsync() {
        if (!this._handle?.createWritable)
            throw new NotSupportedException('This selected file has no granted write capability.');
        return this._handle.createWritable();
    }
    async GetBasicPropertiesAsync() {
        const file = this._file ?? await this._handle.getFile();
        return { Size: file.size, DateModified: new Date(file.lastModified) };
    }
    async DeleteAsync() {
        if (!this._handle?.remove)
            throw new NotSupportedException('File deletion is not available for this browser handle.');
        await this._handle.remove();
    }
}
export class BrowserStorageProvider {
    constructor(window) {
        this.Window = window;
    }
    get CanOpen() {
        return true;
    }
    get CanSave() {
        return !!this.Window.showSaveFilePicker;
    }
    get CanPickFolder() {
        return !!this.Window.showDirectoryPicker;
    }
    async OpenFilePickerAsync(options = {}) {
        if (this.Window.showOpenFilePicker) {
            try {
                const handles = await this.Window.showOpenFilePicker({ multiple: !!options.AllowMultiple, types: options.FileTypeFilter?.map(type => ({ description: type.Name, accept: { [type.MimeTypes?.[0] ?? 'application/octet-stream']: (type.Patterns ?? []).filter(p => p !== '*.*').map(p => p.replace(/^\*/, '')) } })) });
                return handles.map(h => new BrowserStorageFile(null, h));
            }
            catch (e) {
                if (e.name === 'AbortError')
                    return [];
                throw e;
            }
        }
        return new Promise(resolve => {
            const input = this.Window.document.createElement('input');
            input.type = 'file';
            input.multiple = !!options.AllowMultiple;
            input.accept = (options.FileTypeFilter ?? []).flatMap(t => t.Patterns ?? []).map(p => p.replace(/^\*/, '')).join(',');
            input.style.display = 'none';
            this.Window.document.body.append(input);
            const finish = () => {
                const files = [...(input.files ?? [])].map(f => new BrowserStorageFile(f));
                input.remove();
                resolve(files);
            };
            input.addEventListener('change', finish, { once: true });
            input.addEventListener('cancel', finish, { once: true });
            input.click();
        });
    }
    async SaveFilePickerAsync(options = {}) {
        if (!this.Window.showSaveFilePicker)
            throw new NotSupportedException('Use DownloadAsync when the browser does not expose the File System Access save picker.');
        try {
            return new BrowserStorageFile(null, await this.Window.showSaveFilePicker({ suggestedName: options.SuggestedFileName }));
        }
        catch (e) {
            if (e.name === 'AbortError')
                return null;
            throw e;
        }
    }
    async OpenFolderPickerAsync() {
        if (!this.CanPickFolder)
            throw new NotSupportedException('Folder handles are not supported by this browser.');
        try {
            const handle = await this.Window.showDirectoryPicker();
            return [{ Name: handle.name, Handle: handle, async *GetItemsAsync() {
                        for await (const entry of handle.values())
                            yield entry.kind === 'file' ? new BrowserStorageFile(null, entry) : { Name: entry.name, Handle: entry };
                    } }];
        }
        catch (e) {
            if (e.name === 'AbortError')
                return [];
            throw e;
        }
    }
    DownloadAsync(name, bytes, mimeType = 'application/octet-stream') {
        const url = this.Window.URL.createObjectURL(new Blob([bytes], { type: mimeType })), anchor = this.Window.document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        this.Window.document.body.append(anchor);
        anchor.click();
        anchor.remove();
        this.Window.setTimeout(() => this.Window.URL.revokeObjectURL(url), 30000);
        return Promise.resolve();
    }
}
export class BrowserScreens {
    constructor(window) {
        this.Window = window;
    }
    get Primary() {
        const s = this.Window.screen;
        return { IsPrimary: true, Bounds: new Rect(0, 0, s.width, s.height), WorkingArea: new Rect(s.availLeft ?? 0, s.availTop ?? 0, s.availWidth, s.availHeight), Scaling: this.Window.devicePixelRatio || 1 };
    }
    get All() {
        return this._screens ?? [this.Primary];
    }
    async RequestScreenDetailsAsync() {
        if (!this.Window.getScreenDetails)
            throw new NotSupportedException('Multi-screen enumeration requires the Window Management API and user permission.');
        const details = await this.Window.getScreenDetails();
        this._screens = details.screens.map(s => ({ IsPrimary: s.isPrimary, DisplayName: s.label, Bounds: new Rect(s.left, s.top, s.width, s.height), WorkingArea: new Rect(s.availLeft, s.availTop, s.availWidth, s.availHeight), Scaling: s.devicePixelRatio }));
        return this.All;
    }
}
