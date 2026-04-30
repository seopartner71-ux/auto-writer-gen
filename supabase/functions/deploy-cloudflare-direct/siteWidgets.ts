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

export type TotopPosition = "left-bottom" | "right-bottom" | "left-top" | "right-top" | "hidden";

export interface WidgetOptions {
  lang: "ru" | "en" | string;
  accent: string;            // CSS color, e.g. "#0ea5e9"
  consultantName: string;
  consultantPhoto?: string;  // URL; fallback to ui-avatars
  siteName: string;
  topic: string;
  /** Position of the floating "Back to top" button. Defaults to left-bottom
   *  so it never overlaps the right-side chat. Set to "hidden" to remove it. */
  totopPosition?: TotopPosition;
  /** Stable seed for JS identifier obfuscation (defaults to siteName). */
  seed?: string;
}

// --- Deterministic identifier generator (FNV-1a + xorshift32) ---------------
function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const ID_ALPHA = "abcdefghijklmnopqrstuvwxyz";
const ID_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Deterministic JS identifier (first char alpha, rest alphanumeric). */
function obfId(seed: string, label: string, len: number): string {
  const h = fnv1a(seed + ":" + label);
  let n = h;
  let out = ID_ALPHA[n % ID_ALPHA.length];
  n = (n / ID_ALPHA.length) >>> 0;
  for (let i = 1; i < len; i++) {
    out += ID_ALNUM[n % ID_ALNUM.length];
    n = (n / ID_ALNUM.length) >>> 0;
    if (n === 0) n = fnv1a(out);
  }
  return out;
}

/** Integer in [min, max] from seed. */
function intFromSeed(seed: string, label: string, min: number, max: number): number {
  const h = fnv1a(seed + ":" + label);
  return min + (h % Math.max(1, max - min + 1));
}

