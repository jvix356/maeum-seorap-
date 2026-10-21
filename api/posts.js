// 공개 글 목록 보기(GET), 새 글·댓글 쓰기(POST) — 새 글은 운영자 승인 후 공개
const crypto = require('crypto');
const { redis, pipeline, cors, clientHash, check, CRISIS, send, publicView } = require('./_lib');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const kind = req.query.kind === 'board' ? 'board' : 'review';
      const parent = req.query.parent ? String(req.query.parent).slice(0, 40) : null;
      const key = parent ? `replies:${parent}` : `list:${kind}`;
      const page = Math.max(0, parseInt(req.query.page || '0', 10) || 0), size = 20;
      const ids = parent
        ? await redis('ZRANGE', key, page * size, page * size + size - 1)
        : await redis('ZREVRANGE', key, page * size, page * size + size - 1);
      const raws = await pipeline(ids.map(id => ['GET', `post:${id}`]));
      const items = raws.filter(Boolean).map(s => JSON.parse(s)).filter(p => p.status === 'approved').map(publicView);
      return send(res, 200, { items, more: ids.length === size });
    }
    if (req.method !== 'POST') return send(res, 405, { error: '지원하지 않는 요청이에요.' });

    const b = req.body || {};
    if (b.website) return send(res, 200, { ok: true, status: 'pending' }); // 봇 함정 칸
    const who = clientHash(req);
    if (await redis('EXISTS', `block:${who}`)) return send(res, 403, { error: '운영 원칙 위반으로 글쓰기가 제한됐어요.' });
    const n = await redis('INCR', `rl:${who}`);
    if (n === 1) await redis('EXPIRE', `rl:${who}`, 600);
    if (n > 5) return send(res, 429, { error: '짧은 시간에 글을 너무 많이 썼어요. 10분 뒤에 다시 써 주세요.' });

    const kind = b.kind === 'board' ? 'board' : 'review';
    const parent = b.parent ? String(b.parent).slice(0, 40) : null;
    const nick = String(b.nick || '').trim().slice(0, 12) || '익명';
    const title = parent || kind === 'review' ? '' : String(b.title || '').trim().slice(0, 60);
    const body = String(b.body || '').trim().slice(0, 2000);
    if (body.length < 5) return send(res, 400, { error: '내용을 5자 이상 적어 주세요.' });
    if (kind === 'board' && !parent && title.length < 2) return send(res, 400, { error: '제목을 적어 주세요.' });
    if (parent) {
      const pp = await redis('GET', `post:${parent}`);
      if (!pp || JSON.parse(pp).status !== 'approved') return send(res, 404, { error: '댓글을 달 글을 찾을 수 없어요.' });
    }
    const bad = check(`${nick} ${title} ${body}`);
    if (bad) return send(res, 400, { error: `${bad}에 해당하는 내용은 올릴 수 없어요. 고쳐서 다시 써 주세요.` });

    const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const crisis = CRISIS.test(`${title} ${body}`);
    const post = { id, kind, parent, nick, title, body, created: Date.now(), status: 'pending', reports: 0, who, crisis, replies: 0 };
    await redis('SET', `post:${id}`, JSON.stringify(post));
    await redis('ZADD', 'queue', post.created, id);
    return send(res, 200, { ok: true, status: 'pending', crisis });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.' });
  }
};
