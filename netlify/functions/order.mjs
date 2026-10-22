const prices = {lever:95000,'rubber-15':4000,'rubber-20':4000,'rubber-25':4000,'rubber-30':4000,'rubber-35':4000};
export function validate(body) {
  if (!body || typeof body !== 'object' || !/^[a-f0-9-]{36}$/.test(body.requestId || '')) throw Error('올바르지 않은 주문 요청입니다.');
  const customer = {};
  const limits = {name:60,phone:30,address:200,addressDetail:200};
  for (const [key,max] of Object.entries(limits)) {
    if (typeof body.customer?.[key] !== 'string') throw Error('배송 정보를 확인해 주세요.');
    customer[key] = body.customer[key].trim();
    if (customer[key].length > max || (key !== 'addressDetail' && !customer[key])) throw Error('배송 정보를 확인해 주세요.');
  }
  if (!/^0\d{8,10}$/.test(customer.phone.replace(/[\s-]/g,''))) throw Error('연락처를 확인해 주세요.');
  // Preserve the existing sheet schema without collecting removed checkout fields.
  customer.recipient = customer.name;
  customer.postcode = '';
  customer.note = '';
  if (body.consent !== true) throw Error('개인정보 수집·이용 동의가 필요합니다.');
  const quantities = {};
  if (!body.quantities || Object.keys(body.quantities).some(k=>!(k in prices))) throw Error('상품 정보를 확인해 주세요.');
  let total = 0;
  for (const [id,price] of Object.entries(prices)) {
    const q = body.quantities[id] ?? 0;
    if (!Number.isInteger(q) || q < 0 || q > 99) throw Error('수량은 상품별 0~99개로 입력해 주세요.');
    quantities[id] = q; total += q*price;
  }
  if (!total) throw Error('상품을 선택해 주세요.');
  return {requestId:body.requestId,customer,quantities,total,shippingFee:4000,grandTotal:total+4000,consent:true};
}
export async function handler(event) {
  const reply = (statusCode, data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
  if (event.httpMethod !== 'POST') return reply(405,{error:'POST 요청만 지원합니다.'});
  if (!process.env.ORDER_SCRIPT_URL || !process.env.ORDER_SHARED_SECRET) return reply(503,{error:'주문 접수 준비 중입니다. 잠시 후 다시 이용해 주세요.'});
  if ((event.body || '').length > 12000) return reply(413,{error:'주문 정보가 너무 깁니다.'});
  let order;
  try {order = validate(JSON.parse(event.body));} catch(e) {return reply(400,{error:e instanceof SyntaxError?'주문 형식을 확인해 주세요.':e.message});}
  try {
    const url = new URL(process.env.ORDER_SCRIPT_URL);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !url.pathname.endsWith('/exec')) throw Error('config');
    const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...order,secret:process.env.ORDER_SHARED_SECRET}),signal:AbortSignal.timeout(20000)});
    const data = await response.json();
    if (!response.ok || !data.ok || !/^CDP-[A-Z0-9-]+$/.test(data.orderId) || data.total !== order.total) throw Error('save');
    if (data.shippingFee !== null && (data.shippingFee !== 4000 || data.grandTotal !== data.total + 4000)) throw Error('shipping');
    return reply(200,{ok:true,orderId:data.orderId,total:data.total,shippingFee:data.shippingFee,grandTotal:data.grandTotal});
  } catch {return reply(502,{error:'주문 결과를 확인하지 못했습니다. 입력 내용을 유지한 채 다시 주문하기를 눌러 주세요. 같은 주문은 중복 저장되지 않습니다.'});}
}
