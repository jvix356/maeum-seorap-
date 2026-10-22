// 비밀번호·확인키 입력칸 옆에 눈 모양 버튼을 붙여요. 누르면 눈을 뜨고 글자가 보이고, 다시 누르면 눈을 감고 가려져요.
// 입력값은 어디에도 보내거나 저장하지 않아요. 페이지를 떠나거나 제출하면 다시 가려져요.
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function icon(open) {
    var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    function p(d) { var e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); s.appendChild(e); }
    if (open) { p('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z'); var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '3'); s.appendChild(c); }
    else { p('M2 12s3.5 5 10 5 10-5 10-5'); p('M4.5 14.5 3 17'); p('M9 16.5 8.4 19.3'); p('M15 16.5l.6 2.8'); p('M19.5 14.5 21 17'); }
    return s;
  }
  function attach(input) {
    if (input.__eye) return; input.__eye = true;
    var wrap = document.createElement('span');
    wrap.style.position = 'relative'; wrap.style.display = 'block'; wrap.style.width = '100%';
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    input.style.paddingRight = '44px'; input.style.width = '100%'; input.style.boxSizing = 'border-box';
    var b = document.createElement('button'); b.type = 'button';
    b.style.position = 'absolute'; b.style.right = '4px'; b.style.top = '50%'; b.style.transform = 'translateY(-50%)';
    b.style.border = '0'; b.style.background = 'transparent'; b.style.padding = '6px'; b.style.cursor = 'pointer'; b.style.color = 'inherit'; b.style.lineHeight = '0'; b.style.minHeight = '0';
    function set(show) {
      input.type = show ? 'text' : 'password';
      b.replaceChildren(icon(show));
      b.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
      b.setAttribute('aria-pressed', String(show)); b.title = show ? '숨기기' : '보기';
    }
    b.addEventListener('click', function () { set(input.type === 'password'); input.focus(); });
    if (input.form) input.form.addEventListener('submit', function () { set(false); });
    window.addEventListener('pagehide', function () { set(false); });
    set(false); wrap.appendChild(b);
  }
  function scan() { Array.prototype.forEach.call(document.querySelectorAll('input[type="password"]'), attach); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
  window.attachPwEye = scan;
})();
