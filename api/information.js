const core=require('../lib/information-core.cjs');
const {redis,pipeline,cors,clientHash,check,send,isAdmin}=require('./_lib');
module.exports=core({account:async req=>{const token=String(req.headers.authorization||'');if(!token.startsWith('Bearer ')||token.length>2000)return null;try{const r=await fetch('https://tarot-check.vercel.app/api/auth',{headers:{Authorization:token},signal:AbortSignal.timeout(5000)});if(!r.ok)return null;const a=await r.json();return a.subject?{id:a.subject}:null;}catch{return null;}},
 read:async k=>{const v=await redis('GET',k);return v?JSON.parse(v):null;},
 write:async(k,v)=>redis('SET',k,JSON.stringify(v),'EX',Math.max(1,Math.ceil(((v.expires||Date.now()+365*864e5)-Date.now())/1000))),
 remove:k=>redis('DEL',k),list:async prefix=>{const all=[];let cursor='0';do{const r=await redis('SCAN',cursor,'MATCH',prefix+'*','COUNT',1000);cursor=String(r[0]);all.push(...r[1]);}while(cursor!=='0');return all.sort();},
 cors,send,body:r=>r.body||{},hash:s=>require('node:crypto').createHmac('sha256',process.env.HASH_SALT||process.env.ADMIN_PASSWORD||'maeum').update(s).digest('hex'),who:clientHash,origin:()=>true,admin:isAdmin,filter:check,nick:n=>/^[가-힣A-Za-z0-9_]{2,12}$/.test(n)&&!check(n)&&!/운영자|관리자|admin|official/i.test(n),topic:'일기 쓰는 방법과 앱 사용 팁·꾸미기 아이디어. 개인 일기·감정 기록·의료 조언은 공유하지 않음.'
});
