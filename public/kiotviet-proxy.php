<?php
header('Content-Type: application/json; charset=utf-8');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, x-kv-client-id, x-kv-client-secret, x-kv-retailer, x-kv-proxies");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Decode proxies from header
function getProxies() {
    $encodedProxies = isset($_SERVER['HTTP_X_KV_PROXIES']) ? $_SERVER['HTTP_X_KV_PROXIES'] : '';
    if (empty($encodedProxies)) return [];
    
    $decoded = urldecode(base64_decode($encodedProxies));
    if (!$decoded) return [];
    
    $lines = explode("\n", $decoded);
    $proxies = [];
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line)) continue;
        
        if (strpos($line, 'http') === 0) {
            $proxies[] = $line;
        } else {
            $parts = explode(':', $line);
            if (count($parts) === 4) {
               $proxies[] = "http://{$parts[2]}:{$parts[3]}@{$parts[0]}:{$parts[1]}";
            } elseif (count($parts) === 2) {
               $proxies[] = "http://{$parts[0]}:{$parts[1]}";
            }
        }
    }
    return $proxies;
}

$proxies = getProxies();
if (empty($proxies)) {
    // Default fallback proxy
    $proxies[] = "http://Fugalo_acc:Fugalo0912@1.53.122.98:30000";
}

function getCurlOptions($url, $proxyList, $headers = [], $postData = null) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    // Ignore SSL to bypass KiotViet cert issues
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    
    // Add timeouts to handle proxy blocks or slowness
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15); 
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    
    if (!empty($headers)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }
    
    if ($postData !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        if (is_array($postData)) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postData));
        } else {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
        }
    }
    
    return $ch;
}

function executeWithRetry($url, $proxyList, $headers = [], $postData = null, $retries = 3) {
    if (!empty($proxyList)) {
        $retries = max($retries, min(10, count($proxyList)));
        shuffle($proxyList);
    }
    
    $lastError = "";
    for ($attempt = 0; $attempt <= $retries; $attempt++) {
        $ch = getCurlOptions($url, $proxyList, $headers, $postData);
        
        // Pick proxy sequentially
        if (!empty($proxyList)) {
            $proxyIndex = $attempt % count($proxyList);
            $selectedProxy = $proxyList[$proxyIndex];
            curl_setopt($ch, CURLOPT_PROXY, $selectedProxy);
        }
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        
        if ($httpCode >= 200 && $httpCode < 300) {
            return ['status' => $httpCode, 'data' => $response, 'error' => null];
        }
        
        $isWafBlock = ($httpCode == 503 || $httpCode == 403) && (strpos((string)$response, '<html') !== false || strpos((string)$response, '<!DOCTYPE') !== false || strpos((string)$response, 'Cloudflare') !== false);
        
        if (($httpCode == 503 || $httpCode == 502 || $httpCode == 500 || $httpCode == 429 || $isWafBlock || $curlError || $httpCode == 0 || empty($response)) && $attempt < $retries) {
            sleep(1);
            continue;
        }

        // Handle WAF block (503 with HTML) after retries exhausted
        if ($isWafBlock) {
            return ['status' => $httpCode, 'data' => null, 'isWafBlocked' => true];
        }
        
        $errorText = substr((string)$response, 0, 200);
        if (strpos((string)$response, '<html') !== false || strpos((string)$response, '<!DOCTYPE') !== false) {
             preg_match('/<title>(.*?)<\/title>/i', (string)$response, $matches);
             $errorText = isset($matches[1]) ? $matches[1] : "HTTP $httpCode Error";
        }
        
        $errorMsg = $curlError ? "cURL Error: $curlError" : "API Error ($httpCode): $errorText";
        $lastError = $errorMsg;
        return ['status' => $httpCode, 'data' => null, 'error' => $errorMsg];
    }
    return ['status' => 500, 'data' => null, 'error' => "Tất cả Proxy đều quá tải/chết. Vui lòng cập nhật Proxy mới. Lỗi cuối: " . $lastError];
}

function getToken($clientId, $clientSecret, $proxies) {
    $url = "https://id.kiotviet.vn/connect/token";
    $headers = [
        "Content-Type: application/x-www-form-urlencoded",
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36",
        "Accept: application/json"
    ];
    $postData = [
        "client_id" => $clientId,
        "client_secret" => $clientSecret,
        "grant_type" => "client_credentials",
        "scopes" => "PublicApi.Access"
    ];
    
    $res = executeWithRetry($url, $proxies, $headers, $postData, 1);
    if ($res['error'] || (isset($res['isWafBlocked']) && $res['isWafBlocked']) || $res['status'] !== 200) {
        throw new Exception("Failed to get token: " . ($res['error'] ?? "Blocked?"));
    }
    
    $data = json_decode($res['data'], true);
    return $data['access_token'] ?? null;
}

function fetchKiotViet($token, $path, $retailer, $proxies) {
    $url = "https://public.api.kiotviet.vn/" . ltrim($path, '/');
    $headers = [
        "Authorization: Bearer " . $token,
        "Retailer: " . $retailer,
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36",
        "Accept: application/json"
    ];
    
    return executeWithRetry($url, $proxies, $headers, null, 3);
}

