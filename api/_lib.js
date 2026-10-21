// 마음 서랍 커뮤니티 공용 도구 (Upstash Redis REST, 의존성 없음)
const crypto = require('crypto');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ALLOWED = ['https://maeum-seorap.vercel.app', 'https://jvix356.github.io'];

async function redis(...cmd) {
  if (!KV_URL || !KV_TOKEN) throw Object.assign(new Error('저장소가 아직 연결되지 않았어요.'), { status: 503 });
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const r = await fetch(KV_URL.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  return j.map(x => x.result);
}

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ALLOWED.includes(o)) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Key');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// 접속 정보는 저장하지 않고, 되돌릴 수 없는 해시만 도배·차단 판단에 씀
function clientHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const salt = process.env.HASH_SALT || process.env.ADMIN_PASSWORD || 'maeum';
  return crypto.createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 24);
}

const norm = s => String(s || '').replace(/[\s​.\-_*~!?,·ㆍ'"`^]+/g, '').toLowerCase();

const RULES = [
  { why: '욕설이나 모욕', re: /(씨발|시발|ㅅㅂ|ㅆㅂ|씨바|병신|ㅂㅅ|븅신|좆|존나|졸라|개새|개색|미친놈|미친년|ㅁㅊ|지랄|ㅈㄹ|닥쳐|꺼져|엿먹|등신|한남충|김치녀|틀딱|느금)/ },
  { why: '위협', re: /(죽여버|죽일거|죽이겠|패버|칼로찌|찾아가서|신상털|주소알아)/ },
  { why: '음란하거나 성적인 내용', re: /(섹스|섹파|야동|자위행위|성관계하|조건만남|조건녀|원나잇|몸캠|성매매|가슴사진|노출사진|ㅅㅅ하)/ },
  { why: '광고·홍보', re: /(대출문의|대출상담|무직자대출|급전|토토사이트|카지노사이트|바카라|슬롯사이트|리딩방|코인추천|주식리딩|수익보장|재택알바|부업모집|구매링크|할인코드|홍보합니다|광고문의)/ },
  { why: '연락처나 개인 연락 유도', re: /(카톡아이디|카톡id|카톡주세요|카톡해요|카톡줘|오픈채팅|오픈톡|openkakao|텔레그램|telegram|라인아이디|인스타아이디|인스타dm|디엠주세요|디엠줘|dm주세요|연락주세요|번호알려|번호줄래|따로연락|만나서얘기|만나서이야기)/ },
  { why: '링크', re: /(https?:|www|\.com\b|\.kr\b|\.net\b|\.io\b|\.ly\b|bit\.ly)/ },
];
const PHONE = /01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/;
const CRISIS = /(자살|죽고싶|죽고 싶|극단적선택|극단적 선택|자해|목숨|사라지고싶|사라지고 싶|살기싫|살기 싫|끝내고싶|끝내고 싶)/;

function check(text) {
  const raw = String(text || '');
  if (PHONE.test(raw)) return '전화번호';
  const n = norm(raw);
  for (const r of RULES) if (r.re.test(n) || r.re.test(raw.toLowerCase())) return r.why;
  return null;
}

function send(res, code, obj) { res.status(code).json(obj); }

function isAdmin(req) {
  const want = process.env.ADMIN_PASSWORD || '';
  const got = String(req.headers['x-admin-key'] || '');
  if (want.length < 8 || !got) return false;
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

const publicView = p => ({ id: p.id, kind: p.kind, parent: p.parent || null, nick: p.nick, title: p.title || '', body: p.body, created: p.created, replies: p.replies || 0 });

module.exports = { redis, pipeline, cors, clientHash, check, CRISIS, send, isAdmin, publicView };
