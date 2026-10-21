// 신고: 한 사람당 한 번, 3번 이상 신고되면 자동으로 숨기고 운영자 확인 대기로 보냄
const { redis, cors, clientHash, send } = require('./_lib');

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, 405, { error: '지원하지 않는 요청이에요.' });
  try {
    const id = String((req.body || {}).id || '').slice(0, 40);
    const reason = String((req.body || {}).reason || '').slice(0, 100);
    const raw = id && await redis('GET', `post:${id}`);
    if (!raw) return send(res, 404, { error: '글을 찾을 수 없어요.' });
    const who = clientHash(req);
    const first = await redis('SET', `rep:${id}:${who}`, '1', 'NX', 'EX', 60 * 60 * 24 * 30);
    if (!first) return send(res, 200, { ok: true, already: true });
    const p = JSON.parse(raw);
    p.reports = (p.reports || 0) + 1;
    p.reportReasons = [...(p.reportReasons || []), reason].slice(-10);
    if (p.reports >= 3 && p.status === 'approved') {
      p.status = 'hidden';
      await redis('ZREM', p.parent ? `replies:${p.parent}` : `list:${p.kind}`, id);
      await redis('ZADD', 'queue', Date.now(), id);
    } else if (p.status === 'approved') {
      await redis('ZADD', 'reported', Date.now(), id);
    }
    await redis('SET', `post:${id}`, JSON.stringify(p));
    return send(res, 200, { ok: true });
  } catch (e) {
    return send(res, e.status || 500, { error: e.status ? e.message : '잠시 문제가 생겼어요.' });
  }
};
