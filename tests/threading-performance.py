"""Separate UI CPU work from submission latency and renderer CPU cost. These
software Chromium results measure this machine, not physical GPU FPS. The native
renderer is identical in all modes; no quality/resolution reduction is applied.
"""
import json,time,statistics
from playwright.sync_api import sync_playwright
from threading_support import browser_executable,ROOT,install_assets,load,invoke
from verification_support import source_fingerprint
out=ROOT/'artifacts/threading';out.mkdir(exist_ok=True)
r={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Modes':{},'Errors':[],'MissingAssets':[],'FramesPerTrial':30,'Trials':2,'Scale':2,'Viewport':[562,820],'Qualification':'Same native Skia raster, quality and source; this environment only. UI CPU time excludes awaited rendering. Submission latency is not physical presentation. No physical GPU FPS claim.'}
def save():(out/'performance-results.json').write_text(json.dumps(r,indent=2))
def summary(values):
 values=sorted(values);return{'Median':round(statistics.median(values),3),'P95':round(values[round((len(values)-1)*.95)],3),'Min':round(values[0],3),'Max':round(values[-1],3)}
with sync_playwright()as p:
 b=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);r['Browser']=b.version
 for mode in ['single','render-worker','full-isolation']:
  ctx=b.new_context(viewport={'width':562,'height':820},device_scale_factor=2);install_assets(ctx,r['MissingAssets']);page=load(ctx,mode,r['Errors'])
  if mode=='full-isolation':invoke(page,'Navigate','TableView')
  else:page.evaluate('async()=>{await catalog.Navigate("TableView");await catalog.Root.RenderNow();}')
  def run(kind,n):
   if mode=='full-isolation':return invoke(page,'BenchmarkFrames',{'Kind':kind,'Frames':n})
   return page.evaluate('''async({Kind,Frames})=>{const root=catalog.Root,table=root.FindControl('Table'),results=[];for(let i=0;i<Frames;i++){const start=performance.now();if(Kind==='vertical')table._SetOffset((i*3%Math.max(4,table.ItemCount-20))*table.ItemHeight);else if(Kind==='horizontal')table._SetHorizontalOffset(i%2?120:0);await root.RenderNow();results.push({...root.LastUiFrame,SubmittedLatencyMilliseconds:performance.now()-start});}return{Samples:results,Rows:table.RealizedRowCount,Recorder:root.Renderer.Recorder?.Statistics,Transport:root.Renderer.Statistics,Error:root.LastRenderError?.stack??null};}''',{'Kind':kind,'Frames':n})
  run('vertical',12);state={'Workloads':{}};r['Modes'][mode]=state
  for kind in ['repaint','vertical','horizontal']:
   samples=[]
   for i in range(2):
    value=run(kind,30)
    if value['Error']:raise RuntimeError(value['Error'])
    samples+=value['Samples']
   state['Workloads'][kind]={'Samples':samples,'Summary':{k:summary([x[k]for x in samples])for k in ['Milliseconds','LayoutMilliseconds','RenderOrRecordMilliseconds','AutomationMilliseconds','SubmittedLatencyMilliseconds']},'Rows':value['Rows']}
   print(mode,kind,json.dumps(state['Workloads'][kind]['Summary']),flush=True);save()
  if mode=='full-isolation':state['Diagnostics']=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
  elif mode=='render-worker':state['Diagnostics']=page.evaluate('async()=>await catalog.Root.Renderer.GetDiagnosticsAsync()')
  else:state['Diagnostics']=page.evaluate('({Skia:catalog.Root.Platform.GetDiagnostics(),Frames:catalog.Root.Platform.FrameCount})')
  if mode!='single':
   d=state['Diagnostics']['Renderer']if mode=='full-isolation'else state['Diagnostics'];before=d['UI'];after=run('repaint',100)
   def numbers():
    if mode=='full-isolation':return page.evaluate('async()=>(await catalogHost.GetDiagnosticsAsync()).Renderer')
    return page.evaluate('async()=>await catalog.Root.Renderer.GetDiagnosticsAsync()')
   d2=numbers();state['Warm100Repaints']={'NewContentRecords':d2['UI']['Recorder']['ContentRecords']-before['Recorder']['ContentRecords'],'NewTransactions':d2['UI']['SentTransactions']-before['SentTransactions'],'MaxInFlight':d2['UI']['MaxInFlight'],'PoolBytes':d2['UI']['BufferPool']['Bytes']}
   assert state['Warm100Repaints']['NewContentRecords']==0 and state['Warm100Repaints']['NewTransactions']==0,state['Warm100Repaints']
   assert state['Warm100Repaints']['MaxInFlight']==1 and state['Warm100Repaints']['PoolBytes']<=16*1024*1024
  page.close();ctx.close();save()
 b.close()
r['Completed']=True;r['FinalSourceFingerprint']=source_fingerprint(ROOT);r['Passed']=not r['Errors']and not r['MissingAssets'];save();print(json.dumps({'Passed':r['Passed'],'Completed':r['Completed']},indent=2));raise SystemExit(0 if r['Passed']else 1)
