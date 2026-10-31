// Sample offers, not supplier inventory. Scientific names are reference-search terms.
export const catalog=[
 ['basil','Genovese basil','Ocimum basilicum','Herbs','Seeds',325,40,'basil','A packet of aromatic basil seeds for a sunny herb garden.'],
 ['basil-plants','Genovese basil seedlings','Ocimum basilicum','Herbs','Seedlings',600,24,'basil','A pack of four young basil plants.'],
 ['mint','Spearmint','Mentha spicata','Herbs','Seedlings',550,18,'basil','One young plant; grow in a container to manage spreading.'],
 ['parsley','Flat-leaf parsley','Petroselinum crispum','Herbs','Seeds',300,35,'basil','A seed packet for a fresh culinary herb garden.'],
 ['cilantro','Cilantro','Coriandrum sativum','Herbs','Seeds',275,45,'basil','A packet of coriander seeds for leaf or seed harvest.'],
 ['dill','Bouquet dill','Anethum graveolens','Herbs','Seeds',300,30,'basil','A seed packet for feathery foliage and summer flowers.'],
 ['rosemary','Rosemary','Salvia rosmarinus','Herbs','Seedlings',750,12,'basil','A young rosemary plant for a bright growing spot.'],
 ['thyme','Common thyme','Thymus vulgaris','Herbs','Seeds',325,28,'basil','A packet of seeds for a small perennial herb.'],
 ['tomato','Cherry tomato','Solanum lycopersicum','Vegetables','Seeds',450,40,'sprout','Twenty seeds for a warm-season vegetable garden.'],
 ['tomato-plants','Cherry tomato starts','Solanum lycopersicum','Vegetables','Seedlings',800,16,'sprout','A pair of young tomato plants for transplanting after frost.'],
 ['pepper','Sweet bell pepper','Capsicum annuum','Vegetables','Seeds',425,35,'sprout','A packet of seeds for a warm, sunny growing season.'],
 ['pepper-plants','Bell pepper starts','Capsicum annuum','Vegetables','Seedlings',800,14,'sprout','Two young pepper plants for your summer garden.'],
 ['lettuce','Butterhead lettuce','Lactuca sativa','Vegetables','Seeds',300,60,'basil','A packet of seeds for a cool-season leafy crop.'],
 ['kale','Curly kale','Brassica oleracea','Vegetables','Seeds',350,45,'basil','A packet of seeds for leafy greens.'],
 ['radish','Cherry Belle radish','Raphanus sativus','Vegetables','Seeds',275,50,'sprout','A packet of seeds for a cool-season root crop.'],
 ['carrot','Nantes carrot','Daucus carota','Vegetables','Seeds',325,45,'sprout','A packet of carrot seeds for loose, prepared soil.'],
 ['cucumber','Slicing cucumber','Cucumis sativus','Vegetables','Seeds',400,30,'sprout','A packet of seeds for a warm-season climbing crop.'],
 ['zinnia','Garden zinnia mix','Zinnia elegans','Flowers','Seeds',350,40,'sprout','A packet of mixed-color annual flower seeds.'],
 ['sunflower','Sunflower','Helianthus annuus','Flowers','Seeds',400,35,'sprout','A packet of seeds for sunny annual blooms.'],
 ['marigold','French marigold','Tagetes patula','Flowers','Seeds',300,40,'sprout','A packet of compact annual flower seeds.'],
 ['coneflower','Purple coneflower','Echinacea purpurea','Flowers','Seeds',425,25,'sprout','A packet of perennial flower seeds; review species germination requirements.'],
 ['monstera','Monstera cutting','Monstera deliciosa','Houseplants','Seedlings',1200,8,'monstera','One rooted cutting for a new indoor growing chapter.'],
 ['pothos','Golden pothos cutting','Epipremnum aureum','Houseplants','Seedlings',650,18,'monstera','One rooted cutting. Keep ornamental plants away from pets and children.'],
 ['spider','Spider plant starter','Chlorophytum comosum','Houseplants','Seedlings',700,16,'monstera','One small rooted plant for an indoor collection.']
].map(([sku,name,species,category,type,price,stock,image,description])=>({sku,name,species,category,type,price,stock,image,description,sample:true,inventorySource:'Sproutly sample catalog',currency:'USD',packSize:type==='Seeds'?'Seed packet':'Starter plant / pack',referenceUrl:'https://www.gbif.org/species/search?q='+encodeURIComponent(species)}));
export async function searchPlants(query,{fetchImpl=fetch}={}){
 const url=new URL('https://api.gbif.org/v1/species/search');url.searchParams.set('q',query);url.searchParams.set('rank','SPECIES');url.searchParams.set('highertaxonKey','6');url.searchParams.set('limit','12');
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Plant reference lookup is unavailable. Please retry.');const data=await response.json();
 const seen=new Set();return(data.results||[]).filter(r=>r.kingdom==='Plantae'&&!seen.has(r.canonicalName)&&seen.add(r.canonicalName)).map(r=>({id:r.key,name:r.canonicalName||r.scientificName,scientificName:r.scientificName,family:r.family||'Unknown',status:r.taxonomicStatus,source:'GBIF',sourceUrl:`https://www.gbif.org/species/${r.key}`,retrievedAt:new Date().toISOString(),forSale:false}));
}