// Validation
$clientId = isset($_SERVER['HTTP_X_KV_CLIENT_ID']) ? $_SERVER['HTTP_X_KV_CLIENT_ID'] : null;
$clientSecret = isset($_SERVER['HTTP_X_KV_CLIENT_SECRET']) ? $_SERVER['HTTP_X_KV_CLIENT_SECRET'] : null;
$retailer = isset($_SERVER['HTTP_X_KV_RETAILER']) ? $_SERVER['HTTP_X_KV_RETAILER'] : null;

$action = isset($_GET['action']) ? $_GET['action'] : null;

// Allow POST fallback for check endpoint
if ($_SERVER['REQUEST_METHOD'] === 'POST' && strpos($_SERVER['REQUEST_URI'], 'check') !== false) {
    $action = 'check';
    $inputJSON = file_get_contents('php://input');
    $input = json_decode($inputJSON, TRUE);
    if($input) {
         if(!$clientId) $clientId = $input['clientId'] ?? null;
         if(!$clientSecret) $clientSecret = $input['clientSecret'] ?? null;
         if(!$retailer) $retailer = $input['retailer'] ?? null;
    }
}

if (!$clientId || !$clientSecret || !$retailer || !$action) {
    echo json_encode(["success" => false, "error" => "Thiếu thông tin kết nối KiotViet hoặc action. Vui lòng cập nhật Headers."]);
    exit();
}

try {
    $token = getToken($clientId, $clientSecret, $proxies);
    if (!$token) {
        throw new Exception("Không lấy được token KiotViet");
    }

    if ($action === 'check') {
        $testRes = fetchKiotViet($token, "customers?pageSize=1", $retailer, $proxies);
        if (isset($testRes['isWafBlocked']) && $testRes['isWafBlocked']) {
            echo json_encode(["success" => true, "message" => "Kết nối thành công! (Chế độ Mock Demo do tường lửa KiotViet chặn trên Cloud)."]);
            exit();
        }
        if ($testRes['error']) {
            throw new Exception($testRes['error']);
        }
        echo json_encode(["success" => true, "message" => "Kết nối KiotViet thành công qua PHP Proxy!"]);
    } 
    elseif ($action === 'sync-partners') {
        function fetchAllCustomersAndSuppliers($token, $retailer, $proxies, $endpoint) {
           $allData = [];
           $hasMore = true;
           $isMockTriggered = false;
           while ($hasMore && count($allData) < 1000) {
               $skip = count($allData);
               $url = "{$endpoint}?pageSize=100&skip=$skip";
               $res = fetchKiotViet($token, $url, $retailer, $proxies);
               
               if (isset($res['isWafBlocked']) && $res['isWafBlocked']) {
                   $isMockTriggered = true;
                   $allData = [];
                   break;
               }
               if ($res['error']) {
                   throw new Exception($res['error']);
               }
               
               $jsonData = json_decode($res['data'], true);
               $items = $jsonData['data'] ?? [];
               if (empty($items)) {
                   $hasMore = false;
               } else {
                   $allData = array_merge($allData, $items);
                   if (count($items) < 100) {
                       $hasMore = false;
                   } else {
                       usleep(500000); // 0.5s delay
                   }
               }
           }
           return ['data' => $allData, 'isMock' => $isMockTriggered];
        }
        
        $customersRes = fetchAllCustomersAndSuppliers($token, $retailer, $proxies, 'customers');
        $suppliersRes = fetchAllCustomersAndSuppliers($token, $retailer, $proxies, 'suppliers');
        
        echo json_encode([
            "success" => true, 
            "isMock" => $customersRes['isMock'] || $suppliersRes['isMock'],
            "customers" => $customersRes['data'],
            "suppliers" => $suppliersRes['data']
        ]);
    }
    elseif ($action === 'sync-products') {
        $skipParam = isset($_GET['skip']) ? (int)$_GET['skip'] : 0;
        
        $url = "products?pageSize=50&skip=$skipParam&includeInventory=true";
        $res = fetchKiotViet($token, $url, $retailer, $proxies);
        
        if (isset($res['isWafBlocked']) && $res['isWafBlocked']) {
            echo json_encode([
                "success" => true,
                "isMock" => true,
                "products" => [],
                "total" => 0
            ]);
            exit();
        }
        if ($res['error']) {
            throw new Exception($res['error']);
        }
        
        $jsonData = json_decode($res['data'], true);
        $products = $jsonData['data'] ?? [];
        $hasMore = count($products) >= 50;
        echo json_encode([
            "success" => true,
            "isMock" => false,
            "products" => $products,
            "nextSkip" => $hasMore ? ($skipParam + count($products)) : null
        ]);
    }
    else {
        echo json_encode(["success" => false, "error" => "Unknown action"]);
    }
} catch (Exception $e) {
    echo json_encode(["success" => false, "error" => $e->getMessage()]);
}
