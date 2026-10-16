// Collector code shown to the admin for installation on a client site.
// The key is inserted only at display time and never stored in plain form.
const ENDPOINT = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/monitor-ingest`;

export const INGEST_ENDPOINT = ENDPOINT;

export function phpCollector(key: string): string {
  return `<?php
// SEO-Модуль AI Traffic Monitor - сборщик. Подключить первой строкой index.php:
// require_once __DIR__ . '/ai-monitor.php';
// Отправляет только обращения известных ботов и переходы из ИИ-чатов. Ошибки не влияют на сайт.
register_shutdown_function(function () {
  $ua  = $_SERVER['HTTP_USER_AGENT'] ?? '';
  $ref = $_SERVER['HTTP_REFERER'] ?? '';
  $uri = $_SERVER['REQUEST_URI'] ?? '/';
  $bot = '/gptbot|oai-searchbot|chatgpt-user|claudebot|claude-searchbot|claude-user|perplexity|google-extended|googlebot|bingbot|yandexbot|applebot/i';
  $ai  = '/chatgpt\\.com|chat\\.openai\\.com|perplexity\\.ai|claude\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com|deepseek\\.com|alice\\.yandex|utm_source=(chatgpt|perplexity|claude|gemini|copilot|deepseek)/i';
  if (!preg_match($bot, $ua) && !preg_match($ai, $ref . ' ' . $uri)) return;
  if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $hit = [
    'url' => $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '') . $uri,
    'status' => http_response_code() ?: 200,
    'ua' => substr($ua, 0, 1000), 'referrer' => substr($ref, 0, 2000),
    'ip' => $_SERVER['REMOTE_ADDR'] ?? '', 'ts' => gmdate('c'),
  ];
  $ch = curl_init('${ENDPOINT}');
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 2,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-monitor-key: ${key}'],
    CURLOPT_POSTFIELDS => json_encode(['method' => 'php', 'hits' => [$hit]]),
  ]);
  @curl_exec($ch); @curl_close($ch);
});
`;
}

export function logShipper(key: string): string {
  return `#!/usr/bin/env python3
# SEO-Модуль AI Traffic Monitor - отправка access-логов nginx/apache (combined).
# Cron каждые 5 минут:  */5 * * * * /usr/bin/python3 /opt/ai-monitor/ship.py
import json, re, os, urllib.request
from datetime import datetime
LOG = "/var/log/nginx/access.log"; STATE = "/opt/ai-monitor/offset"
HOST = "https://example.ru"  # домен сайта клиента
BOT = re.compile(r"gptbot|oai-searchbot|chatgpt-user|claudebot|claude-searchbot|claude-user|perplexity|google-extended|googlebot|bingbot|yandexbot|applebot", re.I)
AI = re.compile(r"chatgpt\\.com|chat\\.openai\\.com|perplexity\\.ai|claude\\.ai|gemini\\.google\\.com|copilot\\.microsoft\\.com|deepseek\\.com|alice\\.yandex|utm_source=(chatgpt|perplexity|claude|gemini|copilot|deepseek)", re.I)
LINE = re.compile(r'(\\S+) \\S+ \\S+ \\[([^\\]]+)\\] "\\S+ (\\S+) [^"]*" (\\d{3}) \\S+ "([^"]*)" "([^"]*)"')
off = int(open(STATE).read()) if os.path.exists(STATE) else 0
if os.path.getsize(LOG) < off: off = 0
hits = []
with open(LOG, errors="ignore") as f:
    f.seek(off)
    for line in f:
        m = LINE.match(line)
        if not m: continue
        ip, t, path, st, ref, ua = m.groups()
        if not (BOT.search(ua) or AI.search(ref + " " + path)): continue
        ts = datetime.strptime(t, "%d/%b/%Y:%H:%M:%S %z").isoformat()
        hits.append({"url": HOST + path, "status": int(st), "ua": ua[:1000], "referrer": ref[:2000], "ip": ip, "ts": ts})
    off = f.tell()
for i in range(0, len(hits), 500):
    req = urllib.request.Request("${ENDPOINT}", data=json.dumps({"method": "access_log", "hits": hits[i:i+500]}).encode(),
        headers={"Content-Type": "application/json", "x-monitor-key": "${key}"})
    urllib.request.urlopen(req, timeout=20).read()
open(STATE, "w").write(str(off))
`;
}
