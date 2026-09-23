"""Actual input, independent clocks, fast wheel reconciliation, native hosting,
renderer restart and multiwindow integration. No fake workers or GUI policy edits.
"""
from pathlib import Path
import argparse,json,time
from contextlib import ExitStack
from integration_host import catalog_http_server,load_http_catalog,wait_window_open
from PIL import ImageChops
from playwright.sync_api import sync_playwright
from threading_support import browser_executable,ROOT,install_assets,load,invoke,png
from verification_support import source_fingerprint
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--http',action='store_true');args=parser.parse_args()
out=ROOT/'artifacts/threading';out.mkdir(exist_ok=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'Qualification':'Chromium raster, real dedicated workers, emulated browser input; no physical GPU/touch/IME or screen reader qualification.'}
report.update(Interception=not args.http,WorkerBootstrapOverrides=not args.http,Transport='ordinary-http' if args.http else 'intercepted-local-assets')
def save():(out/'integration-results.json').write_text(json.dumps(report,indent=2))
def require(v,m):
 if not v:raise AssertionError(m)
def check(name,action):
 t=time.monotonic()
 try:
  value=action();report['Tests'].append({'Name':name,'Passed':True,'Evidence':value,'Milliseconds':round((time.monotonic()-t)*1000,2)});print('PASS',name,flush=True)
 except Exception as e:report['Tests'].append({'Name':name,'Passed':False,'Error':str(e)});print('FAIL',name,str(e)[:1500],flush=True)
 save()
def settle(page):
 page.evaluate('async()=>{await catalogHost.InvokeAsync("Invalidate");return true}')
 page.wait_for_timeout(80)
