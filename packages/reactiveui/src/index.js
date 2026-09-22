import { ReactiveObject, ReactiveCommand, RxApp, ViewModelActivator, WhenActivated } from '@wieslawsoltes/reactiveweb';
import { Subscription } from 'rxjs';
import { DefineProperties, Disposable, Dispatcher } from '@wieslawsoltes/avalonia-base';
import { UserControl, ContentControl } from '@wieslawsoltes/avalonia-controls';
import { Window } from '@wieslawsoltes/avalonia-browser';
export { ReactiveObject, ReactiveCommand, RxApp, ViewModelActivator, WhenActivated };
export { WhenAnyValue, ObservableAsPropertyHelper, ToProperty, Interaction, RoutingState, ReactiveProperty } from '@wieslawsoltes/reactiveweb';
export class AvaloniaScheduler {
    static Instance = new AvaloniaScheduler();
    now() {
        return Date.now();
    }
    schedule(work, delay = 0, state) {
        const subscription = new Subscription();
        const scheduler = this;
        const action = { closed: false, schedule(next, nextDelay = 0) {
                subscription.add(scheduler.schedule(work, nextDelay, next));
                return this;
            }, unsubscribe() {
                this.closed = true;
                subscription.unsubscribe();
            } };
        const invoke = () => {
            if (!subscription.closed)
                work.call(action, state);
        };
        if (delay > 0) {
            const id = setTimeout(() => Dispatcher.UIThread.Post(invoke), delay);
            subscription.add(() => clearTimeout(id));
        }
        else
            Dispatcher.UIThread.Post(invoke);
        return subscription;
    }
}
export function UseReactiveUI() {
    RxApp.MainThreadScheduler = AvaloniaScheduler.Instance;
}
function initializeActivation(view) {
    view.Activator = new ViewModelActivator();
    view._lifetime.Add(view.Activator);
    const activate = () => {
        view._viewActivation?.Dispose();
        view._vmActivation?.Dispose();
        view._viewActivation = view.Activator.Activate();
        view._vmActivation = view.ViewModel?.Activator?.Activate?.();
    };
    const deactivate = () => {
        view._viewActivation?.Dispose();
        view._vmActivation?.Dispose();
        view._viewActivation = view._vmActivation = null;
    };
    view._lifetime.Add(view.AttachedToVisualTree.Add(activate));
    view._lifetime.Add(view.DetachedFromVisualTree.Add(deactivate));
    view._lifetime.Add(new Disposable(deactivate));
}
export class ReactiveUserControl extends UserControl {
    constructor() {
        super();
        initializeActivation(this);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'ViewModel') {
            this.DataContext = e.NewValue;
            this._vmActivation?.Dispose();
            this._vmActivation = this.IsAttachedToVisualTree ? e.NewValue?.Activator?.Activate?.() : null;
        }
    }
    WhenActivated(block) {
        return WhenActivated(this, block);
    }
}
DefineProperties(ReactiveUserControl, { ViewModel: [null] });
export class ReactiveWindow extends Window {
    constructor() {
        super();
        initializeActivation(this);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'ViewModel')
            this.DataContext = e.NewValue;
    }
    WhenActivated(block) {
        return WhenActivated(this, block);
    }
}
DefineProperties(ReactiveWindow, { ViewModel: [null] });
export class ViewLocator {
    constructor() {
        this._factories = new Map();
    }
    Register(viewModelType, factory, contract = '') {
        if (typeof factory !== 'function')
            throw new TypeError('View factory must be callable.');
        let contracts = this._factories.get(viewModelType);
        if (!contracts)
            this._factories.set(viewModelType, contracts = new Map());
        contracts.set(contract, factory);
        return new Disposable(() => contracts.delete(contract));
    }
    ResolveView(viewModel, contract = '') {
        for (let type = viewModel?.constructor; type; type = Object.getPrototypeOf(type)) {
            const factory = this._factories.get(type)?.get(contract);
            if (factory) {
                const view = factory(viewModel);
                if ('ViewModel' in view)
                    view.ViewModel = viewModel;
                else
                    view.DataContext = viewModel;
                return view;
            }
        }
        throw new Error(`No view is registered for ${viewModel?.constructor?.name ?? 'null'} (${contract}).`);
    }
    static Current = new ViewLocator();
}
export class ViewModelViewHost extends ContentControl {
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (['ViewModel', 'ViewContract'].includes(e.Property.Name)) {
            const old = this.Content;
            this.Content = this.ViewModel == null ? null : (this.ViewLocator ?? ViewLocator.Current).ResolveView(this.ViewModel, this.ViewContract);
            old?.Dispose?.();
        }
    }
}
DefineProperties(ViewModelViewHost, { ViewModel: [null], ViewContract: [''], ViewLocator: [null] });
