// ============================================================================
// Shared client-side widgets injected into every Site Factory page:
//   1) Floating "Back to top" button (appears after 300px scroll).
//   2) Online-consultant chat widget (collapsed bubble + expanded card with
//      a niche-aware greeting and a callback form).
//
// Pure HTML + CSS + vanilla JS. Deterministic: consultant name and photo are
// passed in by the caller (first team member of the project) so each site has
// its own consultant.
// ============================================================================

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function avatarFallback(name: string): string {
  const n = encodeURIComponent((name || "Manager").trim()).slice(0, 60);
  return `https://ui-avatars.com/api/?name=${n}&size=160&background=random&format=png`;
}

export interface WidgetOptions {
  lang: "ru" | "en" | string;
  accent: string;            // CSS color, e.g. "#0ea5e9"
  consultantName: string;
  consultantPhoto?: string;  // URL; fallback to ui-avatars
  siteName: string;
  topic: string;
}

/** CSS rules for both widgets. Scoped via .sf-* prefixes. */
export function widgetsCss(): string {
  return `
/* --- Site Factory floating widgets --- */
.sf-totop{position:fixed;left:24px;bottom:24px;width:44px;height:44px;border-radius:50%;background:var(--accent,#2563eb);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 25px -8px rgba(0,0,0,.35);opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s ease,transform .25s ease;z-index:9998;font-size:0;line-height:0}
.sf-totop svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.sf-totop.sf-show{opacity:1;transform:translateY(0);pointer-events:auto}
.sf-totop:hover{transform:translateY(-2px)}

.sf-chat{position:fixed;right:24px;bottom:24px;z-index:9999;font-family:inherit}
.sf-chat-toggle{width:56px;height:56px;border-radius:50%;background:var(--accent,#2563eb);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 12px 30px -8px rgba(0,0,0,.4);position:relative;transition:transform .2s ease}
.sf-chat-toggle:hover{transform:scale(1.06)}
.sf-chat-toggle svg{width:26px;height:26px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.sf-chat-toggle::before,.sf-chat-toggle::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--accent,#2563eb);opacity:.45;animation:sf-pulse 2s ease-out infinite;z-index:-1}
.sf-chat-toggle::after{animation-delay:1s}
@keyframes sf-pulse{0%{transform:scale(1);opacity:.55}100%{transform:scale(1.7);opacity:0}}

.sf-chat-bubble{position:absolute;right:72px;bottom:8px;background:#fff;color:#111827;padding:10px 14px;border-radius:14px 14px 4px 14px;box-shadow:0 12px 30px -10px rgba(0,0,0,.35);font-size:14px;max-width:240px;opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity .3s ease,transform .3s ease;white-space:normal;line-height:1.4}
.sf-chat-bubble.sf-show{opacity:1;transform:translateY(0)}

.sf-chat-panel{position:absolute;right:0;bottom:72px;width:320px;height:420px;background:#fff;border-radius:16px;box-shadow:0 30px 60px -15px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:opacity .25s ease,transform .25s ease}
.sf-chat.sf-open .sf-chat-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
.sf-chat.sf-open .sf-chat-toggle::before,.sf-chat.sf-open .sf-chat-toggle::after{display:none}
.sf-chat.sf-open .sf-chat-bubble{display:none}

.sf-chat-head{background:var(--accent,#2563eb);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:12px}
.sf-chat-head img{width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,.6);flex-shrink:0}
.sf-chat-head .sf-name{font-weight:700;font-size:14px;line-height:1.2;color:#fff}
.sf-chat-head .sf-status{font-size:12px;opacity:.85;display:flex;align-items:center;gap:6px;color:#fff;margin-top:2px}
.sf-chat-head .sf-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;box-shadow:0 0 0 3px rgba(34,197,94,.25)}
.sf-chat-close{margin-left:auto;background:transparent;border:none;color:#fff;cursor:pointer;font-size:22px;line-height:1;padding:4px;opacity:.85}
.sf-chat-close:hover{opacity:1}

.sf-chat-body{flex:1;overflow-y:auto;padding:14px;background:#f8fafc;display:flex;flex-direction:column;gap:10px}
.sf-msg{max-width:85%;padding:10px 12px;border-radius:14px;font-size:14px;line-height:1.45;color:#0f172a;background:#fff;border:1px solid #e2e8f0;align-self:flex-start;border-top-left-radius:4px;animation:sf-msg-in .3s ease}
.sf-msg-user{align-self:flex-end;background:var(--accent,#2563eb);color:#fff;border:none;border-radius:14px;border-top-right-radius:4px}
@keyframes sf-msg-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

.sf-callback-form{margin-top:6px;display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px}
.sf-callback-form input{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit;color:#0f172a;background:#fff}
.sf-callback-form input:focus{outline:2px solid var(--accent,#2563eb);outline-offset:1px;border-color:var(--accent,#2563eb)}
.sf-callback-form button{padding:10px 14px;border:none;border-radius:8px;background:var(--accent,#2563eb);color:#fff;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit}
.sf-callback-form button:hover{filter:brightness(.95)}

.sf-chat-foot{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e2e8f0;background:#fff}
.sf-chat-foot input{flex:1;padding:9px 12px;border:1px solid #cbd5e1;border-radius:20px;font-size:14px;font-family:inherit;background:#fff;color:#0f172a}
.sf-chat-foot input:focus{outline:2px solid var(--accent,#2563eb);outline-offset:1px;border-color:var(--accent,#2563eb)}
.sf-chat-foot button{width:36px;height:36px;border-radius:50%;border:none;background:var(--accent,#2563eb);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sf-chat-foot button svg{width:16px;height:16px;stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}

@media(max-width:520px){
  .sf-chat-panel{width:calc(100vw - 32px);right:-8px;height:70vh}
  .sf-totop{left:16px;bottom:16px;width:40px;height:40px}
  .sf-chat{right:16px;bottom:16px}
}
`;
}

