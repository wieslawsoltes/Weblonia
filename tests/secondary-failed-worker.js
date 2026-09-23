// Test-only native-bootstrap failure. The browser still loads this actual HTTP
// module Worker. No host implementation, control RPC or window is replaced.
self.onmessage = event => {
    if (event.data?.Type !== 'initialize') return;
    self.postMessage({Type:'bootstrap-error', Role:'render', Error:'deliberate secondary bootstrap failure'});
    self.close();
};
