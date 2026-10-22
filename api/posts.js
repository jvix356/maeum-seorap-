// 공개 글 목록 보기(GET), 새 글·댓글 쓰기(POST) — 자동 검사를 통과한 새 글은 즉시 공개
const crypto = require('crypto');
const { redis, pipeline, cors, clientHash, check, CRISIS, send, publicView } = require('./_lib');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const kind = req.query.kind === 'board' ? 'board' : 'review';
      const parent = req.query.parent ? String(req.query.parent).slice(0, 40) : null;
      if (parent) {
        const rawParent = await redis('GET', `post:${parent}`);
        if (!rawParent || JSON.parse(rawParent).status !== 'approved') return send(res, 404, { error: '글을 찾을 수 없어요.' });
      }
      const key = parent ? `replies:${parent}` : `list:${kind}`;
      const page = Math.max(0, parseInt(req.query.page || '0', 10) || 0), size = 20;
      const ids = parent
        ? await redis('ZRANGE', key, page * size, page * size + size - 1)
        : await redis('ZREVRANGE', key, page * size, page * size + size - 1);
      const raws = await pipeline(ids.map(id => ['GET', `post:${id}`]));
      const items = raws.filter(Boolean).map(s => JSON.parse(s)).filter(p => p.status === 'approved' && !check([p.nick,p.title,p.body].join(' '))).map(publicView);
      return send(res, 200, { items, more: ids.length === size });
    }
    if (req.method !== 'POST') return send(res, 405, { error: '지원하지 않는 요청이에요.' });

    const b = req.body || {};
    if(b.feedback!==true || b.parent || b.kind==='board')return send(res,403,{error:'공개 글·댓글 신규 접수는 중단했어요. 비공개 개선 의견만 보낼 수 있어요.'});
    if(b.website)return send(res,400,{error:'요청을 처리할 수 없어요.'});
    if(b.consent!==true || b.age14!==true || b.rights!==true)return send(res,400,{error:'만 14세 이상·개인정보 처리 동의·직접 작성 여부를 확인해 주세요.'});
    const body=String(b.body||'').trim();
    if(body.length<5 || body.length>1000)return send(res,400,{error:'의견을 5~1,000자로 적어 주세요.'});
    const bad=check(body);if(bad)return send(res,400,{error:bad+'에 해당하는 내용은 보내지 마세요.'});
    const who=clientHash(req);
    const n=await redis('INCR',`feedbackrate:${who}`);if(n===1)await redis('EXPIRE',`feedbackrate:${who}`,86400);
    if(n>3)return send(res,429,{error:'오늘은 의견을 3개까지 보낼 수 있어요.'});
    const day=new Date(Date.now()+9*3600e3).toISOString().slice(0,10),total=await redis('INCR','feedbackday:'+day);
    if(total===1)await redis('EXPIRE','feedbackday:'+day,172800);
    if(total>30)return send(res,429,{error:'오늘 의견 접수 한도가 찼어요. 다음 날 다시 남겨 주세요.'});
    const id=Date.now().toString(36)+crypto.randomBytes(4).toString('hex');
    const post={id,kind:'feedback',nick:'비공개 의견',title:'개선 의견',body,created:Date.now(),status:'private',private:true};
    await redis('SET','post:'+id,JSON.stringify(post),'EX',90*86400);
    await redis('ZADD','privatefeedback',post.created,id);
    await redis('ZREMRANGEBYSCORE','privatefeedback','-inf',Date.now()-90*864e5);
    return send(res,200,{ok:true,id,message:'운영자에게만 전달했어요. 의견 고마워요!'});

  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.' });
  }
};
