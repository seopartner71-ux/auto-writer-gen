<?php
/**
 * Edge Functions Proxy for Beget hosting
 * Routes requests from seo-modul.pro/api/proxy.php?function=NAME
 * to Supabase Edge Functions, bypassing geo-blocks.
 */

// CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ── Config ─────────────────────────────────────────────────────────
$SUPABASE_URL = 'https://mwcejojlbqpolplshjgj.supabase.co';
$SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Y2Vqb2psYnFwb2xwbHNoamdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTM5ODIsImV4cCI6MjA4OTY2OTk4Mn0.J9VPQi7CIudwmbXJw4vr8WjIrplVdNU5o5X06bliulU';

// Whitelist of allowed function names
$ALLOWED_FUNCTIONS = [
    'smart-research',
    'generate-article',
    'generate-outline',
    'generate-title',
    'generate-schema',
    'generate-geo-plan',
    'generate-pro-image',
    'check-balance',
    'check-uniqueness',
    'analyze-style',
    'analyze-content-gaps',
    'deep-parse-competitors',
    'delete-content',
    'delete-user',
    'health-check',
    'metrica-stats',
    'process-queue',
    'process-wp-schedule',
    'publish-ghost',
    'publish-telegraph',
    'radar-check',
    'run-scheduled',
    'submit-indexing',
    'wordpress-proxy',
    'telegram-notify',
    'bulk-generate',
    'encrypt-field',
];

// ── Validate ───────────────────────────────────────────────────────
$functionName = $_GET['function'] ?? '';
if (!$functionName || !in_array($functionName, $ALLOWED_FUNCTIONS, true)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid or missing function name']);
    exit;
}

// ── Build upstream request ─────────────────────────────────────────
$targetUrl = $SUPABASE_URL . '/functions/v1/' . $functionName;

$headers = [];
$headers[] = 'Content-Type: application/json';
$headers[] = 'apikey: ' . $SUPABASE_ANON_KEY;

// Forward Authorization header
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if ($authHeader) {
    $headers[] = 'Authorization: ' . $authHeader;
} else {
    $headers[] = 'Authorization: Bearer ' . $SUPABASE_ANON_KEY;
}

// Forward x-client-info if present
if (!empty($_SERVER['HTTP_X_CLIENT_INFO'])) {
    $headers[] = 'x-client-info: ' . $_SERVER['HTTP_X_CLIENT_INFO'];
}

$body = file_get_contents('php://input');

// ── cURL request ───────────────────────────────────────────────────
$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $body,
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error    = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Proxy error: ' . $error]);
    exit;
}

// ── Return upstream response ───────────────────────────────────────
http_response_code($httpCode);
header('Content-Type: application/json');
echo $response;
