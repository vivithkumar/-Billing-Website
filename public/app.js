(function(){
  const api = (path, opts={}) => fetch('/api'+path, Object.assign({headers:{'Content-Type':'application/json'}}, opts)).then(r=>r.json());

  // Server-side auth check: query /api/auth/me and redirect to login if no session
  async function getCurrentUser(){
    try{
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      return data && data.user ? data.user : null;
    }catch(e){ return null; }
  }

  // Redirect to login if not authenticated
  (async ()=>{
    const user = await getCurrentUser();
    if (!user && window.location.pathname !== '/login.html' && window.location.pathname !== '/login'){
      window.location = '/login.html';
    } else {
      renderUserInfo(user);
    }
  })();

  // show user info and logout (server logout)
  function renderUserInfo(u){
    const el = document.getElementById('user-info');
    if(!el) return;
    if(!u){ el.innerHTML = ''; return; }
    el.innerHTML = `<span style="font-size:13px;color:#222">${u.displayName || u.username}</span> <button id="btn-logout" class="btn-ghost">Logout</button>`;
    const out = document.getElementById('btn-logout'); if(out) out.addEventListener('click', async ()=>{ await fetch('/api/auth/logout', { method: 'POST' }); window.location = '/login.html'; });
  }

  let menu = [];
  let cart = JSON.parse(localStorage.getItem('cart')||'[]');

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function formatCurrency(v){ return '₹' + Number(v).toFixed(2); }

  async function loadMenu(){
    menu = await api('/menu');
    renderMenu();
    renderManageList();
  }

  function renderMenu(){
    const el = $('#menu'); el.innerHTML = '';
    menu.forEach(it=>{
      const card = document.createElement('div'); card.className='card';
      const isWeighted = (it.category === 'Cake') || (it.name && it.name.toLowerCase().includes('mixture'));
      const weightControl = isWeighted ? `\n          <label>Weight <select class="weight-select">\n            <option value="0.5">0.5 kg</option>\n            <option value="1" selected>1 kg</option>\n            <option value="1.5">1.5 kg</option>\n            <option value="2">2 kg</option>\n          </select></label>` : '';
      card.innerHTML = `
        <img src="${it.image||'https://via.placeholder.com/400x300?text=Food'}" alt="${it.name}" />
        <h4>${it.name}</h4>
        <div>${it.category}</div>
        <div class="price">${formatCurrency(it.price)}${isWeighted ? ' /kg' : ''}</div>
        ${weightControl}
        <button data-id="${it.id}">Add</button>
      `;
      // ensure images from external sites load lazily and have a fallback
      const img = card.querySelector('img');
      if(img){
        img.setAttribute('loading','lazy');
        img.addEventListener('error', ()=>{ img.src = 'https://via.placeholder.com/400x300?text=Image+Not+Found'; });
      }
      const btn = card.querySelector('button');
      btn.addEventListener('click', ()=>{
        const sel = card.querySelector('.weight-select');
        const weight = sel ? parseFloat(sel.value) : undefined;
        addToCart(it.id, weight);
      });
      el.appendChild(card);
    });
  }

  function saveCart(){ localStorage.setItem('cart', JSON.stringify(cart)); renderCart(); }

  function addToCart(id, weight){
    // weight-aware cart item: if same id and same weight, increase qty, otherwise add new line
    const found = cart.find(c=>c.id==id && (Number(c.weight||1) === Number(weight||1)));
    if(found) found.qty++;
    else cart.push({id, qty:1, weight: weight});
    saveCart();
  }

  function renderCart(){
    const el = $('#cart-items'); el.innerHTML='';
    let total = 0;
    cart.forEach(ci=>{
      const m = menu.find(x=>x.id==ci.id);
      const name = m ? m.name : 'Unknown';
      const price = m ? m.price : 0;
      const weight = Number(ci.weight) || 1;
      const subtotal = price * weight * ci.qty; total += subtotal;
      const div = document.createElement('div'); div.className='item';
      div.innerHTML = `<div>${name}${weight && weight!==1 ? ` (${weight} kg)` : ''} x ${ci.qty}</div><div>${formatCurrency(subtotal)} <button data-id="${ci.id}" class="minus">-</button> <button data-id="${ci.id}" class="plus">+</button></div>`;
      div.querySelector('.minus').addEventListener('click', ()=>{ changeQty(ci.id, -1); });
      div.querySelector('.plus').addEventListener('click', ()=>{ changeQty(ci.id, +1); });
      el.appendChild(div);
    });
    $('#cart-total').textContent = formatCurrency(total);
  }

  function changeQty(id, delta){
    const it = cart.find(c=>c.id==id); if(!it) return; it.qty += delta; if(it.qty<=0) cart = cart.filter(c=>c.id!=id); saveCart();
  }

  $('#btn-clear').addEventListener('click', ()=>{ cart=[]; saveCart(); });

  $('#btn-print').addEventListener('click', ()=>{
    // simple print view
    const lines = cart.map(ci=>{
      const m = menu.find(x=>x.id==ci.id);
      const weight = Number(ci.weight) || 1;
      const subtotal = m ? (m.price * weight * ci.qty) : 0;
      return `${m ? m.name : ''}${weight && weight!==1 ? ' ('+weight+' kg)' : ''} x ${ci.qty} - ${Number(subtotal).toFixed(2)}`;
    }).join('\n');
    const total = $('#cart-total').textContent;
    const w = window.open('','_blank');
    w.document.write(`<pre>Bill\n\n${lines}\n\nTotal: ${total}</pre>`);
    w.print();
  });

  $('#btn-pay').addEventListener('click', async ()=>{
    // Create the order first, then request a QR for the returned order total.
    const payload = { items: cart.map(ci=>({ id: ci.id, qty: ci.qty, weight: ci.weight })) };
    if (!payload.items || payload.items.length === 0) { alert('Cart empty'); return; }

    let orderData;
    try{
      const orderResp = await fetch('/api/order', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      orderData = await orderResp.json();
      if(!(orderData && orderData.orderId)){
        alert('Failed to create order');
        return;
      }
      // store last order id for invoice download
      localStorage.setItem('lastOrderId', orderData.orderId);
      window.lastOrderId = orderData.orderId;
      // clear cart locally
      cart = [];
      saveCart();
    }catch(e){ console.warn('Failed to create order', e); alert('Failed to create order'); return; }

    // request QR for the order total reported by the server
    const amount = orderData.total || 0;
    if (!amount || Number(amount) <= 0) { alert('Order total invalid'); return; }
    try{
      const res = await fetch(`/api/qrcode?amount=${encodeURIComponent(amount)}&label=${encodeURIComponent('Bakery Payment')}`);
      const data = await res.json();
      if(!data || !data.dataUrl){ alert('Failed to generate QR'); return; }
      const qr = $('#qr-img');
      qr.setAttribute('loading','lazy');
      qr.addEventListener('error', ()=>{ qr.src = '' });
      const logoData = localStorage.getItem('qrLogo');
      window.lastQrDataUrl = data.dataUrl;
      if (logoData) {
        const qrImg = new Image();
        const logoImg = new Image();
        qrImg.crossOrigin = 'anonymous';
        logoImg.crossOrigin = 'anonymous';
        qrImg.onload = () => {
          logoImg.onload = () => {
            const canvas = $('#qr-canvas');
            canvas.width = qrImg.width;
            canvas.height = qrImg.height;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(qrImg, 0, 0, canvas.width, canvas.height);
            const logoSize = Math.floor(canvas.width * 0.2);
            const lx = Math.floor((canvas.width - logoSize) / 2);
            const ly = Math.floor((canvas.height - logoSize) / 2);
            ctx.save();
            ctx.fillStyle = 'white';
            const radius = Math.max(6, Math.floor(logoSize * 0.12));
            const x = lx - 6; const y = ly - 6; const w = logoSize + 12; const h = logoSize + 12;
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.arcTo(x + w, y, x + w, y + h, radius);
            ctx.arcTo(x + w, y + h, x, y + h, radius);
            ctx.arcTo(x, y + h, x, y, radius);
            ctx.arcTo(x, y, x + w, y, radius);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.drawImage(logoImg, lx, ly, logoSize, logoSize);
            qr.src = canvas.toDataURL('image/png');
            qr.style.display = 'block';
            $('#qr-logo-preview').src = logoData; $('#qr-logo-preview').style.display = 'block';
            $('#qr-modal').classList.remove('hidden');
          };
          logoImg.src = logoData;
        };
        qrImg.src = data.dataUrl;
      } else {
        qr.src = data.dataUrl;
        qr.style.display = 'block';
        $('#qr-modal').classList.remove('hidden');
      }
    }catch(err){ console.warn('QR generation failed', err); alert('Failed to generate QR'); }
  });

  // Download invoice button
  $('#btn-download').addEventListener('click', async ()=>{
    let orderId = window.lastOrderId || localStorage.getItem('lastOrderId');
    if(!orderId){
      if(!confirm('No recent order found. Create order from cart now?')) return;
      // create order then download
      try{
        const payload = { items: cart.map(ci=>({ id: ci.id, qty: ci.qty, weight: ci.weight })) };
        const orderResp = await fetch('/api/order', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const orderData = await orderResp.json();
        if(orderData && orderData.orderId){ orderId = orderData.orderId; localStorage.setItem('lastOrderId', orderId); window.lastOrderId = orderId; cart = []; saveCart(); }
      }catch(e){ alert('Failed to create order'); return; }
    }
    if(orderId) window.open(`/api/order/${orderId}/invoice`);
  });
  $('#qr-close').addEventListener('click', ()=>$('#qr-modal').classList.add('hidden'));

  // handle logo upload for QR
  const qrLogoInput = $('#qr-logo-input');
  if (qrLogoInput) {
    qrLogoInput.addEventListener('change', (e)=>{
      const f = e.target.files && e.target.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = function(ev){
        const dataUrl = ev.target.result;
        try{ localStorage.setItem('qrLogo', dataUrl); } catch(err){ console.warn('Could not store logo', err); }
        const preview = $('#qr-logo-preview'); if(preview){ preview.src = dataUrl; preview.style.display = 'block'; }
        // make sure qr image will show when generated
        const qrImg = $('#qr-img'); if(qrImg) qrImg.style.display = 'none';
      };
      reader.readAsDataURL(f);
    });
  }

    // Clear stored logo
    const qrClearBtn = $('#qr-clear-logo');
    if (qrClearBtn) {
      qrClearBtn.addEventListener('click', ()=>{
        try{ localStorage.removeItem('qrLogo'); } catch(err) { console.warn('Could not remove logo', err); }
        const preview = $('#qr-logo-preview'); if(preview){ preview.src = ''; preview.style.display = 'none'; }
        const canvas = $('#qr-canvas'); if(canvas){ const ctx = canvas.getContext && canvas.getContext('2d'); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); }
        const qrImg = $('#qr-img'); if(qrImg){ qrImg.src = window.lastQrDataUrl || ''; qrImg.style.display = window.lastQrDataUrl ? 'block' : 'none'; }
      });
    }

    // Global header upload/delete buttons
    const qrGlobalInput = $('#qr-global-input');
    const qrUploadBtn = $('#btn-qr-upload');
    const qrDeleteBtn = $('#btn-qr-delete');
    if (qrUploadBtn && qrGlobalInput) {
      qrUploadBtn.addEventListener('click', ()=> qrGlobalInput.click());
      qrGlobalInput.addEventListener('change', (e)=>{
        const f = e.target.files && e.target.files[0];
        if(!f) return;
        const reader = new FileReader();
        reader.onload = function(ev){
          const dataUrl = ev.target.result;
          try{ localStorage.setItem('qrLogo', dataUrl); } catch(err){ console.warn('Could not store logo', err); }
          // update modal preview if present
          const preview = $('#qr-logo-preview'); if(preview){ preview.src = dataUrl; preview.style.display = 'block'; }
          alert('QR logo uploaded and saved in browser storage. Open Pay modal to see preview.');
        };
        reader.readAsDataURL(f);
      });
    }
    if (qrDeleteBtn) {
      qrDeleteBtn.addEventListener('click', ()=>{
        try{ localStorage.removeItem('qrLogo'); } catch(err) { console.warn('Could not remove logo', err); }
        const preview = $('#qr-logo-preview'); if(preview){ preview.src = ''; preview.style.display = 'none'; }
        const canvas = $('#qr-canvas'); if(canvas){ const ctx = canvas.getContext && canvas.getContext('2d'); if(ctx) ctx.clearRect(0,0,canvas.width,canvas.height); }
        const qrImg = $('#qr-img'); if(qrImg){ qrImg.src = window.lastQrDataUrl || ''; }
        alert('QR logo removed from browser storage.');
      });
    }

  // Manage
  $('#btn-manage').addEventListener('click', ()=>$('#manage-modal').classList.remove('hidden'));
  $('#manage-close').addEventListener('click', ()=>$('#manage-modal').classList.add('hidden'));
  $('#manage-cancel').addEventListener('click', ()=>{ $('#manage-form').reset(); });

  async function renderManageList(){
    const el = $('#manage-list'); el.innerHTML='';
    menu.forEach(it=>{
      const div = document.createElement('div'); div.className='manage-item';
      div.innerHTML = `<strong>${it.name}</strong> (${it.category}) - ${formatCurrency(it.price)} <button data-id="${it.id}" class="edit">Edit</button> <button data-id="${it.id}" class="del">Delete</button>`;
      div.querySelector('.edit').addEventListener('click', ()=>{
        const f = document.forms['manage-form']; f.id.value = it.id; f.name.value = it.name; f.category.value = it.category; f.price.value = it.price; f.image.value = it.image || '';
      });
      div.querySelector('.del').addEventListener('click', async ()=>{
        if(!confirm('Delete item?')) return; await fetch('/api/menu/'+it.id, {method:'DELETE'}); await loadMenu();
      });
      el.appendChild(div);
    });
  }

  document.forms['manage-form'].addEventListener('submit', async (e)=>{
    e.preventDefault();
    const f = e.target; const id = f.id.value; const body = {name:f.name.value, category:f.category.value, price: Number(f.price.value), image: f.image.value};
    if(id){ await fetch('/api/menu/'+id, {method:'PUT', body: JSON.stringify(body), headers:{'Content-Type':'application/json'}}); }
    else { await fetch('/api/menu', {method:'POST', body: JSON.stringify(body), headers:{'Content-Type':'application/json'}}); }
    f.reset(); await loadMenu();
  });

  // Sales report
  $('#btn-report').addEventListener('click', ()=>$('#sales-modal').classList.remove('hidden'));
  $('#sales-close').addEventListener('click', ()=>$('#sales-modal').classList.add('hidden'));
  $('#sales-run').addEventListener('click', async ()=>{
    const m = $('#sales-month').value; if(!m){ alert('Select month'); return; }
    const res = await fetch('/api/sales?month='+m);
    const data = await res.json();
    $('#sales-result').innerHTML = `<div>Total for ${m}: <strong>${formatCurrency(data.total)}</strong> (${data.orders} orders)</div>`;
  });
  $('#sales-download').addEventListener('click', ()=>{
    const m = $('#sales-month').value; if(!m){ alert('Select month'); return; }
    window.open(`/api/sales/pdf?month=${encodeURIComponent(m)}`);
  });

  // sync menu data by ID types
  function coerceMenuIds(){ menu = menu.map(m=>{ m.id = Number(m.id); return m; }); }

  // initial
  loadMenu().then(()=>{ coerceMenuIds(); renderCart(); });
})();
