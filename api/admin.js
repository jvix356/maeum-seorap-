// 운영자 전용: 승인 대기·신고된 글 보기, 승인·거절·삭제·작성자 차단
const { redis, pipeline, cors, clientHash, send, isAdmin } = require('./_lib');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    const who = clientHash(req);
    if (!isAdmin(req)) {
      const n = await redis('INCR', `adminfail:${who}`);
      if (n === 1) await redis('EXPIRE', `adminfail:${who}`, 900);
      return send(res, 401, { error: n > 10 ? '잠시 뒤에 다시 시도해 주세요.' : '운영자 비밀번호가 맞지 않아요.' });
    }
    if (req.method === 'GET') {
      const q = await redis('ZRANGE', 'queue', 0, 99);
      const rp = await redis('ZREVRANGE', 'reported', 0, 49);
      const load = async ids => (await pipeline(ids.map(i => ['GET', `post:${i}`]))).filter(Boolean).map(s => JSON.parse(s));
      const strip = p => { const { who: _w, ...rest } = p; return { ...rest, author: (p.who || '').slice(0, 6) }; };
      return send(res, 200, { queue: (await load(q)).map(strip), reported: (await load(rp)).map(strip) });
    }
    const { id, action } = req.body || {};
    const raw = await redis('GET', `post:${String(id || '').slice(0, 40)}`);
    if (!raw) return send(res, 404, { error: '글을 찾을 수 없어요.' });
    const p = JSON.parse(raw);
    const listKey = p.parent ? `replies:${p.parent}` : `list:${p.kind}`;
    const bumpReplies = async d => {
      if (!p.parent) return;
      const pr = await redis('GET', `post:${p.parent}`);
      if (pr) { const pp = JSON.parse(pr); pp.replies = Math.max(0, (pp.replies || 0) + d); await redis('SET', `post:${p.parent}`, JSON.stringify(pp)); }
    };
    if (action === 'approve') {
      const wasLive = p.status === 'approved' || p.status === 'hidden';
      p.status = 'approved'; p.reports = 0;
      await redis('ZADD', listKey, p.created, p.id);
      await redis('ZREM', 'queue', p.id); await redis('ZREM', 'reported', p.id);
      if (!wasLive) await bumpReplies(1);
    } else if (action === 'dismiss') {
      await redis('ZREM', 'reported', p.id);
      return send(res, 200, { ok: true });
    } else if (action === 'reject' || action === 'delete' || action === 'block') {
      if (p.status === 'approved' || p.status === 'hidden') await bumpReplies(-1);
      p.status = 'rejected';
      await redis('ZREM', listKey, p.id); await redis('ZREM', 'queue', p.id); await redis('ZREM', 'reported', p.id);
      if (action === 'block' && p.who) await redis('SET', `block:${p.who}`, '1', 'EX', 60 * 60 * 24 * 180);
      if (action !== 'reject') { await redis('DEL', `post:${p.id}`); return send(res, 200, { ok: true }); }
    } else return send(res, 400, { error: '알 수 없는 동작이에요.' });
    await redis('SET', `post:${p.id}`, JSON.stringify(p));
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : '잠시 문제가 생겼어요.' });
  }
};
