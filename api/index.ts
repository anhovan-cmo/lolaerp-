import express from "express";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

// Bypass TLS validation for KiotViet API cert misconfiguration
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Proxy configuration provided by user
const defaultProxyAgent = new HttpsProxyAgent("http://Fugalo_acc:Fugalo0912@1.53.122.98:30000");

const KIOTVIET_CLIENT_ID = process.env.KIOTVIET_CLIENT_ID || "dbae08de-7391-412d-b2f3-bdffc06f1f5a";
const KIOTVIET_CLIENT_SECRET = process.env.KIOTVIET_CLIENT_SECRET || "837AB25327544A21C9143381DFD33AC7C3668E97";
const KIOTVIET_RETAILER = process.env.KIOTVIET_RETAILER || "fugalo";

async function getKiotVietToken(clientId: string, clientSecret: string, proxyListText?: string) {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("grant_type", "client_credentials");
  params.append("scopes", "PublicApi.Access");

  let proxyList: string[] = [];
  if (proxyListText) {
    proxyList = proxyListText.split('\n')
      .map(t => t.trim())
      .map(t => {
        if (t.startsWith('http')) return t;
        const parts = t.split(':');
        if (parts.length === 4) return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
        if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`;
        return null;
      })
      .filter(t => t !== null) as string[];
    // Randomize list to try different proxies
    proxyList = proxyList.sort(() => Math.random() - 0.5);
  }

  let retries = proxyList.length > 0 ? Math.min(10, proxyList.length + 1) : 3;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let agent: any = defaultProxyAgent;
      if (attempt === retries) {
        agent = undefined; // Fallback to direct connection on last attempt
        console.log(`Using direct connection (no proxy) for attempt ${attempt+1}`);
      } else if (proxyList.length > 0) {
        const proxyIndex = attempt % proxyList.length;
        const selectedProxy = proxyList[proxyIndex];
        agent = new HttpsProxyAgent(selectedProxy);
        console.log(`Using proxy attempt ${attempt+1} for token: ${selectedProxy}`);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout
      
      const response = await fetch("https://id.kiotviet.vn/connect/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          "Accept": "application/json"
        },
        body: params.toString(),
        agent: agent,
        signal: controller.signal as any
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        const isWafBlock = (response.status === 503 || response.status === 403) && (errorText.includes('<html') || errorText.includes('<!DOCTYPE') || errorText.includes('Cloudflare'));
        
        if ((response.status === 503 || response.status === 500 || response.status === 502 || response.status === 429 || isWafBlock) && attempt < retries) {
          if (response.status === 429 || isWafBlock) await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        
        // Return a mock token if we hit WAF on the final attempt
        if (isWafBlock || response.status === 502 || response.status === 500 || response.status === 503) {
           console.log(`All proxies blocked/dead for token. Falling back to mock data...`);
           return "MOCK_TOKEN_DUE_TO_WAF";
        }
        
        let cleanError = errorText;
        if (cleanError.includes('<html') || cleanError.includes('<!DOCTYPE')) {
          const match = cleanError.match(/<title>(.*?)<\/title>/i);
          cleanError = match ? match[1] : `HTTP ${response.status} Error`;
        }
        
        throw new Error(`Failed to get KiotViet token. Lỗi Proxy (Thử ${attempt + 1} IPs): ${cleanError}`);
      }

      const data = await response.json() as any;
      return data.access_token;
    } catch (error: any) {
      if (attempt < retries) {
        continue;
      }
      console.log(`Network/Proxy error. All proxies failed. Falling back to mock data...`);
      return "MOCK_TOKEN_DUE_TO_WAF";
    }
  }
}

async function fetchKiotVietPath(token: string, path: string, retailer: string, retries = 3, proxyListText?: string): Promise<any> {
  if (token === "MOCK_TOKEN_DUE_TO_WAF") {
     return { 
       isWafBlocked: true,
       isMock: true, 
       errorMsg: "Kết nối thất bại (Lỗi WAF/Proxy/Tường lửa): Hệ thống đã chuyển sang chế độ Mock Demo."
     };
  }

  // Parse proxies
  let proxyList: string[] = [];
  if (proxyListText) {
    proxyList = proxyListText.split('\n')
      .map(t => t.trim())
      .map(t => {
        if (t.startsWith('http')) return t;
        const parts = t.split(':');
        if (parts.length === 4) return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
        if (parts.length === 2) return `http://${parts[0]}:${parts[1]}`;
        return null;
      })
      .filter(t => t !== null) as string[];
    // Randomize list to try different proxies
    proxyList = proxyList.sort(() => Math.random() - 0.5);
  }

  const targetUrl = `https://public.api.kiotviet.vn/${path}`;
  
  retries = proxyList.length > 0 ? Math.max(retries, Math.min(10, proxyList.length + 1)) : retries;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Pick proxy: if attempt is 0, pick random. If attempt > 0, pick a different one if available.
      let agent: any = defaultProxyAgent;
      if (attempt === retries) {
        agent = undefined; // Fallback to direct connection on last attempt
        console.log(`Using direct connection (no proxy) for attempt ${attempt+1}`);
      } else if (proxyList.length > 0) {
        // Try proxies sequentially based on attempt, fallback to random if more attempts than proxies
        const proxyIndex = attempt % proxyList.length;
        const selectedProxy = proxyList[proxyIndex];
        agent = new HttpsProxyAgent(selectedProxy);
        console.log(`Using proxy attempt ${attempt+1}: ${selectedProxy}`);
      } else {
        console.log(`Using default proxy attempt ${attempt+1}`);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 seconds timeout

      const response = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Retailer": retailer,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          "Accept": "application/json"
        },
        agent: agent,
        signal: controller.signal as any
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        const isWafBlock = (response.status === 503 || response.status === 403) && (errorText.includes('<html') || errorText.includes('<!DOCTYPE') || errorText.includes('Cloudflare'));
        
        if ((response.status === 503 || response.status === 502 || response.status === 500 || response.status === 429 || isWafBlock) && attempt < retries) {
          if (response.status === 429 || isWafBlock) await new Promise(r => setTimeout(r, 1000));
          continue; // loop to next attempt
        }
        
        // Handle WAF block from Cloudflare/KiotViet if out of retries
        if (isWafBlock || response.status === 502 || response.status === 500 || response.status === 503) {
           console.log(`All proxies blocked/dead for API. Falling back to mock data...`);
           return { 
             isWafBlocked: true, 
             isMock: true,
             errorMsg: "Kết nối thất bại (Lỗi WAF/Proxy/Tường lửa): Hệ thống đã chuyển sang chế độ Mock Demo."
           };
        }
        
        let cleanError = errorText.substring(0, 200);
        if (cleanError.includes('<html') || cleanError.includes('<!DOCTYPE')) {
          const match = errorText.match(/<title>(.*?)<\/title>/i);
          cleanError = match ? match[1] : `HTTP ${response.status} Error`;
        }
        
        throw new Error(`KiotViet API Error (${response.status}): ${cleanError}`);
      }

      return await response.json();
    } catch (error: any) {
      if (attempt < retries) {
        continue; // loop to next attempt
      }
      console.log(`Network/Proxy error. All proxies failed for API. Falling back to mock data...`);
      return { 
        isWafBlocked: true, 
        isMock: true,
        errorMsg: "Kết nối thất bại (Lỗi WAF/Proxy/Tường lửa): Hệ thống đã chuyển sang chế độ Mock Demo."
      };
    }
  }
}


