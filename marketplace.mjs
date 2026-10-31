// Read-only public merchant catalog. No credentials, carts, or orders are sent.
export const merchant={id:'strictly-medicinal',name:'Strictly Medicinal Seeds',url:'https://strictlymedicinalseeds.com',api:'https://strictlymedicinalseeds.com/wp-json/wc/store/v1/products'};
const safeUrl=(value,host)=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname===host?u.href:null}catch{return null}};
const plain=value=>String(value||'').replace(/<[^>]*>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff))).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").slice(0,250);
export async function searchMarketplace(query,{page=1,fetchImpl=fetch}={}){
 const url=new URL(merchant.api);url.searchParams.set('search',query);url.searchParams.set('per_page','12');url.searchParams.set('page',String(page));
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
 if(!response.ok)throw new Error(`Merchant catalog HTTP ${response.status}.`);
 const rows=await response.json();if(!Array.isArray(rows))throw new Error('The merchant returned an invalid catalog.');
 const retrievedAt=new Date().toISOString();
 const results=rows.map(p=>{
  const productUrl=safeUrl(p.permalink,'strictlymedicinalseeds.com');
  const prices=p.prices||{},minorUnit=prices.currency_minor_unit;
  const validPrice=v=>typeof v==='string'&&/^\d+$/.test(v)&&Number.isSafeInteger(Number(v))?Number(v):null;
  const price=validPrice(prices.price),priceMin=validPrice(prices.price_range?.min_amount),priceMax=validPrice(prices.price_range?.max_amount);
  return{id:String(p.id),name:plain(p.name),productUrl,imageUrl:safeUrl(p.images?.[0]?.thumbnail||p.images?.[0]?.src,'strictlymedicinalseeds.com'),merchant:merchant.name,source:'WooCommerce public Store API',sample:false,externalCheckout:true,price,currency:/^[A-Z]{3}$/.test(prices.currency_code)?prices.currency_code:null,minorUnit:Number.isInteger(minorUnit)&&minorUnit>=0&&minorUnit<=4?minorUnit:null,priceMin,priceMax,hasOptions:!!p.has_options,inStock:typeof p.is_in_stock==='boolean'?p.is_in_stock:null,purchasable:typeof p.is_purchasable==='boolean'?p.is_purchasable:null,retrievedAt};
 }).filter(p=>p.productUrl);
 const totalPages=Number(response.headers.get('x-wp-totalpages'))||1;
 return{results,merchant:{name:merchant.name,url:merchant.url},retrievedAt,page,hasMore:page<Math.min(totalPages,5),checkout:'merchant-website'};
}
