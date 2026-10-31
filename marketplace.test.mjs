import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchMarketplace} from './marketplace.mjs';
test('merchant prices preserve currency units, variant ranges, source URLs and real availability',async()=>{
 const p={id:4,name:'Basil &amp; seeds',permalink:'https://strictlymedicinalseeds.com/product/basil/',images:[{thumbnail:'https://strictlymedicinalseeds.com/basil.jpg'}],prices:{price:'514',currency_code:'USD',currency_minor_unit:2,price_range:{min_amount:'514',max_amount:'1000'}},has_options:true,is_in_stock:false,is_purchasable:false};
 const data=await searchMarketplace('basil',{page:2,fetchImpl:async(url)=>{assert.equal(url.searchParams.get('search'),'basil');assert.equal(url.searchParams.get('page'),'2');return new Response(JSON.stringify([p,{...p,permalink:'https://evil.example/product'}]),{headers:{'x-wp-totalpages':'3'}})}});
 assert.equal(data.results.length,1);assert.equal(data.results[0].price,514);assert.equal(data.results[0].minorUnit,2);assert.equal(data.results[0].priceMax,1000);assert.equal(data.results[0].sample,false);assert.equal(data.results[0].inStock,false);assert.equal(data.hasMore,true);assert.equal(data.checkout,'merchant-website');
});
test('merchant failures never become sample listings or invented prices',async()=>{
 await assert.rejects(searchMarketplace('basil',{fetchImpl:async()=>new Response('{}',{status:503})}),/unavailable/);
 await assert.rejects(searchMarketplace('basil',{fetchImpl:async()=>new Response('{}')}),/invalid catalog/);
 const data=await searchMarketplace('basil',{fetchImpl:async()=>new Response(JSON.stringify([{id:5,name:'Basil',permalink:'https://strictlymedicinalseeds.com/product/basil/',prices:{price:'invalid',currency_code:'USD',currency_minor_unit:2},images:[{src:'javascript:alert(1)'}]}]))});assert.equal(data.results[0].price,null);assert.equal(data.results[0].inStock,null);assert.equal(data.results[0].imageUrl,null);
});