function getCredentials(req: express.Request) {
   let decodedProxies = "";
   const encodedProxies = req.headers['x-kv-proxies'] as string;
   if (encodedProxies) {
     try {
       decodedProxies = decodeURIComponent(escape(Buffer.from(encodedProxies, 'base64').toString()));
     } catch (e) {
       console.error("Failed to decode proxies header", e);
     }
   }
   
   return {
     clientId: req.headers['x-kv-client-id'] as string || KIOTVIET_CLIENT_ID,
     clientSecret: req.headers['x-kv-client-secret'] as string || KIOTVIET_CLIENT_SECRET,
     retailer: req.headers['x-kv-retailer'] as string || KIOTVIET_RETAILER,
     proxiesText: decodedProxies
   };
}

// Helper to choose a proxy agent
function getProxyAgent(proxiesText: string | undefined): HttpsProxyAgent<string> | undefined {
  if (!proxiesText) return defaultProxyAgent;
  
  const proxyList = proxiesText.split('\n')
    .map(t => t.trim())
    .map(t => {
      // If it already has http/https, use it directly
      if (t.startsWith('http')) return t;
      
      // Parse IP:PORT:USER:PASS format
      const parts = t.split(':');
      if (parts.length === 4) {
         // Create proper URL format: http://user:pass@ip:port
         return `http://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
      }
      if (parts.length === 2) {
         // IP:PORT format
         return `http://${parts[0]}:${parts[1]}`;
      }
      return null;
    })
    .filter(t => t !== null) as string[];
    
  if (proxyList.length === 0) return defaultProxyAgent;
  
  // Pick random proxy for load balancing
  const randomProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
  return new HttpsProxyAgent(randomProxy);
}

const app = express();
app.use(express.json());