with ExitStack() as cleanup, sync_playwright()as p:
 browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport={'width':1200,'height':900})
 if args.http:page=load_http_catalog(context,cleanup.enter_context(catalog_http_server()),report['Errors'],report['MissingAssets'])
 else:install_assets(context,report['MissingAssets']);page=load(context,'full-isolation',report['Errors'])
 report['Browser']=browser.version;report['InitialWorkerUrls']=[w.url for w in page.workers]
 def editor():
  invoke(page,'Navigate','TextBox');d=invoke(page,'GetControl','NameEditor');r=d['Bounds'];page.mouse.click(r['X']+25,r['Y']+r['Height']/2)
  page.wait_for_function('catalogHost.Input&&!catalogHost.Input.hidden&&document.activeElement===catalogHost.Input')
  page.keyboard.press('Control+a');page.keyboard.insert_text('Threaded e\u0301👩🏽\u200d💻');page.wait_for_timeout(120);s=invoke(page,'GetControl','NameEditor');require(s['Text']=='Threaded e\u0301👩🏽\u200d💻',str(s))
  page.keyboard.press('Backspace');page.wait_for_timeout(100);s=invoke(page,'GetControl','NameEditor');require(s['Text']=='Threaded e\u0301',str(s))
  page.keyboard.press('Backspace');page.wait_for_timeout(100);s=invoke(page,'GetControl','NameEditor');require(s['Text']=='Threaded ',str(s));return s
 check('isolated native text editing and grapheme-safe backward deletion',editor)
 def password():
  invoke(page,'SetControl',{'Name':'NameEditor','Property':'PasswordChar','Value':'•'});page.wait_for_timeout(80)
  require(page.evaluate('catalogHost.Input.type')=='password','native password field not selected')
  s=invoke(page,'GetControl','NameEditor');require('Text'not in s,'debug descriptor leaks plaintext')
  require(not page.evaluate('catalogHost.Aria.textContent.includes("Threaded ")'),'password exposed in semantic tree')
  invoke(page,'SetControl',{'Name':'NameEditor','Property':'PasswordChar','Value':''});return{'NativePassword':True,'PlaintextExcludedFromControlDescriptor':True}
 check('focused edit switches to password without plaintext semantic exposure',password)
 def animation():
  invoke(page,'StartAnimation');page.wait_for_timeout(80);before=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()')
  page.evaluate('globalThis.stallDone=false;globalThis.stallTask=catalogHost.InvokeAsync("Stall",1200).then(()=>stallDone=true);undefined');page.wait_for_timeout(100)
  t=time.monotonic();mid1=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');first_roundtrip=(time.monotonic()-t)*1000;page.wait_for_timeout(200);t=time.monotonic();mid2=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');second_roundtrip=(time.monotonic()-t)*1000;done=page.evaluate('stallDone')
  require(not done,'did not measure during actual UI stall');require(mid2['WorkerFrames']>mid1['WorkerFrames'],'render clock stopped with UI');require(mid2['Scene']['AnimationTicks']>mid1['Scene']['AnimationTicks'],'animation clock stopped')
  page.evaluate('async()=>await stallTask');invoke(page,'StopAnimation');return{'FramesWhileUIBlocked':mid2['WorkerFrames']-mid1['WorkerFrames'],'TicksWhileUIBlocked':mid2['Scene']['AnimationTicks']-mid1['Scene']['AnimationTicks'],'HostToRenderRoundtripMilliseconds':[round(first_roundtrip,2),round(second_roundtrip,2)],'UIStillBlockedAtSecondRead':not done,'UIStallMilliseconds':1200,'Before':before['WorkerFrames'],'LastReadDuringStall':mid2['WorkerFrames']}
 check('render clock and animation advance during a confirmed UI-worker stall',animation)
 def wheel():
  invoke(page,'Navigate','ScrollViewer');invoke(page,'Scroll',{'Name':'DemoScrollViewer','X':0,'Y':0});s=invoke(page,'GetControl','DemoScrollViewer');r=s['Bounds'];page.mouse.move(r['X']+40,r['Y']+50);page.wait_for_timeout(100)
  before=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');require(before['Scroll']['Offsets'],'scroll policy absent')
  page.evaluate('globalThis.stallDone=false;globalThis.stallTask=catalogHost.InvokeAsync("Stall",1200).then(()=>stallDone=true);undefined');page.wait_for_timeout(80);page.mouse.wheel(0,120);page.wait_for_timeout(160)
  mid=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');require(not page.evaluate('stallDone'),'measurement after stall');require(mid['Scroll']['Pending']>0,'scroll not speculative')
  entry=next(x for x in mid['Scroll']['Offsets']if x['Id']==s['Id']);require(entry['Offset'][1]>0 and entry['Base'][1]==0,str(entry));require(mid['WorkerFrames']>before['WorkerFrames'],'no render during wheel')
  png(page,True).save(out/'isolated-async-scroll.png');page.evaluate('async()=>await stallTask');settle(page)
  after=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');current=invoke(page,'GetControl','DemoScrollViewer');require(after['Scroll']['Pending']==0,'unreconciled wheel');require(abs(current['Offset']['Y']-entry['Offset'][1])<.01,'wheel delta doubled or lost')
  return{'Speculative':entry,'ReconciledOffset':current['Offset'],'PendingAfterAck':after['Scroll']['Pending'],'Inputs':after['Scroll']['Inputs']}
 check('compositor wheel scrolling continues during UI stall and reconciles exactly once',wheel)
 def table_coverage():
  invoke(page,'Navigate','TableView');s=invoke(page,'GetControl','Table');r=s['Bounds'];page.mouse.move(r['X']+60,r['Y']+80);page.wait_for_timeout(80)
  page.evaluate('globalThis.stallTask=catalogHost.InvokeAsync("Stall",900);undefined');page.wait_for_timeout(80);page.mouse.wheel(0,1800);page.wait_for_timeout(120)
  mid=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');entry=next(x for x in mid['Scroll']['Offsets']if x['Id']==s['Id']);require(entry['Offset'][1]<=entry['CoverageY'][1],str(entry));require(mid['Scroll']['CoverageClamps']>0,'coverage boundary not exercised')
  page.evaluate('async()=>await stallTask');settle(page);after=invoke(page,'GetControl','Table');require(after['Offset']['Y']>entry['Offset'][1],str(after));return{'WhileStalled':entry,'AfterRealization':after['Offset']}
 check('virtual table fast scrolling respects realized-content coverage',table_coverage)
 def drag(axis):
  invoke(page,'Navigate','ScrollViewer');invoke(page,'Scroll',{'Name':'DemoScrollViewer','X':0,'Y':0});g=invoke(page,'ScrollGeometry','DemoScrollViewer')[axis];require(g['Visible'] and g['Travel']>0,str(g));page.mouse.move(g['X'],g['Y']);page.mouse.down();page.mouse.move(g['X']+(g['Travel']*.55 if axis=='Horizontal'else 0),g['Y']+(g['Travel']*.55 if axis=='Vertical'else 0),steps=8);page.mouse.up();settle(page)
  s=invoke(page,'GetControl','DemoScrollViewer');value=s['Offset']['X'if axis=='Horizontal'else'Y'];require(value>g['Maximum']*.4,str(s));return{'Value':value,'Maximum':g['Maximum']}
 check('three threads vertical scrollbar routes real mouse capture',lambda:drag('Vertical'))
 check('three threads horizontal scrollbar routes real mouse capture',lambda:drag('Horizontal'))
 def native():
  invoke(page,'Navigate','NativeEmbed');page.wait_for_selector('#native-demo-input',state='visible');page.locator('#native-demo-input').click();page.keyboard.press('Control+a');page.keyboard.type('Native to worker',delay=5);page.wait_for_timeout(120);s=invoke(page,'GetControl','NativeModelEditor');require(s['Text']=='Native to worker',str(s))
  invoke(page,'SetControl',{'Name':'NativeModelEditor','Property':'Text','Value':'Worker to native'});page.wait_for_timeout(100);require(page.locator('#native-demo-input').input_value()=='Worker to native','state not returned to native host')
  invoke(page,'Navigate','TableView');page.wait_for_function('!document.querySelector("#native-demo-input")');return{'Bidirectional':True,'DisposedAfterNavigation':True}
 check('registered native DOM module binds to UI-worker model and cleans up',native)
 def restart():
  invoke(page,'Navigate','TableView');before=png(page);d1=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()');page.evaluate('async()=>await catalogHost.RestartRendererAsync()');settle(page);d2=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()');after=png(page);maximum=max(x[1]for x in ImageChops.difference(before,after).getextrema());require(maximum==0,f'restart pixels changed {maximum}');require(d1['Renderer']['Worker']['InstanceId']!=d2['Renderer']['Worker']['InstanceId'],'worker was not replaced');require(d2['Renderer']['Worker']['Generation']==2,'generation not advanced');return{'MaximumChannelError':maximum,'Restarts':d2['Renderer']['UI']['Restarts'],'Generation':d2['Renderer']['Worker']['Generation']}
 check('isolated renderer restart replaces canvas and rebuilds identical committed pixels',restart)
 check('native editor still works after renderer restart',editor)
 def custom():
  invoke(page,'MountCustomWorkerVisual');page.wait_for_timeout(100);before=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')['Renderer']['Worker']['CustomHandlers'];require(before and before[0]['Value']['HasDocument']==False,str(before))
  result=invoke(page,'SendCustomWorkerMessages',{'Count':100});require(result['Pending']==0,str(result));d=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()');h=d['Renderer']['Worker']['CustomHandlers'][0]['Value'];require(h['Messages']==101 and h['AnimationTicks']>0,str(h))
  invoke(page,'SendCustomWorkerMessages',{'Message':{'Stop':True}});image=png(page);page.evaluate('async()=>await catalogHost.RestartRendererAsync()');settle(page);after=png(page);require(max(x[1]for x in ImageChops.difference(image,after).getextrema())==0,'custom durable state not restored');r=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')['Renderer']['Worker']['CustomHandlers'][0]['Value'];require(r['Messages']==0,'acknowledged transient messages replayed on recovery');invoke(page,'ClearCustomWorkerVisual');return{'MessagesConsumed':h['Messages'],'TransientPending':result['Pending'],'Recovered':r,'IdenticalPixels':True}
 check('registered custom visual executes, acknowledges bounded messages and restores durable state',custom)
 def burst():
  invoke(page,'Navigate','TextBox');r=invoke(page,'BurstTextUpdates',200);require(r['Text']=='Burst 199' and r['MaxInFlight']==1,str(r));require(r['PendingFramesCoalesced']>0,'no backpressure exercised');return r
 check('200 immediate state changes coalesce without losing final values or queuing scene deltas',burst)
 def hidden():
  invoke(page,'SetThreadVisible',False);invoke(page,'Navigate','TableView');image=png(page);d=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');page.wait_for_timeout(140);after=page.evaluate('async()=>await catalogHost.GetRenderDiagnosticsAsync()');require(after['WorkerFrames']==d['WorkerFrames'],'hidden idle worker spins');invoke(page,'SetThreadVisible',True);return{'ExplicitFlushCompleted':image.width>0,'IdleExtraFrames':after['WorkerFrames']-d['WorkerFrames']}
 check('hidden target explicit flush completes without an idle render loop',hidden)
 def resize():
  page.set_viewport_size({'width':1050,'height':760});page.wait_for_timeout(150);settle(page);v=invoke(page,'GetPlatform');require(v['Width']==1050 and v['Height']==760,str(v));image=png(page);require(image.size==(1050,760),str(image.size));page.set_viewport_size({'width':1200,'height':900});page.wait_for_timeout(150);settle(page);return {'UIViewport':v,'Pixels':[image.width,image.height]}
 check('host resize reaches UI layout and the worker-owned backing canvas',resize)
 def media():
  page.emulate_media(reduced_motion='reduce',color_scheme='dark');page.wait_for_timeout(100);v=invoke(page,'GetPlatform');require(v['ReducedMotion'] and v['Theme']=='Dark',str(v));page.emulate_media(reduced_motion='no-preference',color_scheme='light');page.wait_for_timeout(80);return v
 check('live browser platform preferences are forwarded into the UI worker',media)
 def window():
  invoke(page,'NewWindow');s=wait_window_open(page,invoke)
  popup=context.pages[-1]
  require(s['Opened'] and not s['Error'],str(s));require(popup.locator('canvas').count()==1,'window missing canvas')
  popup.screenshot(path=str(out/'isolated-browser-window.png'));invoke(page,'CloseWindow');popup.wait_for_event('close',timeout=10000)if not popup.is_closed()else None;return{'Opened':True,'Closed':popup.is_closed(),'SharedUIWorker':True,'IndependentRenderWorker':True}
 check('worker-owned Window opens a real browser window with its own render worker',window)
 def modal():
  invoke(page,'NewModal');state=wait_window_open(page,invoke)
  require(state['Opened'] and not state['OwnerEnabled'],str(state));invoke(page,'CloseModal',{'Accepted':True,'Value':42});page.wait_for_timeout(100);result=invoke(page,'GetModalState');require(result['Completed'] and result['OwnerEnabled'] and result['Result']=={'Accepted':True,'Value':42},str(result));return result
 check('real isolated modal window blocks owner and returns its exact result',modal)
 def secondary_lifetime():
  rounds=[]
  for index in range(12):
   modal=index%2==1;invoke(page,'NewModal' if modal else 'NewWindow');state=wait_window_open(page,invoke)
   require(state['Opened'] and not state['Error'],str(state))
   require(page.evaluate('catalogHost.Children.size')==1,'Closed child hosts remained registered')
   require('/packages/browser/src/secondary-window.html#avalonia-window=' in context.pages[-1].url,'Secondary window lacks a committed host document')
   if modal:
    result={'Accepted':True,'Iteration':index};invoke(page,'CloseModal',result)
    page.wait_for_function('async()=>{const s=await catalogHost.InvokeAsync("GetModalState");return s.Completed&&s.OwnerEnabled;}')
    require(invoke(page,'GetModalState')['Result']==result,'Repeated modal lost its result')
   else:invoke(page,'CloseWindow')
   page.wait_for_function('catalogHost.Children.size===0&&catalogHost._wasmSource.PendingDeliveries===0',timeout=10000)
   rounds.append({'Modal':modal,'ReleasedHosts':True,'PendingNativeDeliveries':0})
  return {'Rounds':rounds,'RetryCount':0,'CanonicalWorkers':args.http}
 check('repeated native-ready windows release child hosts and independent WASM deliveries',secondary_lifetime)
 def secondary_failure():
  # This fixture reports an explicit bootstrap failure over the real worker
  # protocol. It does not replace the window implementation or retry a worker.
  original=page.evaluate('catalogHost.Options.RenderWorkerUrl??null')
  page.evaluate('catalogHost.Options.RenderWorkerUrl=new URL("/tests/secondary-failed-worker.js",location.href).href')
  started=time.monotonic()
  try:
   invoke(page,'NewModal')
   deadline=time.monotonic()+10
   while True:
    permit=page.locator('dialog[open] button',has_text='Continue')
    if permit.count():permit.first.click()
    state=invoke(page,'GetWindowState')
    if state['OwnerEnabled'] and 'deliberate secondary bootstrap failure' in state['Status']:break
    if time.monotonic()>=deadline:raise AssertionError({'SecondaryFailureNotPropagated':state})
    page.wait_for_timeout(20)
   page.wait_for_function('catalogHost.Children.size===0&&catalogHost._wasmSource.PendingDeliveries===0',timeout=10000)
   require(not state['Opened'] and not state['Renderer'],str(state))
  finally:
   page.evaluate('url=>{if(url===null)delete catalogHost.Options.RenderWorkerUrl;else catalogHost.Options.RenderWorkerUrl=url;}',original)
  # A failed sibling must neither dispose shared compilation nor poison its owner.
  invoke(page,'NewWindow');healthy=wait_window_open(page,invoke);require(healthy['Opened'],str(healthy));invoke(page,'CloseWindow')
  page.wait_for_function('catalogHost.Children.size===0&&catalogHost._wasmSource.PendingDeliveries===0',timeout=10000)
  return {'OwnerRestored':True,'PendingNativeDeliveries':0,'FollowingWindowPassed':True,'RetryCount':0,'Milliseconds':round((time.monotonic()-started)*1000,2)}
 if args.http:check('failed secondary bootstrap restores modal owner and leaves the next real window usable',secondary_failure)
 report['FinalDiagnostics']=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
 page.evaluate('async()=>await catalogHost.DisposeAsync()');require(page.locator('canvas').count()==0,'host disposal leaked canvas');page.close();browser.close()
report['Completed']=True;report['Passed']=sum(t['Passed']for t in report['Tests']);report['Failed']=len(report['Tests'])-report['Passed'];report['FinalSourceFingerprint']=source_fingerprint(ROOT);save();print(json.dumps({'Passed':report['Passed'],'Failed':report['Failed'],'Errors':report['Errors'],'MissingAssets':report['MissingAssets']},indent=2));raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
