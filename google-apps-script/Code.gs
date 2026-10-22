// Connect this script to a dedicated Google spreadsheet. Configure Script Properties first.
const HEADERS = ['요청ID','주문번호','접수일시(KST)','주문자','받는분','연락처','우편번호','주소','상세주소','레버','고무15','고무20','고무25','고무30','고무35','상품합계','배송비','요청사항','개인정보동의','주문상태','입금확인','발송일','택배사','송장번호'];
function doPost(e) {
  const output = data => ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  let lock;
  try {
    const props = PropertiesService.getScriptProperties();
    const body = JSON.parse(e.postData.contents);
    const secret = props.getProperty('ORDER_SHARED_SECRET');
    if (!secret || body.secret !== secret) return output({ok:false});
    if (!/^[a-f0-9-]{36}$/.test(body.requestId || '') || body.consent !== true) return output({ok:false});
    const ids = ['lever','rubber-15','rubber-20','rubber-25','rubber-30','rubber-35'];
    const quantities = ids.map(id=>body.quantities?.[id]);
    if (quantities.some(q=>!Number.isInteger(q)||q<0||q>99)) return output({ok:false});
    const total = quantities.reduce((sum,q,i)=>sum+q*(i===0?95000:4000),0);
    if (!total || total !== body.total) return output({ok:false});
    const c = body.customer;
    if (!c || ['name','recipient','phone','postcode','address','addressDetail','note'].some(k=>typeof c[k]!=='string'||c[k].length>500)) return output({ok:false});
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    const spreadsheet = SpreadsheetApp.openById(props.getProperty('ORDER_SPREADSHEET_ID'));
    let sheet = spreadsheet.getSheetByName('CDP 주문');
    if (!sheet) {sheet=spreadsheet.insertSheet('CDP 주문');sheet.appendRow(HEADERS);sheet.setFrozenRows(1);}
    if (JSON.stringify(sheet.getRange(1,1,1,HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS)) return output({ok:false});
    // Append the new column without changing existing columns or historical orders.
    const totalHeader=sheet.getRange(1,25).getValue();
    if (!totalHeader) sheet.getRange(1,25).setValue('총 주문 금액');
    else if (totalHeader !== '총 주문 금액') return output({ok:false});
    if (sheet.getLastRow()>1) {
      const match=sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(body.requestId).matchEntireCell(true).findNext();
      if (match) {const row=sheet.getRange(match.getRow(),1,1,HEADERS.length).getValues()[0];const shippingFee=typeof row[16]==='number'?row[16]:null;return output({ok:true,orderId:row[1],total:Number(row[15]),shippingFee,grandTotal:shippingFee===null?null:Number(row[15])+shippingFee});}
    }
    const now = new Date();
    const orderId='CDP-'+Utilities.formatDate(now,'Asia/Seoul','yyyyMMdd')+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,12).toUpperCase();
    // Force untrusted text to a literal to prevent spreadsheet formula injection and preserve leading zeros.
    const literal = value => "'"+String(value);
    sheet.appendRow([body.requestId,orderId,Utilities.formatDate(now,'Asia/Seoul','yyyy-MM-dd HH:mm:ss'),...['name','recipient','phone','postcode','address','addressDetail'].map(k=>literal(c[k])),...quantities,total,4000,literal(c.note),'동의 v1','접수','미확인','','','',total+4000]);
    SpreadsheetApp.flush();
    return output({ok:true,orderId,total,shippingFee:4000,grandTotal:total+4000});
  } catch {return output({ok:false});} finally {if(lock && lock.hasLock())lock.releaseLock();}
}
