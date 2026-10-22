const config = { leverPrice: 95000, rubberPrice: 4000, shippingFee: 4000 };
const items = [{id:'lever',name:'CDP Quadruple Edge Lever',price:config.leverPrice}, ...[15,20,25,30,35].map(n=>({id:`rubber-${n}`,name:`추가 탄성 고무 ${n}`,price:config.rubberPrice,grade:n}))];
let quantities = Object.fromEntries(items.map(i=>[i.id,0]));
try {const saved=JSON.parse(localStorage.getItem('cdp-cart')||'{}');for(const i of items){if(Number.isInteger(saved[i.id])&&saved[i.id]>=0&&saved[i.id]<=99)quantities[i.id]=saved[i.id];}}catch{}
const won = n=>`${n.toLocaleString('ko-KR')}원`;
document.querySelector('#rubber-options').innerHTML=items.filter(i=>i.grade).map(i=>`<div class="rubber-row"><div><strong>${i.grade}</strong><small>${i.price===null?'가격 안내 예정':won(i.price)}</small></div><div class="stepper" data-item="${i.id}"><button data-delta="-1" aria-label="${i.grade} 고무 수량 줄이기">−</button><output>0</output><button data-delta="1" aria-label="${i.grade} 고무 수량 늘리기">+</button></div></div>`).join('');
if(config.leverPrice!==null)document.querySelector('#lever-price').textContent=won(config.leverPrice);
function selected(){return items.filter(i=>quantities[i.id]>0)}
function update(){const count=Object.values(quantities).reduce((a,b)=>a+b,0);document.querySelector('#cart-count').textContent=count;document.querySelector('#bottom-count').textContent=`선택한 상품 ${count}개`;document.querySelectorAll('.stepper').forEach(el=>{const qty=quantities[el.dataset.item];el.querySelector('output').textContent=qty;el.querySelector('[data-delta="-1"]').disabled=qty===0;el.querySelector('[data-delta="1"]').disabled=qty===99;});const rows=selected();document.querySelector('#cart-items').innerHTML=rows.length?rows.map(i=>`<div class="cart-row"><span>${i.name}</span><strong>${quantities[i.id]}개</strong></div>`).join(''):'<p class="muted">선택한 상품이 없습니다. 원하는 제품의 수량을 선택해 주세요.</p>';const subtotal=rows.reduce((sum,i)=>sum+i.price*quantities[i.id],0);const shipping=rows.length?config.shippingFee:0;document.querySelector('#total').textContent=rows.length?`상품 합계 ${won(subtotal)}\n배송비 ${won(shipping)} (주문당 1회)\n총 주문 금액 ${won(subtotal+shipping)}`:'';document.querySelector('#bottom-total').textContent=`총 주문 금액 ${won(subtotal+shipping)}`;document.querySelector('#submit-order').disabled=!rows.length;try{localStorage.setItem('cdp-cart',JSON.stringify(quantities));}catch{}}
document.addEventListener('click',event=>{const button=event.target.closest('[data-delta]');if(!button)return;const id=button.closest('.stepper').dataset.item;quantities[id]=Math.max(0,Math.min(99,quantities[id]+Number(button.dataset.delta)));update();});
const dialog=document.querySelector('#cart');for(const id of ['cart-open','review'])document.getElementById(id).addEventListener('click',()=>dialog.showModal());document.querySelector('#cart-close').addEventListener('click',()=>dialog.close());

const form = document.querySelector('#checkout');
const status = document.querySelector('#order-status');
let busy = false;
let pending = null;
// Keep only the random request key and a digest across refreshes, never delivery details.
try {pending = JSON.parse(sessionStorage.getItem('cdp-pending'));} catch {}
function clearPending(){pending=null;try{sessionStorage.removeItem('cdp-pending');}catch{}}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if(busy || !selected().length || !form.reportValidity()) return;
  const fields = new FormData(form);
  const customer = Object.fromEntries(['name','phone','address','addressDetail'].map(k=>[k,String(fields.get(k)||'').trim()]));
  if(!/^0\d{8,10}$/.test(customer.phone.replace(/[\s-]/g,''))){status.textContent='연락처를 확인해 주세요.';return;}
  busy=true;
  document.querySelector('#cart-close').disabled=true;
  const submit=document.querySelector('#submit-order');
  submit.disabled=true;submit.textContent='접수 중…';status.textContent='주문을 저장하고 있습니다. 잠시 기다려 주세요.';
  let payload;
  try {
    const content={customer,quantities:{...quantities},consent:fields.get('consent')==='on'};
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(content))))).map(b=>b.toString(16).padStart(2,'0')).join('');
    if(!pending || pending.digest!==digest){pending={digest,requestId:crypto.randomUUID()};try{sessionStorage.setItem('cdp-pending',JSON.stringify(pending));}catch{}}
    payload={...content,requestId:pending.requestId};
    const response=await fetch('/.netlify/functions/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
    let result;try{result=await response.json();}catch{throw Error('주문 서버에 연결하지 못했습니다. 입력 내용을 유지한 채 다시 시도해 주세요.');}
    if(!response.ok || !result.ok)throw Error(result.error||'주문을 저장하지 못했습니다. 다시 시도해 주세요.');
    if(!/^CDP-[A-Z0-9-]+$/.test(result.orderId)||!Number.isFinite(result.total))throw Error('주문 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
    document.querySelector('#order-number').textContent=result.orderId;
    document.querySelector('#order-amount').textContent=result.shippingFee===null?`상품 합계 ${won(result.total)} · 기존 주문 배송비 별도 안내`:`상품 합계 ${won(result.total)} · 배송비 ${won(result.shippingFee)} · 총 주문 금액 ${won(result.grandTotal)}`;
    for(const id of Object.keys(quantities))quantities[id]=0;
    update();form.reset();form.hidden=true;document.querySelector('#order-success').hidden=false;status.textContent='';clearPending();
  }catch(error){status.textContent=error.name==='TimeoutError'?'응답이 지연되고 있습니다. 입력 내용을 유지한 채 다시 주문하기를 눌러 주세요.':error.message;}
  finally{busy=false;document.querySelector('#cart-close').disabled=false;submit.disabled=!selected().length;submit.textContent='주문 접수하기';}
});
for(const id of ['cart-open','review'])document.getElementById(id).addEventListener('click',()=>{if(selected().length){form.hidden=false;document.querySelector('#order-success').hidden=true;}});
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
update();
