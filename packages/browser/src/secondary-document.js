/** Dependency-free host readiness: never initializes framework or native Skia. */
function announce() {
    const token = new URLSearchParams(location.hash.slice(1)).get('avalonia-window');
    if (token && opener) opener.postMessage({Type:'avalonia-secondary-document-ready',Token:token}, location.origin);
}
if (document.readyState === 'complete') announce();
else addEventListener('load', announce, {once:true});
