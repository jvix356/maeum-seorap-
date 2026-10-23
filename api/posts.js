// 공개 글 목록 보기(GET), 새 글·댓글 쓰기(POST) — 예전처럼 닉네임만으로 쓰고, 자동 검사를 통과하면 바로 공개해요.
// 2026-10-23: 작성 한도(접속 구분값·사이트 전체), 개인정보 자동 가림, 1년 뒤 자동 삭제, 선택형 AI 공감 답글을 더했어요.
const crypto = require('crypto');
const { redis, pipeline, cors, clientHash, check, CRISIS, send, publicView, maskPrivate } = require('./_lib');
const { listen } = require('../lib/diary-ai.cjs');

const KEEP = 365 * 86400; // 공개 글·댓글은 1년 뒤 자동 삭제
const CRISIS_PRAISE = '여기까지 와 준 것만으로도 정말 잘했어요. 많이 힘들다면 혼자 견디지 말고 자살예방상담전화 109(24시간)나 1577-0199에 이야기해 주세요. 위급하면 112·119로 바로 연락해요.'; // 칭찬 게시판에 위기 표현이 보일 때 칭찬봇 대신 남기는 안내
const PER_DAY = { post: 5, comment: 20 }; // 접속 구분값당 하루
const SITE_DAY = { review: 100, board: 100, praise: 100, comment: 300 }; // 사이트 전체 하루
const KINDS = ['review', 'board', 'praise']; // 후기·마음 나눔·오구오구 칭찬(자랑) 게시판
const THREAD = ['review', 'board', 'praise']; // 댓글·대댓글을 달 수 있는 게시판(후기·마음 나눔·칭찬 모두)
const EMOJIS = ['heart', 'empathy', 'praise', 'hug']; // ❤️ 좋아요 · 🤝 공감 · 👏 칭찬해요 · 🫂 토닥토닥
const voterOf = (who, dev) => crypto.createHash('sha256').update(who + '|' + (dev || '')).digest('hex').slice(0, 24);
async function metaFor(ids, voter) {
  if (!ids.length) return {};
  const cmds = [];
  for (const id of ids) { cmds.push(['HGETALL', `react:${id}`], ['GET', `views:${id}`]); if (voter) for (const e of EMOJIS) cmds.push(['EXISTS', `reacted:${id}:${voter}:${e}`]); }
  const r = await pipeline(cmds), out = {}; let i = 0;
  for (const id of ids) {
    const h = r[i++] || [], counts = {};
    if (Array.isArray(h)) for (let k = 0; k < h.length; k += 2) counts[h[k]] = Math.max(0, Number(h[k + 1]) || 0); else if (h && typeof h === 'object') for (const k in h) counts[k] = Math.max(0, Number(h[k]) || 0);
    const v = Number(r[i++]) || 0, mine = [];
    if (voter) for (const e of EMOJIS) if (Number(r[i++])) mine.push(e);
    out[id] = { r: counts, v, mine };
  }
  return out;
}
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
async function bump(key, ttl) { const n = await redis('INCR', key); if (n === 1) await redis('EXPIRE', key, ttl); return n; }

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    if (req.method === 'GET') {
      const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'review';
      const parent = req.query.parent ? String(req.query.parent).slice(0, 40) : null;
      if (parent) {
        const rawParent = await redis('GET', `post:${parent}`);
        if (!rawParent || JSON.parse(rawParent).status !== 'approved') return send(res, 404, { error: '글을 찾을 수 없어요.' });
      }
      const key = parent ? `replies:${parent}` : `list:${kind}`;
      const page = Math.max(0, parseInt(req.query.page || '0', 10) || 0), size = parent ? 100 : (req.query.size === '5' ? 5 : 20); // 목록은 한 페이지 5개, 댓글은 한 번에 100개
      const ids = parent
        ? await redis('ZRANGE', key, page * size, page * size + size - 1)
        : await redis('ZREVRANGE', key, page * size, page * size + size - 1);
      const raws = await pipeline(ids.map(id => ['GET', `post:${id}`]));
      const items = raws.filter(Boolean).map(s => JSON.parse(s)).filter(p => p.status === 'approved' && (p.ai || !check([p.nick, p.title, p.body].join(' ')))).map(p => ({ ...publicView(p), ai: !!p.ai }));
      const meta = await metaFor(items.map(p => p.id), null);
      for (const it of items) { it.r = meta[it.id].r; it.v = meta[it.id].v; }
      const total = parent ? items.length : Number(await redis('ZCARD', key)) || 0;
      return send(res, 200, { items, more: ids.length === size, total, pages: Math.max(1, Math.ceil(total / size)), page });
    }
    if (req.method !== 'POST') return send(res, 405, { error: '지원하지 않는 요청이에요.' });
    if (process.env.COMMUNITY_PAUSED === '1') return send(res, 503, { error: '지금은 새 글 접수를 잠시 쉬고 있어요.' });

    const b = req.body || {};
    if (b.website) return send(res, 400, { error: '요청을 처리할 수 없어요.' }); // 봇 함정 칸
    const who = clientHash(req);
    // 공감·조회수: 누른 사람은 접속 구분 해시+브라우저 구분값을 다시 변환한 값으로만 구분해요.
    if (['react', 'view', 'meta'].includes(b.action)) {
      const voter = voterOf(who, /^[a-f0-9]{32}$/.test(String(b.dev || '')) ? b.dev : '');
      if (b.action === 'meta') return send(res, 200, { meta: await metaFor((Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => /^[a-z0-9]{6,40}$/.test(x)).slice(0, 60), voter) });
      const id = String(b.id || '').slice(0, 40), raw = await redis('GET', `post:${id}`);
      if (!raw || JSON.parse(raw).status !== 'approved') return send(res, 404, { error: '글을 찾을 수 없어요.' });
      const Y = 365 * 86400;
      if (b.action === 'view') {
        const fresh = await redis('SET', `viewseen:${id}:${voter}:${kstDay()}`, '1', 'NX', 'EX', 172800);
        if (fresh) { const v = await redis('INCR', `views:${id}`); await redis('EXPIRE', `views:${id}`, Y); return send(res, 200, { v }); }
        return send(res, 200, { v: Number(await redis('GET', `views:${id}`)) || 0 });
      }
      const emoji = String(b.emoji || '');
      if (!EMOJIS.includes(emoji)) return send(res, 400, { error: '알 수 없는 공감이에요.' });
      if (await bump(`reactrate:${voter}:${kstDay()}`, 86400) > 300) return send(res, 429, { error: '오늘은 공감을 충분히 눌렀어요. 내일 다시 눌러 주세요.' });
      const mark = `reacted:${id}:${voter}:${emoji}`;
      if (await redis('SET', mark, '1', 'NX', 'EX', Y)) await redis('HINCRBY', `react:${id}`, emoji, 1);
      else { await redis('DEL', mark); await redis('HINCRBY', `react:${id}`, emoji, -1); }
      await redis('EXPIRE', `react:${id}`, Y);
      return send(res, 200, (await metaFor([id], voter))[id]);
    }
    const dev = /^[a-f0-9]{32}$/.test(String(b.dev || '')) ? 'dev' + crypto.createHmac('sha256', process.env.HASH_SALT || process.env.ADMIN_PASSWORD || 'maeum').update('dev:' + b.dev).digest('hex').slice(0, 24) : null;
    for (const k of [who, dev].filter(Boolean)) { const bl = await redis('GET', `block:${k}`); if (bl) return send(res, 403, { error: bl === 'permanent' ? '운영 원칙 위반이 반복돼 영구 정지됐어요. 이의는 개인정보처리방침의 문의 이메일로 보내 주세요.' : '운영 원칙 위반으로 30일 동안 글쓰기가 제한됐어요.' }); }
    if (await bump(`rl:${who}`, 600) > 5) return send(res, 429, { error: '짧은 시간에 글을 너무 많이 썼어요. 10분 뒤에 다시 써 주세요.' });

    const kind = KINDS.includes(b.kind) ? b.kind : 'review';
    let parent = b.parent ? String(b.parent).slice(0, 40) : null, to = null;
    const toNick = ''; // 예전 칭찬 릴레이의 받는 사람 칸은 쓰지 않아요
    const nick = String(b.nick || '').trim().slice(0, 12) || '익명';
    const m1 = maskPrivate(parent || kind === 'review' ? '' : String(b.title || '').trim().slice(0, 60));
    const m2 = maskPrivate(String(b.body || '').trim().slice(0, 2000));
    const title = m1.text, body = m2.text, masked = [...new Set([...m1.masked, ...m2.masked])];
    if (body.length < 5) return send(res, 400, { error: '내용을 5자 이상 적어 주세요.' });
    if ((kind === 'board' || kind === 'praise') && !parent && title.length < 2) return send(res, 400, { error: '제목을 적어 주세요.' });
    if (/[가-힣]/.test(nick) === false && !/[a-z0-9]/i.test(nick)) return send(res, 400, { error: '닉네임을 확인해 주세요.' });
    if (parent) {
      const pp = await redis('GET', `post:${parent}`), P = pp && JSON.parse(pp);
      if (!P || P.status !== 'approved' || !THREAD.includes(P.kind)) return send(res, 404, { error: '댓글을 달 글을 찾을 수 없어요.' });
      if (P.parent) { // 대댓글: 댓글에 답글을 달면 원글 아래에 두고, 어느 댓글에 단 답글인지(to) 기록해요. 한 단계까지만 들여 써요.
        const rp = await redis('GET', `post:${P.parent}`);
        if (!rp || JSON.parse(rp).status !== 'approved') return send(res, 404, { error: '댓글을 달 글을 찾을 수 없어요.' });
        to = P.to || P.id; parent = P.parent;
      }
    }
    // 1인 여러 닉네임 방지: 접속·브라우저 구분값마다 처음 닉네임 30일 고정, 닉네임도 처음 쓴 사람에게 30일 묶음
    { const n = nick.toLowerCase(), keys = [who, dev].filter(Boolean), T = 30 * 86400;
      const ownerKey = 'nickowner:' + crypto.createHash('sha256').update(n).digest('hex').slice(0, 24), owner = await redis('GET', ownerKey);
      if (owner && !keys.some(k => owner.split(',').includes(k))) return send(res, 409, { error: '이미 다른 분이 쓰고 있는 닉네임이에요. 다른 닉네임을 정해 주세요.' });
      for (const k of keys) { const l = await redis('GET', 'nicklock:' + k); if (l && l.toLowerCase() !== n) return send(res, 409, { error: `한 사람이 여러 닉네임을 쓰지 못하게, 30일 동안 처음 쓴 닉네임 "${l}"로만 쓸 수 있어요.` }); }
      for (const k of keys) await redis('SET', 'nicklock:' + k, nick, 'EX', T);
      await redis('SET', ownerKey, [...new Set([...(owner ? owner.split(',') : []), ...keys])].slice(0, 6).join(','), 'EX', T); }
    const bad = check(`${nick} ${toNick} ${title.split('[가림]').join(' ')} ${body.split('[가림]').join(' ')}`);
    if (bad) return send(res, 400, { error: `${bad}에 해당하는 내용은 올릴 수 없어요. 고쳐서 다시 써 주세요.` });

    const day = kstDay(), slot = parent ? 'comment' : kind;
    if (await bump(`daily:${parent ? 'comment' : 'post'}:${who}:${day}`, 86400) > PER_DAY[parent ? 'comment' : 'post'])
      return send(res, 429, { error: parent ? '오늘은 댓글을 20개까지 쓸 수 있어요.' : '오늘은 글을 5개까지 쓸 수 있어요. 내일 다시 만나요.' });
    if (await bump(`site:${slot}:${day}`, 172800) > SITE_DAY[slot]) return send(res, 429, { error: '오늘 게시판 전체 접수 한도가 찼어요. 내일 다시 써 주세요.' });

    const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const crisis = CRISIS.test(`${title} ${body}`);
    const post = { id, kind, parent, to, toNick, nick, title, body, created: Date.now(), status: 'approved', moderation: 'rules', reports: 0, who, dev, crisis, replies: 0 };
    await redis('SET', `post:${id}`, JSON.stringify(post), 'EX', KEEP);
    await redis('ZADD', parent ? `replies:${parent}` : `list:${kind}`, post.created, id);
    await redis('ZREMRANGEBYSCORE', parent ? `replies:${parent}` : `list:${kind}`, '-inf', Date.now() - KEEP * 1000);
    const addReply = async parentId => {
      const rawParent = await redis('GET', `post:${parentId}`);
      if (rawParent) { const p = JSON.parse(rawParent); p.replies = (p.replies || 0) + 1; const ttl = Math.max(60, KEEP - Math.floor((Date.now() - p.created) / 1000)); await redis('SET', `post:${parentId}`, JSON.stringify(p), 'EX', ttl); }
    };
    if (parent) await addReply(parent);

    // 오구오구 칭찬 게시판: 자랑 글에는 칭찬봇이 바로 칭찬 댓글을 달아요(AI·외부 전송 없이 정해진 문장 중에서 골라요).
    if (kind === 'praise' && !parent) {
      const PRAISE = ['오구오구 너무 잘했어요! 👏 이런 작은 하루가 쌓여서 큰 힘이 돼요.', '와, 진짜 대단해요! 오늘의 나 칭찬 백 개 드려요 💯', '잘했다 잘했어! 해낸 거 자체가 멋져요 ✨', '우쭈쭈 최고예요! 내일의 나도 고마워할 거예요 🥰', '이거 쉬운 일 아닌데 해냈네요! 박수 짝짝짝 👏👏', '오늘도 스스로를 챙긴 당신, 정말 멋져요 🌷', '칭찬 도장 꾹! 오늘 하루 아주 잘 보냈어요 💮', '해낸 걸 자랑해 줘서 고마워요. 그 마음까지 칭찬해요 💛'];
      const body2 = crisis ? CRISIS_PRAISE : PRAISE[crypto.randomInt(PRAISE.length)];
      const rid = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      const rp = { id: rid, kind: 'praise', parent: id, nick: '오구오구 칭찬봇 (자동)', title: '', body: body2, created: Date.now() + 1, status: 'approved', moderation: 'auto', ai: true, reports: 0, who: 'bot', replies: 0 };
      await redis('SET', `post:${rid}`, JSON.stringify(rp), 'EX', KEEP);
      await redis('ZADD', `replies:${id}`, rp.created, rid);
      await addReply(id);
    }
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
    return send(res, 200, { ok: true, id, status: 'approved', crisis, masked, aiReply: kind === 'praise' && !parent ? 'praise' : aiReply, message: (parent ? '댓글이 공개됐어요.' : '글이 공개됐어요.') + note });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.' });
  }
};
