import React, { useState, useEffect } from 'react';
import { Save, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase/config';

export function SettingsPage() {
  const { userProfile, hasPermission } = useAppContext();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [retailer, setRetailer] = useState('');
  const [proxies, setProxies] = useState('');
  const [backendType, setBackendType] = useState<'node' | 'php'>('node');
  const [isSaving, setIsSaving] = useState(false);
  const [checkStatus, setCheckStatus] = useState<string | null>(null);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load config from Firestore to share across devices
    const loadConfig = async () => {
      try {
        const docRef = doc(db, 'settings', 'kiotviet');
        const docSnap = await getDoc(docRef);
        
        let storedId = '';
        let storedSecret = '';
        let storedRetailer = '';
        let storedProxies = '';

        if (docSnap.exists()) {
          const data = docSnap.data();
          storedId = data.clientId || '';
          storedSecret = data.clientSecret || '';
          storedRetailer = data.retailer || '';
          storedProxies = data.proxies || '';
        } else {
          // Fallback to local storage
          storedId = localStorage.getItem('kiotviet_client_id') || '';
          storedSecret = localStorage.getItem('kiotviet_client_secret') || '';
          storedRetailer = localStorage.getItem('kiotviet_retailer') || '';
          storedProxies = localStorage.getItem('kiotviet_proxies') || '';
        }

        setClientId(storedId);
        setClientSecret(storedSecret);
        setRetailer(storedRetailer);
        setProxies(storedProxies);
        
        // Also save to localStorage for other parts of the app
        if (storedId) localStorage.setItem('kiotviet_client_id', storedId);
        if (storedSecret) localStorage.setItem('kiotviet_client_secret', storedSecret);
        if (storedRetailer) localStorage.setItem('kiotviet_retailer', storedRetailer);
        if (storedProxies) localStorage.setItem('kiotviet_proxies', storedProxies);

        if (storedId && storedSecret && storedRetailer) {
          checkConnection(storedId, storedSecret, storedRetailer, storedProxies);
        }
      } catch (err) {
        console.error("Failed to load Kiotviet config", err);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadConfig();
  }, []);

  if (!hasPermission('settings', 'view')) {
    return (
      <div className="flex h-full items-center justify-center">
        <h2 className="text-xl font-semibold text-brand-text-sub">Bạn không có quyền truy cập trang Cài đặt</h2>
      </div>
    );
  }

  const handleSave = async () => {
    setIsSaving(true);
    
    // Save to localStorage for quick access
    localStorage.setItem('kiotviet_client_id', clientId);
    localStorage.setItem('kiotviet_client_secret', clientSecret);
    localStorage.setItem('kiotviet_retailer', retailer);
    localStorage.setItem('kiotviet_proxies', proxies);
    localStorage.setItem('kiotviet_backend_type', backendType);
    
    try {
      // Save to Firestore so it auto syncs to the web for everyone
      await setDoc(doc(db, 'settings', 'kiotviet'), {
        clientId,
        clientSecret,
        retailer,
        proxies,
        backendType,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      alert('Đã lưu thông tin cấu hình KiotViet thành công (Lưu trên Hệ thống). Cấu hình này sẽ tự động được sử dụng trên Web App.');
    } catch (err) {
      console.error(err);
      alert('Đã lưu vào bộ nhớ cục bộ, nhưng không thể lưu lên dữ liệu đám mây: ' + (err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const checkConnection = async (id = clientId, secret = clientSecret, ret = retailer, pxs = proxies, beType = backendType) => {
    setIsChecking(true);
    setCheckStatus(null);
    setCheckMessage(null);
    try {
      const payload = { clientId: id, clientSecret: secret, retailer: ret, proxies: pxs };
      // Base64 encode using btoa to support unicode safely
      const encodedProxies = btoa(unescape(encodeURIComponent(pxs)));
      const endpoint = beType === 'php' ? '/kiotviet-proxy.php?action=check' : '/api/kiotviet/check';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kv-client-id': id,
          'x-kv-client-secret': secret,
          'x-kv-retailer': ret,
          'x-kv-proxies': encodedProxies
        },
        body: JSON.stringify(payload)
      });
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
         throw new Error(`TRẠNG THÁI MÔI TRƯỜNG KHÔNG HỢP LỆ:\n\nHosting hiện tại của bạn không hỗ trợ (hoặc chưa bật) NodeJS Backend. Mã nguồn này cần máy chủ Node (để làm trạm trung chuyển - proxy) vì KiotViet chặn trình duyệt gọi API trực tiếp (lỗi CORS).\n\nCách 1: Xử lý trên Hosting hiện tại\n- Nếu dùng cPanel/Hostinger/VPS: Cài đặt Node.js và chạy file 'server.ts'.\n- Hoặc: Chuyển sang tùy chọn 'Dùng PHP Proxy' ở trên (Nếu Hosting của bạn chỉ chạy PHP thuần như cPanel/DirectAdmin tĩnh).\n\nCách 2: Build sang Vercel (Ổn định nhất & Miễn phí)\nUpload toàn bộ mã nguồn gốc này lên Github, sau đó đăng nhập Vercel.com, Create New Project và chọn Repository Github đó. Vercel sẽ tự động hiểu thư mục api/ là Backend và chạy Node.js cho bạn, đồng thời chạy file Build dist cung cấp ra ngoài cho người dùng 1 cách trơn tru nhất.`);
      }
      
      const data = await res.json();
      if (data.success) {
        setCheckStatus('success');
        setCheckMessage(data.message || 'Kết nối thành công!');
      } else {
        setCheckStatus('error');
        setCheckMessage(data.error || 'Kết nối thất bại!');
      }
    } catch (e: any) {
      setCheckStatus('error');
      setCheckMessage(e.message || 'Lỗi mạng khi kiểm tra kết nối.');
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-10">
      <div>
        <h1 className="text-[20px] font-bold text-brand-text">Cài Đặt Hệ Thống</h1>
        <p className="text-brand-text-sub text-[13px] mt-1">Cấu hình kết nối API API KiotViet cho quá trình đồng bộ.</p>
      </div>

      <div className="bg-white rounded-lg border border-brand-border p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4 border-b border-brand-border pb-3">
          <LinkIcon className="text-brand-primary" size={20} />
          <h2 className="font-semibold text-brand-text text-[15px]">API Keys KiotViet</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-brand-text mb-1">KIOTVIET_RETAILER (Tên gian hàng)</label>
            <input 
              type="text" 
              value={retailer}
              onChange={(e) => setRetailer(e.target.value)}
              className="w-full px-3 py-2 border border-brand-border rounded-[3px] text-[14px] focus:outline-none focus:border-brand-primary font-mono text-slate-700"
              placeholder="Ví dụ: fugalo"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-brand-text mb-1">KIOTVIET_CLIENT_ID</label>
            <input 
              type="text" 
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2 border border-brand-border rounded-[3px] text-[14px] focus:outline-none focus:border-brand-primary font-mono text-slate-700"
              placeholder="VD: dbae08de-..."
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-brand-text mb-1">KIOTVIET_CLIENT_SECRET</label>
            <input 
              type="password" 
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className="w-full px-3 py-2 border border-brand-border rounded-[3px] text-[14px] focus:outline-none focus:border-brand-primary font-mono text-slate-700"
              placeholder="VD: 837AB253..."
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-brand-text mb-1">Danh sách Proxy (Mỗi dòng 1 Proxy)</label>
            <textarea 
              value={proxies}
              onChange={(e) => setProxies(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-brand-border rounded-[3px] text-[14px] focus:outline-none focus:border-brand-primary font-mono text-slate-700"
              placeholder={'http://user:pass@1.53.122.98:30000\nHoặc định dạng: 1.53.122.98:30000:user:pass'}
            />
            <p className="text-[11px] text-slate-500 mt-1">Hệ thống sẽ luân phiên sử dụng list proxy này. Chấp nhận dạng IP:PORT:USER:PASS</p>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-brand-text mb-1">Môi trường Máy chủ (Backend)</label>
            <div className="flex gap-4 items-center">
              <label className="flex items-center gap-2 text-[14px]">
                <input 
                  type="radio" 
                  name="backendType" 
                  value="node" 
                  checked={backendType === 'node'}
                  onChange={() => setBackendType('node')} 
                />
                Dùng NodeJS (Mặc định)
              </label>
              <label className="flex items-center gap-2 text-[14px]">
                <input 
                  type="radio" 
                  name="backendType" 
                  value="php" 
                  checked={backendType === 'php'}
                  onChange={() => setBackendType('php')} 
                />
                Dùng PHP Proxy (.php)
              </label>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center justify-center gap-2 bg-brand-primary text-white py-2 px-5 rounded-[3px] hover:bg-opacity-90 font-semibold text-[13px] transition disabled:opacity-50"
            >
              <Save size={16} />
              {isSaving ? 'Đang lưu...' : 'Lưu Cài Đặt'}
            </button>

            <button 
              onClick={() => checkConnection()}
              disabled={isChecking || !clientId || !clientSecret || !retailer}
              className="flex items-center justify-center gap-2 bg-slate-100 text-slate-700 border border-slate-200 py-2 px-5 rounded-[3px] hover:bg-slate-200 font-semibold text-[13px] transition disabled:opacity-50"
            >
              <RefreshCw size={16} className={isChecking ? "animate-spin" : ""} />
              {isChecking ? 'Đang kiểm tra...' : 'Kiểm tra kết nối'}
              <span className={`w-2 h-2 rounded-full ml-0.5 ${
                isChecking ? 'bg-slate-400' : 
                checkStatus === 'success' ? 'bg-green-500' : 
                checkStatus === 'error' ? 'bg-red-500' : 'bg-slate-400'
              }`}></span>
            </button>
          </div>

          {checkStatus === 'success' && (
            <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-[3px] text-[13px] font-medium">
              ✅ {checkMessage}
            </div>
          )}
          {checkStatus === 'error' && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-[3px] text-[13px] font-medium whitespace-pre-line">
              ❌ {checkMessage}
            </div>
          )}
        </div>
        
        <div className="mt-5 pt-4 border-t border-brand-border">
          <p className="text-[13px] text-slate-600 mb-2">
            <strong>Cách 2: Build sang Vercel (Ổn định nhất & Miễn phí)</strong>
          </p>
          <p className="text-[12px] text-slate-500 mb-4 whitespace-pre-line leading-relaxed">
            Upload toàn bộ mã nguồn gốc này lên Github, sau đó đăng nhập Vercel.com, Create New Project và chọn Repository Github đó. Vercel sẽ tự động hiểu thư mục api/ là Backend và chạy Node.js cho bạn, đồng thời chạy file Build dist cung cấp ra ngoài cho người dùng 1 cách trơn tru nhất.
          </p>
          <p className="text-[12px] text-slate-400 border-t border-slate-100 pt-3">
            <strong>Lưu ý bảo mật:</strong> API Keys được lưu trữ trên Hệ Thống đám mây để tất cả các trưởng nhóm/Admin có quyền đồng bộ đều có thể sử dụng (vì KiotViet chặn trình duyệt gọi API trực tiếp). Nó được bảo mật cao nhất thông qua Cloud Firestore rules.
          </p>
        </div>
      </div>
    </div>
  );
}
