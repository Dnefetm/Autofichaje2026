const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    const { data, error } = await supabase
        .from('skus')
        .select(`
            sku, 
            name, 
            brand, 
            inventory_snapshot(physical_stock),
            sku_marketplace_mapping(marketplace_id, external_item_id)
        `)
        .limit(10);
    console.log("Error:", error);
    console.log("Data length:", data ? data.length : 0);
}
test();