/** CSS rules for both widgets. Scoped via .sf-* prefixes. */
export function widgetsCss(totopPosition: TotopPosition = "left-bottom"): string {
  // Resolve fixed-position anchors per requested corner. Mobile uses tighter
  // 16px insets; chat always sits in the right-bottom corner so a right-side
  // top-button needs to clear it.
  let topPos = "left:24px;bottom:24px";
  let topPosMobile = "left:16px;bottom:16px";
  if (totopPosition === "right-bottom") {
    topPos = "right:24px;bottom:94px"; // above 56px chat + 14px gap
    topPosMobile = "right:16px;bottom:84px";
  } else if (totopPosition === "left-top") {
    topPos = "left:24px;top:24px";
    topPosMobile = "left:16px;top:16px";
  } else if (totopPosition === "right-top") {
    topPos = "right:24px;top:24px";
    topPosMobile = "right:16px;top:16px";
  } else if (totopPosition === "hidden") {
    // CSS still emitted but the button element is omitted from HTML.
    topPos = "left:-9999px;bottom:-9999px";
    topPosMobile = topPos;
  }
  return `
/* --- Site Factory floating widgets --- */
.sf-totop{position:fixed;${topPos};width:44px;height:44px;border-radius:50%;background:var(--accent,#2563eb);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 25px -8px rgba(0,0,0,.35);opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s ease,transform .25s ease;z-index:9998;font-size:0;line-height:0}
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
.sf-chat-panel{transform:translateY(24px) scale(.98)}
.sf-chat.sf-open .sf-chat-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;transition:opacity .3s ease,transform .3s cubic-bezier(.2,.8,.2,1)}
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

/* Typing indicator (3 pulsing dots) */
.sf-typing{align-self:flex-start;background:#fff;border:1px solid #e2e8f0;border-radius:14px;border-top-left-radius:4px;padding:12px 14px;display:inline-flex;gap:4px;align-items:center;animation:sf-msg-in .25s ease}
.sf-typing span{width:7px;height:7px;border-radius:50%;background:#94a3b8;display:inline-block;animation:sf-typing 1.2s ease-in-out infinite}
.sf-typing span:nth-child(2){animation-delay:.2s}
.sf-typing span:nth-child(3){animation-delay:.4s}
@keyframes sf-typing{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}

/* Typewriter caret */
.sf-msg .sf-caret{display:inline-block;width:7px;background:currentColor;margin-left:1px;animation:sf-caret-blink .9s steps(2,start) infinite;opacity:.7}
@keyframes sf-caret-blink{50%{opacity:0}}

/* Quick-reply chips */
.sf-quick{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start;max-width:100%;animation:sf-msg-in .3s ease}
.sf-quick button{background:#fff;border:1px solid var(--accent,#2563eb);color:var(--accent,#2563eb);padding:7px 12px;border-radius:18px;font-size:13px;font-family:inherit;cursor:pointer;line-height:1;transition:background .15s ease,color .15s ease}
.sf-quick button:hover{background:var(--accent,#2563eb);color:#fff}

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
  .sf-totop{${topPosMobile};width:40px;height:40px}
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
  const bubble = isRu ? "Здравствуйте! Чем могу помочь? 👋" : "Hi! How can I help you? 👋";
  const placeholderMsg = isRu ? "Напишите сообщение..." : "Type a message...";
  const namePh = isRu ? "Ваше имя" : "Your name";
  const phonePh = isRu ? "Телефон" : "Phone";
  const labelOnline = isRu ? "Онлайн" : "Online";
  const labelTop = isRu ? "Наверх" : "Back to top";
  const labelChat = isRu ? "Открыть чат" : "Open chat";
  const totopPosition: TotopPosition = (opts.totopPosition || "left-bottom");
  const showTotop = totopPosition !== "hidden";

  // Localized chat scenario strings (kept on the JS side as a JSON config so
  // the surrounding template literal stays simple and free of escapes).
  const I18N = isRu ? {
    hello: "Здравствуйте! 👋",
    intro: `Я ${opts.consultantName}, помогу вам с вопросами по теме «${opts.topic}». Что вас интересует?`,
    qPrice: "Узнать цену",
    qAsk: "Задать вопрос",
    qCall: "Перезвоните мне",
    rPrice: "Стоимость зависит от объёма работ. Оставьте номер - рассчитаем бесплатно!",
    rAsk: "Напишите ваш вопрос ниже - постараюсь ответить максимально подробно.",
    rCall: "Конечно! Оставьте имя и телефон - перезвоню в удобное время.",
    sentCall: "Отлично! Перезвоним в течение 15 минут ⏱",
    sentPrice: "Принято! Подготовим расчёт и свяжемся в течение 15 минут ⏱",
    sentAsk: "Спасибо за вопрос! Отвечу в ближайшее время.",
    submitPrice: "Отправить",
    submitCall: "Жду звонка",
  } : {
    hello: "Hello! 👋",
    intro: `I am ${opts.consultantName} and I will help with your ${opts.topic} questions. What are you looking for?`,
    qPrice: "Get a quote",
    qAsk: "Ask a question",
    qCall: "Call me back",
    rPrice: "Pricing depends on the scope. Leave your number and we will prepare a free quote!",
    rAsk: "Type your question below and I will reply with details.",
    rCall: "Sure! Leave your name and phone and we will call you back.",
    sentCall: "Great! We will call you back within 15 minutes ⏱",
    sentPrice: "Got it! We will prepare a quote and contact you within 15 minutes ⏱",
    sentAsk: "Thanks for your question! I will reply shortly.",
    submitPrice: "Submit",
    submitCall: "Call me",
  };

  // All literals used in the JS are already plain strings (no special chars
  // that would break the script tag). We avoid template literals inside the
  // injected JS so the surrounding template literal does not collide.
  const js = `
(function(){
  var I=${JSON.stringify(I18N)};
  var PH={name:${JSON.stringify(namePh)},phone:${JSON.stringify(phonePh)}};

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

  // ---- Soft notification beep (Web Audio). Silent if browser blocks
  // autoplay; first user interaction (click) creates the AudioContext so
  // subsequent beeps are allowed.
  var audioCtx=null, soundOn=true;
  var beep=function(){ if(!soundOn||!audioCtx) return;
    try{
      var o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.type='sine'; o.frequency.value=880;
      g.gain.value=0.0001;
      o.connect(g); g.connect(audioCtx.destination);
      var t=audioCtx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.06,t+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.18);
      o.start(t); o.stop(t+0.2);
    }catch(e){}
  };
  var initAudio=function(){ if(audioCtx) return;
    try{ var Ctx=window.AudioContext||window.webkitAudioContext; if(Ctx) audioCtx=new Ctx(); }catch(e){}
  };

  var started=false;
  var open=function(){
    chat.classList.add('sf-open');
    initAudio(); beep();
    if(!started){ started=true; setTimeout(runIntro,250); }
  };
  var close=function(){ chat.classList.remove('sf-open'); };
  toggle.addEventListener('click',function(){ if(chat.classList.contains('sf-open')){close();}else{open();} });
  if(closeBtn){ closeBtn.addEventListener('click',close); }
  // Auto bubble after 5s, hide after another 5s.
  setTimeout(function(){ if(!chat.classList.contains('sf-open')&&bubble){ bubble.classList.add('sf-show'); setTimeout(function(){ bubble.classList.remove('sf-show'); },5000);} },5000);
  if(bubble){ bubble.addEventListener('click',open); }

  var scrollDown=function(){ body.scrollTop=body.scrollHeight; };

  // Append a user message bubble.
  var addUser=function(text){
    var d=document.createElement('div'); d.className='sf-msg sf-msg-user';
    d.textContent=text; body.appendChild(d); scrollDown(); return d;
  };

  // Show the typing indicator and resolve after a delay. Returns a Promise.
  var showTyping=function(ms){
    return new Promise(function(res){
      var t=document.createElement('div');
      t.className='sf-typing';
      t.innerHTML='<span></span><span></span><span></span>';
      body.appendChild(t); scrollDown();
      setTimeout(function(){ t.remove(); res(); }, ms||1200);
    });
  };

  // Type out a consultant message character by character. Returns a Promise.
  var typeMsg=function(text,perChar){
    return new Promise(function(res){
      var d=document.createElement('div'); d.className='sf-msg';
      var span=document.createElement('span');
      var caret=document.createElement('i'); caret.className='sf-caret'; caret.textContent='\\u00A0';
      d.appendChild(span); d.appendChild(caret);
      body.appendChild(d); scrollDown();
      var i=0, step=perChar||18;
      var tick=function(){
        if(i<text.length){
          span.textContent+=text.charAt(i++);
          scrollDown();
          setTimeout(tick,step);
        } else {
          caret.remove(); beep(); res();
        }
      };
      tick();
    });
  };

  // Render quick-reply chips. Returns a Promise that resolves with the
  // chosen action key once the user clicks any chip.
  var quickReplies=function(items){
    return new Promise(function(res){
      var w=document.createElement('div'); w.className='sf-quick';
      items.forEach(function(it){
        var b=document.createElement('button'); b.type='button'; b.textContent=it.label;
        b.addEventListener('click',function(){
          addUser(it.label);
          w.remove();
          res(it.key);
        });
        w.appendChild(b);
      });
      body.appendChild(w); scrollDown();
    });
  };

  // Render a lead form (subset of: name, phone). Returns a Promise resolved
  // with the submitted values. Form is removed on submit. Submission is
  // local-only — same UX as every other form on these PBN sites (no backend).
  var leadForm=function(fields,btnLabel){
    return new Promise(function(res){
      var f=document.createElement('form'); f.className='sf-callback-form';
      var html='';
      if(fields.indexOf('name')>=0){
        html+='<input type="text" name="name" placeholder="'+PH.name+'" required maxlength="80" autocomplete="name">';
      }
      if(fields.indexOf('phone')>=0){
        html+='<input type="tel" name="phone" placeholder="'+PH.phone+'" required maxlength="32" pattern="[+()\\\\d\\\\s-]{6,}" autocomplete="tel">';
      }
      html+='<button type="submit">'+btnLabel+'</button>';
      f.innerHTML=html;
      body.appendChild(f); scrollDown();
      var first=f.querySelector('input'); if(first){ try{ first.focus(); }catch(e){} }
      f.addEventListener('submit',function(e){
        e.preventDefault();
        var data={};
        Array.prototype.forEach.call(f.querySelectorAll('input'),function(el){ data[el.name]=el.value; });
        f.remove(); res(data);
      });
    });
  };

  // Wait helper.
  var wait=function(ms){ return new Promise(function(r){ setTimeout(r,ms); }); };

  // Open-state intro: typing dots -> hello -> typing dots -> intro -> chips.
  var runIntro=function(){
    showTyping(1500)
      .then(function(){ return typeMsg(I.hello,40); })
      .then(function(){ return wait(800); })
      .then(function(){ return showTyping(1200); })
      .then(function(){ return typeMsg(I.intro,18); })
      .then(function(){ return wait(300); })
      .then(function(){ return quickReplies([
        {key:'price',label:I.qPrice},
        {key:'ask',  label:I.qAsk},
        {key:'call', label:I.qCall},
      ]); })
      .then(handleQuick);
  };

  var handleQuick=function(key){
    if(key==='price'){
      return showTyping(1000)
        .then(function(){ return typeMsg(I.rPrice,18); })
        .then(function(){ return leadForm(['phone'],I.submitPrice); })
        .then(function(){ return showTyping(900); })
        .then(function(){ return typeMsg(I.sentPrice,18); });
    }
    if(key==='call'){
      return showTyping(1000)
        .then(function(){ return typeMsg(I.rCall,18); })
        .then(function(){ return leadForm(['name','phone'],I.submitCall); })
        .then(function(){ return showTyping(900); })
        .then(function(){ return typeMsg(I.sentCall,18); });
    }
    // 'ask' (or fallback) — open free-form input.
    return showTyping(1000)
      .then(function(){ return typeMsg(I.rAsk,18); })
      .then(function(){ try{ input.focus(); }catch(e){} });
  };

  // Free-form input from the bottom of the chat.
  var sentLead=false;
  var send=function(){
    var v=(input.value||'').trim(); if(!v) return;
    addUser(v); input.value='';
    if(sentLead) return;
    sentLead=true;
    showTyping(900)
      .then(function(){ return typeMsg(I.sentAsk,18); })
      .then(function(){ return wait(400); })
      .then(function(){ return typeMsg(I.rCall,18); })
      .then(function(){ return leadForm(['name','phone'],I.submitCall); })
      .then(function(){ return showTyping(900); })
      .then(function(){ return typeMsg(I.sentCall,18); });
  };
  foot.querySelector('button').addEventListener('click',send);
  input.addEventListener('keydown',function(e){ if(e.key==='Enter'){ e.preventDefault(); send(); } });
})();
`;

  return `
${showTotop ? `<button id="sfTop" class="sf-totop" type="button" aria-label="${esc(labelTop)}" title="${esc(labelTop)}">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
</button>` : ""}
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
    <div class="sf-chat-body"></div>
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