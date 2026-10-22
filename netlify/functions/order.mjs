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
  // Report only a fixed diagnostic code; never expose upstream HTML, credentials or customer data.
  let stage = 'CONFIG';
  try {
    const url = new URL(process.env.ORDER_SCRIPT_URL.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !url.pathname.endsWith('/exec')) throw Error('config');
    stage = 'CONNECTION';
    const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...order,secret:process.env.ORDER_SHARED_SECRET}),signal:AbortSignal.timeout(20000)});
    stage = 'GOOGLE_HTTP';
    if (!response.ok) throw Error('http');
    stage = 'GOOGLE_RESPONSE';
    const data = await response.json();
    stage = 'SCRIPT_REJECTED';
    if (!data || data.ok !== true) throw Error('script');
    stage = 'ORDER_NUMBER';
    if (typeof data.orderId !== 'string' || !/^CDP-[A-Z0-9-]+$/.test(data.orderId)) throw Error('id');
    stage = 'SUBTOTAL';
    if (data.total !== order.total) throw Error('total');
    stage = 'SHIPPING';
    if (data.shippingFee !== null && (data.shippingFee !== 4000 || data.grandTotal !== data.total + 4000)) throw Error('shipping');
    return reply(200,{ok:true,orderId:data.orderId,total:data.total,shippingFee:data.shippingFee,grandTotal:data.grandTotal});
  } catch (error) {
    const code = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'TIMEOUT' : stage;
    console.warn('CDP_ORDER_RESPONSE_' + code);
    const messages = {
      CONFIG: '주문 서버의 구글 웹 앱 주소 설정을 확인해야 합니다.',
      CONNECTION: '구글 주문 서버에 연결하지 못했습니다.',
      GOOGLE_HTTP: '구글 주문 서버가 오류 응답을 반환했습니다.',
      GOOGLE_RESPONSE: '구글 응답이 주문 데이터 형식이 아닙니다. 웹 앱 배포 권한과 실행 오류를 확인해야 합니다.',
      SCRIPT_REJECTED: 'Apps Script가 주문 처리 성공을 반환하지 않았습니다. 스크립트 설정과 시트 구조를 확인해야 합니다.',
      ORDER_NUMBER: '저장 응답의 주문번호 형식을 확인해야 합니다.',
      SUBTOTAL: '시트 저장 응답의 상품 금액과 주문 금액이 다릅니다.',
      SHIPPING: '시트 저장 응답의 배송비 또는 총 주문 금액이 현재 사이트와 다릅니다.',
      TIMEOUT: '구글 주문 서버의 응답 시간이 초과되었습니다.'
    };
    return reply(502,{code,error:messages[code] + ' [진단 코드: ' + code + '] 이미 시트에 기록됐다면 주문을 새로 작성하지 말고 판매자에게 저장 여부를 확인해 주세요.'});
  }
}