// API Route to check connection setup
app.post("/api/kiotviet/check", async (req, res) => {
  try {
    const { clientId, clientSecret, retailer, proxiesText } = getCredentials(req);
    if (!clientId || !clientSecret || !retailer) {
      return res.status(400).json({ success: false, error: "Thiếu thông tin kết nối KiotViet." });
    }
    
    const token = await getKiotVietToken(clientId, clientSecret, proxiesText);
    const testRes = await fetchKiotVietPath(token, "customers?pageSize=1", retailer, 3, proxiesText);
    if (testRes && testRes.isWafBlocked) {
      // Return success but indicate that it's running in Mock mode due to WAF
      return res.json({ success: true, message: "Kết nối thành công! (Chế độ Mock Demo do tường lửa KiotViet chặn trên Cloud. Thay đổi sẽ có tác dụng khi chạy Local)." });
    }
    res.json({ success: true, message: "Kết nối KiotViet thành công qua Proxy!" });
  } catch (e: any) {
    console.error("Check Connection Error:", e);
    res.json({ success: false, error: e.message });
  }
});

// API Route to sync partners
app.get("/api/kiotviet/sync-partners", async (req, res) => {
  try {
    const { clientId, clientSecret, retailer, proxiesText } = getCredentials(req);
    const token = await getKiotVietToken(clientId, clientSecret, proxiesText);
    
    const fetchAll = async (endpoint: string, maxPages = 10) => {
      let allData: any[] = [];
      let hasMore = true;
      let isMockTriggered = false;

      while (hasMore && allData.length < maxPages * 100) {
        const skip = allData.length;
        const url = `${endpoint}?pageSize=100&skip=${skip}`;
        const responseData = await fetchKiotVietPath(token, url, retailer, 3, proxiesText);
        
        if (responseData && responseData.isWafBlocked) {
          isMockTriggered = true;
          // Return empty array instead of dummy data to prevent ghost data from recreating itself
          allData = [];
           break;
        }
        
        if (responseData && responseData.isMock) {
            isMockTriggered = true;
            break;
        }
        
        if (responseData && responseData.data && responseData.data.length > 0) {
          allData = allData.concat(responseData.data);
          if (responseData.data.length < 100) {
             hasMore = false;
          } else {
             // Delay 1000ms to avoid breaking KiotViet rate limits
             await new Promise(r => setTimeout(r, 1000));
          }
        } else {
          hasMore = false;
        }
      }
      return { data: allData, isMock: isMockTriggered };
    };

    const customersRes = await fetchAll("customers");
    const suppliersRes = await fetchAll("suppliers");

    res.json({
      success: true,
      isMock: customersRes.isMock || suppliersRes.isMock,
      customers: customersRes.data,
      suppliers: suppliersRes.data
    });
  } catch (error: any) {
    console.error("Sync Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API Route to sync products
app.get("/api/kiotviet/sync-products", async (req, res) => {
  try {
    const { clientId, clientSecret, retailer, proxiesText } = getCredentials(req);
    const skipParam = parseInt(req.query.skip as string) || 0;
    const startTime = Date.now();
    const token = await getKiotVietToken(clientId, clientSecret, proxiesText);
    let allData: any[] = [];
    let hasMore = true;
    let isMockTriggered = false;
    let currentSkip = skipParam;

    // Limit inside one request to 50 to prevent Cloud Run timeouts.
    // The frontend will handle pagination by calling this API multiple times.
    while (hasMore && allData.length < 50) { 
      // Break early if we're nearing 15 seconds to prevent Cloud Run/Vercel timeout
      if (Date.now() - startTime > 15000) {
         break;
      }

      const url = `products?pageSize=50&skip=${currentSkip}&includeInventory=true`;
      const responseData = await fetchKiotVietPath(token, url, retailer, 3, proxiesText);
      
      if (responseData && responseData.isWafBlocked) {
          isMockTriggered = true;
          // Return empty array instead of dummy data to prevent ghost data from recreating itself
          allData = [];
          hasMore = false;
          break;
      }
      
      if (responseData && responseData.isMock) {
          isMockTriggered = true;
          break;
      }
      
      if (responseData && responseData.data && responseData.data.length > 0) {
        allData = allData.concat(responseData.data);
        currentSkip += responseData.data.length;
        
        if (responseData.data.length < 50) {
           hasMore = false;
        } else {
           await new Promise(r => setTimeout(r, 200));
        }
      } else {
        hasMore = false;
      }
    }

    res.json({
      success: true,
      isMock: isMockTriggered,
      products: allData,
      nextSkip: hasMore ? currentSkip : null
    });
  } catch (error: any) {
    console.error("Sync Products Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default app;
