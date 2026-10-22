const crypto=require('node:crypto');
const {inspect,configured}=require('./community-ai.cjs');
const DAY=864e5,AGE=365*DAY;
const norm=s=>String(s||'').normalize('NFKC').replace(/[\u200B-\u200F\u2060\uFEFF]/g,'');
function localRisk(text){const t=norm(text);return /https?:|www\.|@[\w가-힣]|\d[\d .-]{7,}\d|(?:실명|본명|계정명|아이디)\s*[:：]|(?:로|길)\s*\d|사기꾼|먹튀|죽여|씨발|병신|카지노|대출|카톡|텔레그램/i.test(t);}
module.exports=function createInformation(s){
 const prefix='information/';
 async function posts(){const out=[];for(const k of (await s.list(prefix+'posts/')).slice(-600)){const p=await s.read(k);if(p&&Date.now()-p.created<AGE)out.push(p);}return out.sort((a,b)=>b.created-a.created);}
 async function purge(){for(const k of await s.list(prefix)){const x=await s.read(k);if(x?.expires&&x.expires<Date.now())await s.remove(k);}}
 async function rate(who,action,max){const p=prefix+'rates/'+s.hash(who+':'+action)+'.json',x=await s.read(p)||{n:0,expires:0};if(x.expires<Date.now()){x.n=0;x.expires=Date.now()+DAY;}if(x.n>=max)throw Object.assign(Error('오늘 이용 한도에 도달했어요.'),{status:429});x.n++;await s.write(p,x);}
 async function tally(id){const out={helpful:0,needs_sources:0,unsure:0};for(const k of (await s.list(prefix+'votes/'+id+'/')).slice(0,1000)){const v=await s.read(k);if(v&&v.expires>Date.now()&&Object.hasOwn(out,v.choice))out[v.choice]++;}return out;}
 function safe(p){return p.status==='published'&&!localRisk(p.title+' '+p.body+' '+p.nickname)&&!s.filter(p.title+' '+p.body+' '+p.nickname);}
 return async function(req,res){
  if(s.cors&&s.cors(req,res))return;
  try{
   const b=await s.body(req),admin=s.admin(req),ip=s.who(req);let who=ip;
   if(req.method==='GET'){
    if(req.query?.admin==='1'){if(!admin)return s.send(res,401,{message:'운영자만 확인할 수 있어요.'});await purge();return s.send(res,200,{posts:await posts(),ai:configured()});}
    const all=(await posts()).filter(safe),page=Math.max(1,Number(req.query?.page)||1),max=Math.max(1,Math.ceil(all.length/5)),n=Math.min(max,Math.floor(page));
    const rows=await Promise.all(all.slice((n-1)*5,n*5).map(async p=>({id:p.id,title:p.title,body:p.body,nickname:p.nickname,created:p.created,votes:await tally(p.id)})));
    return s.send(res,200,{posts:rows,count:all.length,page:n,pages:max,ai:configured(),paused:process.env.COMMUNITY_PAUSED==='1'});
   }
   if(req.method!=='POST')return s.send(res,405,{message:'지원하지 않는 요청이에요.'});
   if(!s.origin(req))return s.send(res,403,{message:'허용되지 않은 요청이에요.'});
   if(JSON.stringify(b).length>7000)return s.send(res,413,{message:'내용이 너무 길어요.'});
   if(['approve','hide','delete','reject','unblock'].includes(b.action)&&admin){
    if(!/^[a-f0-9]{32}$/.test(String(b.id)))return s.send(res,400,{message:'글 번호를 확인해 주세요.'});
    const p=await s.read(prefix+'posts/'+b.id+'.json');if(!p)return s.send(res,404,{message:'글을 찾을 수 없어요.'});
    if(b.action==='approve'&&(localRisk(p.title+' '+p.body+' '+p.nickname)||s.filter(p.title+' '+p.body+' '+p.nickname)))return s.send(res,400,{message:'개인정보·금지 표현을 제거해야 해요.'});
    if(b.action==='unblock'){if(p.author)await s.remove(prefix+'blocks/'+p.author+'.json');return s.send(res,200,{ok:true});}
    if(b.action==='reject'&&p.author){const path=prefix+'blocks/'+p.author+'.json',bl=await s.read(path)||{strikes:[],expires:Date.now()+180*DAY};bl.strikes=(bl.strikes||[]).filter(x=>Date.now()-x.at<180*DAY);if(!bl.strikes.some(x=>x.id===p.id))bl.strikes.push({id:p.id,at:Date.now()});if(bl.strikes.length>=2)bl.until=Date.now()+30*DAY;bl.expires=Date.now()+180*DAY;await s.write(path,bl);}
    if(b.action==='delete'){await s.remove(prefix+'posts/'+p.id+'.json');for(const k of await s.list(prefix+'votes/'+p.id+'/'))await s.remove(k);for(const k of await s.list(prefix+'reports/'+p.id+'/'))await s.remove(k);}
    else{p.status=b.action==='approve'?'published':b.action==='reject'?'rejected':'hidden';p.reviewed=Date.now();await s.write(prefix+'posts/'+p.id+'.json',p);}
    return s.send(res,200,{ok:true});
   }
   if(process.env.COMMUNITY_PAUSED==='1')return s.send(res,503,{message:'접수를 잠시 쉬고 있어요.'});
   if(['submit','vote'].includes(b.action)){const account=await s.account(req);if(!account)return s.send(res,401,{message:'이메일 인증 계정으로 먼저 로그인해 주세요.'});who='account:'+account.id;}
   if(b.action==='submit'){
    if(b.age14!==true||b.rights!==true||b.consent!==true||b.aiConsent!==true)return s.send(res,400,{message:'만 14세 이상·권리·공개 및 AI 검토 동의를 확인해 주세요.'});
    const title=norm(b.title).trim(),body=norm(b.body).trim(),nickname=norm(b.nickname).trim();
    if(title.length<2||title.length>60||body.length<10||body.length>1500||!s.nick(nickname))return s.send(res,400,{message:'닉네임 2~12자, 제목 2~60자, 내용 10~1,500자를 확인해 주세요.'});
    if(localRisk(title+' '+body+' '+nickname)||s.filter(title+' '+body+' '+nickname))return s.send(res,400,{message:'개인정보·계정·외부 링크·금지 표현은 올릴 수 없어요. 특정인 제보는 비공개 보관함으로 보내 주세요.'});
    const block=await s.read(prefix+'blocks/'+s.hash(who)+'.json');if(block?.until>Date.now())return s.send(res,403,{message:'반복 위반으로 '+new Date(block.until).toISOString().slice(0,10)+'까지 작성이 제한돼요. 이의제기·삭제 요청은 계속할 수 있어요.'});
    await rate(ip,'network-submit',3);await rate(who,'submit',3);await purge();const all=await posts();
    if(all.length>=500)return s.send(res,503,{message:'보관함 접수 한도에 도달했어요. 운영자 정리 후 다시 열어요.'});
    if(all.filter(p=>Date.now()-p.created<DAY).length>=20)return s.send(res,429,{message:'오늘 전체 글 접수 한도는 20건이에요.'});
    const review=await inspect(title+'\n'+body,s.topic),id=crypto.randomBytes(16).toString('hex'),p={id,title,body,nickname,author:s.hash(who),created:Date.now(),expires:Date.now()+AGE,status:review.decision==='publish'?'published':'pending',review:review.reason};
    await s.write(prefix+'posts/'+id+'.json',p);
    return s.send(res,200,{ok:true,id,state:p.status,message:p.status==='published'?'안전 검토를 통과해 공개했어요. 투표는 자료에 대한 참고 의견이에요.':'비공개 검토 대기함에 접수했어요. AI 연결·판단이 불확실하면 자동 공개하지 않아요.'});
   }
   if(!/^[a-f0-9]{32}$/.test(String(b.id)))return s.send(res,400,{message:'글 번호를 확인해 주세요.'});
   const p=await s.read(prefix+'posts/'+b.id+'.json');if(!p||!safe(p))return s.send(res,404,{message:'공개 글을 찾을 수 없어요.'});
   if(b.action==='vote'){
    if(b.consent!==true||!['helpful','needs_sources','unsure'].includes(b.choice))return s.send(res,400,{message:'투표 안내와 선택을 확인해 주세요.'});
    if(p.author===s.hash(who))return s.send(res,403,{message:'자기 글에는 투표하지 않아요.'});await rate(ip,'network-vote',30);await rate(who,'vote',30);await s.write(prefix+'votes/'+p.id+'/'+s.hash(who)+'.json',{choice:b.choice,expires:p.expires});
    return s.send(res,200,{ok:true,votes:await tally(p.id)});
   }
   if(b.action==='report'){
    await rate(who,'report',10);await s.write(prefix+'reports/'+p.id+'/'+s.hash(who)+'.json',{at:Date.now(),expires:Date.now()+30*DAY});
    const reports=[];for(const k of await s.list(prefix+'reports/'+p.id+'/')){const x=await s.read(k);if(x?.expires>Date.now())reports.push(k);}if(reports.length>=3){p.status='hidden';p.review='reported';await s.write(prefix+'posts/'+p.id+'.json',p);}
    return s.send(res,200,{ok:true,message:'운영자 검토함에 신고를 접수했어요.'});
   }
   return s.send(res,400,{message:'지원하지 않는 동작이에요.'});
  }catch(e){return s.send(res,e.status||500,{message:e.status===429?e.message:'처리하지 못했어요. 잠시 후 다시 시도해 주세요.'});}
 };
};
