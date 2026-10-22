// 공개 글 목록 보기(GET), 새 글·댓글 쓰기(POST) — 예전처럼 닉네임만으로 쓰고, 자동 검사를 통과하면 바로 공개해요.
// 2026-10-23: 작성 한도(접속 구분값·사이트 전체), 개인정보 자동 가림, 1년 뒤 자동 삭제, 선택형 AI 공감 답글을 더했어요.
const crypto = require('crypto');
const { redis, pipeline, cors, clientHash, check, CRISIS, send, publicView, maskPrivate } = require('./_lib');
const { listen } = require('../lib/diary-ai.cjs');

const KEEP = 365 * 86400; // 공개 글·댓글은 1년 뒤 자동 삭제
const PER_DAY = { post: 5, comment: 20 }; // 접속 구분값당 하루
const SITE_DAY = { review: 100, board: 100, comment: 300 }; // 사이트 전체 하루
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
async function bump(key, ttl) { const n = await redis('INCR', key); if (n === 1) await redis('EXPIRE', key, ttl); return n; }

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
      const items = raws.filter(Boolean).map(s => JSON.parse(s)).filter(p => p.status === 'approved' && (p.ai || !check([p.nick, p.title, p.body].join(' ')))).map(p => ({ ...publicView(p), ai: !!p.ai }));
      return send(res, 200, { items, more: ids.length === size });
    }
    if (req.method !== 'POST') return send(res, 405, { error: '지원하지 않는 요청이에요.' });
    if (process.env.COMMUNITY_PAUSED === '1') return send(res, 503, { error: '지금은 새 글 접수를 잠시 쉬고 있어요.' });

    const b = req.body || {};
    if (b.website) return send(res, 400, { error: '요청을 처리할 수 없어요.' }); // 봇 함정 칸
    const who = clientHash(req);
    const dev = /^[a-f0-9]{32}$/.test(String(b.dev || '')) ? 'dev' + crypto.createHmac('sha256', process.env.HASH_SALT || process.env.ADMIN_PASSWORD || 'maeum').update('dev:' + b.dev).digest('hex').slice(0, 24) : null;
    for (const k of [who, dev].filter(Boolean)) { const bl = await redis('GET', `block:${k}`); if (bl) return send(res, 403, { error: bl === 'permanent' ? '운영 원칙 위반이 반복돼 영구 정지됐어요. 이의는 개인정보처리방침의 문의 이메일로 보내 주세요.' : '운영 원칙 위반으로 30일 동안 글쓰기가 제한됐어요.' }); }
    if (await bump(`rl:${who}`, 600) > 5) return send(res, 429, { error: '짧은 시간에 글을 너무 많이 썼어요. 10분 뒤에 다시 써 주세요.' });

    const kind = b.kind === 'board' ? 'board' : 'review';
    const parent = b.parent ? String(b.parent).slice(0, 40) : null;
    const nick = String(b.nick || '').trim().slice(0, 12) || '익명';
    const m1 = maskPrivate(parent || kind === 'review' ? '' : String(b.title || '').trim().slice(0, 60));
    const m2 = maskPrivate(String(b.body || '').trim().slice(0, 2000));
    const title = m1.text, body = m2.text, masked = [...new Set([...m1.masked, ...m2.masked])];
    if (body.length < 5) return send(res, 400, { error: '내용을 5자 이상 적어 주세요.' });
    if (kind === 'board' && !parent && title.length < 2) return send(res, 400, { error: '제목을 적어 주세요.' });
    if (/[가-힣]/.test(nick) === false && !/[a-z0-9]/i.test(nick)) return send(res, 400, { error: '닉네임을 확인해 주세요.' });
    if (parent) {
      const pp = await redis('GET', `post:${parent}`);
      if (!pp || (JSON.parse(pp).status !== 'approved' || JSON.parse(pp).parent || JSON.parse(pp).kind !== 'board')) return send(res, 404, { error: '댓글을 달 글을 찾을 수 없어요.' });
    }
    // 1인 여러 닉네임 방지: 접속·브라우저 구분값마다 처음 닉네임 30일 고정, 닉네임도 처음 쓴 사람에게 30일 묶음
    { const n = nick.toLowerCase(), keys = [who, dev].filter(Boolean), T = 30 * 86400;
      const ownerKey = 'nickowner:' + crypto.createHash('sha256').update(n).digest('hex').slice(0, 24), owner = await redis('GET', ownerKey);
      if (owner && !keys.some(k => owner.split(',').includes(k))) return send(res, 409, { error: '이미 다른 분이 쓰고 있는 닉네임이에요. 다른 닉네임을 정해 주세요.' });
      for (const k of keys) { const l = await redis('GET', 'nicklock:' + k); if (l && l.toLowerCase() !== n) return send(res, 409, { error: `한 사람이 여러 닉네임을 쓰지 못하게, 30일 동안 처음 쓴 닉네임 "${l}"로만 쓸 수 있어요.` }); }
      for (const k of keys) await redis('SET', 'nicklock:' + k, nick, 'EX', T);
      await redis('SET', ownerKey, [...new Set([...(owner ? owner.split(',') : []), ...keys])].slice(0, 6).join(','), 'EX', T); }
    const bad = check(`${nick} ${title.split('[가림]').join(' ')} ${body.split('[가림]').join(' ')}`);
    if (bad) return send(res, 400, { error: `${bad}에 해당하는 내용은 올릴 수 없어요. 고쳐서 다시 써 주세요.` });

    const day = kstDay(), slot = parent ? 'comment' : kind;
    if (await bump(`daily:${parent ? 'comment' : 'post'}:${who}:${day}`, 86400) > PER_DAY[parent ? 'comment' : 'post'])
      return send(res, 429, { error: parent ? '오늘은 댓글을 20개까지 쓸 수 있어요.' : '오늘은 글을 5개까지 쓸 수 있어요. 내일 다시 만나요.' });
    if (await bump(`site:${slot}:${day}`, 172800) > SITE_DAY[slot]) return send(res, 429, { error: '오늘 게시판 전체 접수 한도가 찼어요. 내일 다시 써 주세요.' });

    const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const crisis = CRISIS.test(`${title} ${body}`);
    const post = { id, kind, parent, nick, title, body, created: Date.now(), status: 'approved', moderation: 'rules', reports: 0, who, dev, crisis, replies: 0 };
    await redis('SET', `post:${id}`, JSON.stringify(post), 'EX', KEEP);
    await redis('ZADD', parent ? `replies:${parent}` : `list:${kind}`, post.created, id);
    await redis('ZREMRANGEBYSCORE', parent ? `replies:${parent}` : `list:${kind}`, '-inf', Date.now() - KEEP * 1000);
    const addReply = async parentId => {
      const rawParent = await redis('GET', `post:${parentId}`);
      if (rawParent) { const p = JSON.parse(rawParent); p.replies = (p.replies || 0) + 1; const ttl = Math.max(60, KEEP - Math.floor((Date.now() - p.created) / 1000)); await redis('SET', `post:${parentId}`, JSON.stringify(p), 'EX', ttl); }
    };
    if (parent) await addReply(parent);

    // AI 공감 답글: 마음 나눔 새 글 + 작성자 동의(aiListen)일 때만
    let aiReply = null;
    if (kind === 'board' && !parent && b.aiListen === true) {
      const r = await listen(title, body, crisis);
      if (r) {
        const rid = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
        const rp = { id: rid, kind: 'board', parent: id, nick: 'AI 마음 친구 (자동 답글)', title: '', body: r.reply + '\n\n※ AI가 자동으로 쓴 답글이에요. 전문 상담이 아니에요.', created: Date.now() + 1, status: 'approved', moderation: 'ai', ai: true, reports: 0, who: 'ai', replies: 0 };
        await redis('SET', `post:${rid}`, JSON.stringify(rp), 'EX', KEEP);
        await redis('ZADD', `replies:${id}`, rp.created, rid);
        await addReply(id);
        aiReply = r.kind;
      }
    }
    const note = masked.length ? ` 개인정보로 보이는 내용(${masked.join(', ')})은 자동으로 가렸어요.` : '';
    return send(res, 200, { ok: true, id, status: 'approved', crisis, masked, aiReply, message: (parent ? '댓글이 공개됐어요.' : '글이 공개됐어요.') + note });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.' });
  }
};
