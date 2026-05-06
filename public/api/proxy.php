<?php
/**
 * Generic backend proxy for Beget hosting.
 * Routes REST/Auth/Functions requests through the site domain,
 * bypassing regional blocks for the upstream backend.
 */

// Disable any PHP output compression to prevent ERR_CONTENT_DECODING_FAILED
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
header('X-Accel-Buffering: no');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, accept, accept-profile, content-profile, prefer, range, range-unit');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// External URL proxy (Bukvarix и другие API)
if (isset($_GET['external_url'])) {
    $url = $_GET['external_url'];
    $allowed = [
        'api.bukvarix.com',
        'turgenev.ashmanov.com',
    ];
    $host = parse_url($url, PHP_URL_HOST);
    if (!in_array($host, $allowed)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Domain not allowed']);
        exit;
    }

    $method = $_SERVER['REQUEST_METHOD'];
    $body = file_get_contents('php://input');
    $headers = [];
    if (isset($_SERVER['CONTENT_TYPE'])) {
        $headers[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
    }

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($error) {
        http_response_code(502);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Curl error: ' . $error]);
        exit;
    }

    http_response_code($httpCode ?: 502);
    header('Content-Type: application/json');
    echo $response;
    exit;
}

$SUPABASE_URL = 'https://mwcejojlbqpolplshjgj.supabase.co';
$SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13Y2Vqb2psYnFwb2xwbHNoamdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwOTM5ODIsImV4cCI6MjA4OTY2OTk4Mn0.J9VPQi7CIudwmbXJw4vr8WjIrplVdNU5o5X06bliulU';
$ALLOWED_PREFIXES = ['/functions/v1/', '/rest/v1/', '/auth/v1/', '/storage/v1/'];

function respond_json($status, $payload) {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($payload);
    exit;
}

function get_request_headers_fallback() {
    if (function_exists('getallheaders')) {
        return getallheaders();
    }

    $headers = [];
    foreach ($_SERVER as $name => $value) {
        if (strpos($name, 'HTTP_') === 0) {
            $headerName = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
            $headers[$headerName] = $value;
        }
    }

    if (isset($_SERVER['CONTENT_TYPE'])) {
        $headers['Content-Type'] = $_SERVER['CONTENT_TYPE'];
    }

    if (isset($_SERVER['CONTENT_LENGTH'])) {
        $headers['Content-Length'] = $_SERVER['CONTENT_LENGTH'];
    }

    return $headers;
}

function starts_with_prefix($value, $prefix) {
    return substr($value, 0, strlen($prefix)) === $prefix;
}

$path = isset($_GET['path']) ? rawurldecode($_GET['path']) : '';

if ($path === '' && !empty($_GET['function'])) {
    $functionName = $_GET['function'];

    if (!preg_match('/^[A-Za-z0-9_-]+$/', $functionName)) {
        respond_json(400, ['error' => 'Invalid function name']);
    }

    $path = '/functions/v1/' . $functionName;
}

if ($path === '') {
    respond_json(400, ['error' => 'Missing backend path']);
}

if ($path[0] !== '/') {
    $path = '/' . ltrim($path, '/');
}

$isAllowedPath = false;
foreach ($ALLOWED_PREFIXES as $prefix) {
    if (starts_with_prefix($path, $prefix)) {
        $isAllowedPath = true;
        break;
    }
}

if (!$isAllowedPath) {
    respond_json(400, ['error' => 'Path is not allowed']);
}

$targetUrl = rtrim($SUPABASE_URL, '/') . $path;
$incomingHeaders = get_request_headers_fallback();
$forwardHeaders = [];
$ignoredRequestHeaders = [
    'host' => true,
    'content-length' => true,
    'accept-encoding' => true,
    'origin' => true,
    'referer' => true,
    'connection' => true,
];

$hasApiKey = false;
$hasAuthorization = false;

foreach ($incomingHeaders as $name => $value) {
    $normalizedName = strtolower($name);

    if (isset($ignoredRequestHeaders[$normalizedName])) {
        continue;
    }

    if ($normalizedName === 'apikey') {
        $hasApiKey = true;
    }

    if ($normalizedName === 'authorization') {
        $hasAuthorization = true;
    }

    $forwardHeaders[] = $name . ': ' . $value;
}

if (!$hasApiKey) {
    $forwardHeaders[] = 'apikey: ' . $SUPABASE_ANON_KEY;
}

if (!$hasAuthorization) {
    $forwardHeaders[] = 'Authorization: Bearer ' . $SUPABASE_ANON_KEY;
}

$method = $_SERVER['REQUEST_METHOD'];
$body = file_get_contents('php://input');
$responseHeaders = [];

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $forwardHeaders,
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_ENCODING       => '',
    CURLOPT_HEADERFUNCTION => function ($curl, $headerLine) use (&$responseHeaders) {
        $length = strlen($headerLine);
        $trimmedHeader = trim($headerLine);

        if ($trimmedHeader === '' || strpos($trimmedHeader, ':') === false) {
            return $length;
        }

        list($name, $value) = explode(':', $trimmedHeader, 2);
        $normalizedName = strtolower(trim($name));
        $ignoredResponseHeaders = [
            'transfer-encoding' => true,
            'content-length' => true,
            'content-encoding' => true,
            'connection' => true,
            'keep-alive' => true,
            'server' => true,
            'date' => true,
            'access-control-allow-origin' => true,
            'access-control-allow-headers' => true,
            'access-control-allow-methods' => true,
        ];

        if (!isset($ignoredResponseHeaders[$normalizedName])) {
            $responseHeaders[] = [trim($name), trim($value)];
        }

        return $length;
    },
]);

if ($method !== 'GET' && $method !== 'HEAD' && $body !== false && $body !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    respond_json(502, ['error' => 'Proxy error: ' . $error]);
}

$hasContentType = false;
http_response_code($httpCode ?: 502);

foreach ($responseHeaders as $headerPair) {
    if (strtolower($headerPair[0]) === 'content-type') {
        $hasContentType = true;
    }

    header($headerPair[0] . ': ' . $headerPair[1], false);
}

if (!$hasContentType) {
    header('Content-Type: application/json');
}

echo $response;
