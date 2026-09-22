/** Execute and record, never infer success from an older log. */
import { spawn } from 'node:child_process';
import { readFileSync,writeFileSync,readdirSync,mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SourceFingerprint } from './source-fingerprint.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=path.join(root,'artifacts/validation-optimized');
mkdirSync(dir,{recursive:true});
const version=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).version;
const report={Version:version,SourceFingerprint:SourceFingerprint(root),StartedAt:new Date().toISOString(),Completed:false,Passed:false};
const save=()=>writeFileSync(path.join(dir,'node-final.json'),JSON.stringify(report,null,2)+'\n');save();
const args=['--import','./scripts/register-loader.mjs','--test',...readdirSync(path.join(root,'tests')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'tests/'+n)];
const child=spawn(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe']});let text='';
child.stdout.on('data',b=>{text+=b;process.stdout.write(b);});child.stderr.on('data',b=>{text+=b;process.stderr.write(b);});
child.on('error',e=>{report.Error=e.stack;save();process.exitCode=1;});
child.on('close',code=>{
    writeFileSync(path.join(dir,'node-final.log'),text);
    const count=name=>Number(text.match(new RegExp('^# '+name+' (\\d+)$','m'))?.[1]??NaN);
    Object.assign(report,{ExitCode:code,Completed:true,CompletedAt:new Date().toISOString(),Tests:count('tests'),Pass:count('pass'),Fail:count('fail'),Skip:count('skipped'),Cancelled:count('cancelled'),FinalSourceFingerprint:SourceFingerprint(root)});
    report.Passed=code===0 && report.Pass>0 && report.Fail===0 && report.Skip===0 && report.Cancelled===0 && report.SourceFingerprint===report.FinalSourceFingerprint;
    save();if(!report.Passed)process.exitCode=1;
});