/** HTML + JS for both widgets. */
export function widgetsHtml(opts: WidgetOptions): string {
  const isRu = String(opts.lang || "").toLowerCase().startsWith("ru");
  const photo = opts.consultantPhoto && /^https?:\/\//.test(opts.consultantPhoto)
    ? opts.consultantPhoto
    : avatarFallback(opts.consultantName);
  const greet = isRu
    ? `Здравствуйте! Я ${opts.consultantName}, консультант ${opts.siteName}. Готов ответить на ваши вопросы по теме «${opts.topic}». Как могу помочь?`
    : `Hi! I am ${opts.consultantName}, consultant at ${opts.siteName}. Happy to answer any questions about ${opts.topic}. How can I help?`;
  const bubble = isRu ? "Здравствуйте! Чем могу помочь? 👋" : "Hi! How can I help you? 👋";
  const placeholderMsg = isRu ? "Напишите сообщение..." : "Type a message...";
  const thanksMsg = isRu
    ? "Спасибо! Мы свяжемся с вами в течение 15 минут."
    : "Thanks! We will contact you within 15 minutes.";
  const namePh = isRu ? "Ваше имя" : "Your name";
  const phonePh = isRu ? "Телефон" : "Phone";
  const callbackBtn = isRu ? "Перезвоните мне" : "Call me back";
  const sentMsg = isRu ? "Заявка отправлена. Спасибо!" : "Request sent. Thank you!";
  const labelOnline = isRu ? "Онлайн" : "Online";
  const labelTop = isRu ? "Наверх" : "Back to top";
  const labelChat = isRu ? "Открыть чат" : "Open chat";

  // All literals used in the JS are already plain strings (no special chars
  // that would break the script tag). We avoid template literals inside the
  // injected JS so the surrounding template literal does not collide.
  const js = `
(function(){
  var btn=document.getElementById('sfTop');
  if(btn){
    var onScroll=function(){ if(window.scrollY>300){btn.classList.add('sf-show');}else{btn.classList.remove('sf-show');} };
    window.addEventListener('scroll',onScroll,{passive:true}); onScroll();
    btn.addEventListener('click',function(){ window.scrollTo({top:0,behavior:'smooth'}); });
  }
  var chat=document.getElementById('sfChat'); if(!chat) return;
  var toggle=chat.querySelector('.sf-chat-toggle');
  var closeBtn=chat.querySelector('.sf-chat-close');
  var bubble=chat.querySelector('.sf-chat-bubble');
  var body=chat.querySelector('.sf-chat-body');
  var foot=chat.querySelector('.sf-chat-foot');
  var input=foot.querySelector('input');
  var open=function(){ chat.classList.add('sf-open'); };
  var close=function(){ chat.classList.remove('sf-open'); };
  toggle.addEventListener('click',function(){ if(chat.classList.contains('sf-open')){close();}else{open();} });
  if(closeBtn){ closeBtn.addEventListener('click',close); }
  // Auto bubble after 5s, hide after another 5s.
  setTimeout(function(){ if(!chat.classList.contains('sf-open')&&bubble){ bubble.classList.add('sf-show'); setTimeout(function(){ bubble.classList.remove('sf-show'); },5000);} },5000);
  if(bubble){ bubble.addEventListener('click',open); }

  var sentForm=false;
  var addMsg=function(text,mine){ var d=document.createElement('div'); d.className='sf-msg'+(mine?' sf-msg-user':''); d.textContent=text; body.appendChild(d); body.scrollTop=body.scrollHeight; return d; };
  var showCallback=function(){
    if(sentForm) return; sentForm=true;
    addMsg(${JSON.stringify(thanksMsg)},false);
    var form=document.createElement('form');
    form.className='sf-callback-form';
    form.innerHTML='<input type="text" name="name" placeholder="'+${JSON.stringify(namePh)}.replace(/"/g,'&quot;')+'" required maxlength="80">'+
                   '<input type="tel" name="phone" placeholder="'+${JSON.stringify(phonePh)}.replace(/"/g,'&quot;')+'" required maxlength="32" pattern="[+()\\\\d\\\\s-]{6,}">'+
                   '<button type="submit">'+${JSON.stringify(callbackBtn)}.replace(/"/g,'&quot;')+'</button>';
    body.appendChild(form); body.scrollTop=body.scrollHeight;
    form.addEventListener('submit',function(e){
      e.preventDefault();
      form.remove();
      addMsg(${JSON.stringify(sentMsg)},false);
    });
  };

  var send=function(){
    var v=(input.value||'').trim(); if(!v) return;
    addMsg(v,true); input.value='';
    setTimeout(showCallback,500);
  };
  foot.querySelector('button').addEventListener('click',send);
  input.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); send(); } });
})();
`;

  return `
<button id="sfTop" class="sf-totop" type="button" aria-label="${esc(labelTop)}" title="${esc(labelTop)}">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
</button>
<div id="sfChat" class="sf-chat" role="complementary" aria-label="${esc(labelChat)}">
  <div class="sf-chat-bubble">${esc(bubble)}</div>
  <div class="sf-chat-panel" role="dialog" aria-label="${esc(opts.consultantName)}">
    <div class="sf-chat-head">
      <img src="${esc(photo)}" alt="${esc(opts.consultantName)}" loading="lazy" width="40" height="40">
      <div>
        <div class="sf-name">${esc(opts.consultantName)}</div>
        <div class="sf-status"><span class="sf-dot" aria-hidden="true"></span>${esc(labelOnline)}</div>
      </div>
      <button type="button" class="sf-chat-close" aria-label="${esc(isRu ? "Закрыть" : "Close")}">&times;</button>
    </div>
    <div class="sf-chat-body">
      <div class="sf-msg">${esc(greet)}</div>
    </div>
    <div class="sf-chat-foot">
      <input type="text" maxlength="500" placeholder="${esc(placeholderMsg)}" aria-label="${esc(placeholderMsg)}">
      <button type="button" aria-label="${esc(isRu ? "Отправить" : "Send")}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
  </div>
  <button type="button" class="sf-chat-toggle" aria-label="${esc(labelChat)}" title="${esc(labelChat)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.38 8.38 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/></svg>
  </button>
</div>
<script defer>${js}</script>`;
}