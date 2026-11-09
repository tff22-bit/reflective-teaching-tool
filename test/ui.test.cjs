const { chromium } = require('playwright');
const http = require('http'), fs = require('fs');
const srv = http.createServer((q,r)=>{ r.setHeader('content-type','text/html; charset=utf-8'); r.end(fs.readFileSync(__dirname+'/../public/index.html')); });
(async()=>{
 await new Promise(r=>srv.listen(0,r)); const base='http://localhost:'+srv.address().port+'/';
 const b=await chromium.launch(); const errs=[];
 async function open(mode){ // mode: ok | down
  const ctx=await b.newContext(); const pg=await ctx.newPage(); pg.on('pageerror',e=>errs.push(e.message));
  const log={posts:0,gets:0}; let total=7;
  await pg.route('**/api/sessions',async route=>{
    const m=route.request().method();
    if(mode==='down') return route.abort();
    if(m==='POST'){log.posts++; total++; return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({total})});}
    log.gets++; return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({total})});
  });
  await pg.goto(base); return {pg,log,ctx};
 }
 // ok mode
 let {pg,log}=await open('ok');
 await pg.waitForSelector('#countLine:not([hidden])'); console.log('count line:',await pg.innerText('#countLine'));
 console.log('eval disabled initially:',await pg.locator('#evalLi button').isDisabled());
 await pg.click('#startBtn'); await pg.waitForTimeout(300); console.log('posts after start',log.posts);
 await pg.reload(); await pg.waitForTimeout(200);
 await pg.click('#nextBtn'); await pg.click('#nextBtn'); await pg.click('[data-go="home"]'); await pg.click('#startBtn'); await pg.waitForTimeout(300);
 console.log('posts after reload/nav/home-again',log.posts);
 // complete all required, check eval link
 await pg.evaluate(()=>{const K="muhaqqiq-taammuli-v1";const s=JSON.parse(localStorage.getItem(K));[0,1,3,4,5,8,9,10].forEach(i=>s.answers[i]={text:"نص",choice:null,follow:"",fk:"",other:""});localStorage.setItem(K,JSON.stringify(s));});
 await pg.reload(); await pg.waitForTimeout(200);
 const a=pg.locator('#evalLi a'); console.log('eval link:',await a.getAttribute('href'),await a.getAttribute('target'));
 // new session from report
 await pg.click('[data-go="results"]'); await pg.click('#resetBtn'); await pg.click('#yesReset'); await pg.waitForTimeout(300);
 console.log('posts after new session',log.posts,'| eval disabled again:',await pg.locator('#evalLi button').isDisabled());
 // down mode
 ({pg,log}=await open('down')); await pg.waitForTimeout(300);
 console.log('down: count line hidden =',await pg.locator('#countLine').isHidden());
 await pg.click('#startBtn'); await pg.fill('#ans','مرحبا'); await pg.click('#nextBtn');
 console.log('down: tool works ->',(await pg.innerText('.prog-row')).trim());
 console.log('errors',errs);
 await b.close(); srv.close();
})();
