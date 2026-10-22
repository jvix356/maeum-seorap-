(()=>{
  const out=document.getElementById('visitStats');
  if(!out)return;
  const api=location.hostname==='maeum-seorap.vercel.app'?'': 'https://maeum-seorap.vercel.app';
  const day=()=>new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
  const fmt=n=>Number(n).toLocaleString('ko-KR');
  async function run(){
    const stamp=day();let count=false,allowed=false;
    try{allowed=localStorage.getItem('ms.visit.exclude')!=='1';count=allowed&&localStorage.getItem('ms.visit.day')!==stamp;}catch(e){}
    try{
      const r=await fetch(api+'/api/stats',{method:count?'POST':'GET',credentials:'omit',cache:'no-store',headers:count?{'Content-Type':'application/json'}:{},...(count?{body:JSON.stringify({visit:true})}:{}),signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw Error('stats');
      const j=await r.json();
      if(count)try{localStorage.setItem('ms.visit.day',j.day);}catch(e){}
      out.textContent='오늘 방문 '+fmt(j.today)+'회 · 누적 방문 '+fmt(j.total)+'회';
      const since=document.getElementById('visitSince');
      if(since)since.textContent=j.since?'집계 시작: '+j.since+' · 한국 시간 기준':'방문 집계 시작 전';
    }catch(e){out.textContent='방문 통계를 잠시 불러올 수 없어요.';}
  }
  const toggle=document.getElementById('visitExclude');
  if(toggle){
    try{toggle.checked=localStorage.getItem('ms.visit.exclude')==='1';}catch(e){toggle.disabled=true;}
    toggle.addEventListener('change',()=>{try{localStorage.setItem('ms.visit.exclude',toggle.checked?'1':'0');}catch(e){}});
  }
  const start=()=>{if(navigator.locks)navigator.locks.request('maeum-visit-count',run).catch(()=>{out.textContent='방문 통계를 잠시 불러올 수 없어요.';});else run();};
  if(document.visibilityState==='visible')start();
  else document.addEventListener('visibilitychange',function shown(){if(document.visibilityState==='visible'){document.removeEventListener('visibilitychange',shown);start();}});
})();