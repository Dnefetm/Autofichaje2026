import json

def update_blueprint():
    with open('supabase/migrations/20260815140000_fix_kong_timeout_triggers.sql', 'r', encoding='utf-8') as f:
        sql = f.read()
    
    # Extract just the function body (between AS $function$ and $function$;)
    start_str = "AS $function$"
    end_str = "$function$;"
    
    start_idx = sql.find(start_str) + len(start_str)
    end_idx = sql.find(end_str)
    
    func_body = sql[start_idx:end_idx]
    
    with open('docs/db_flow_blueprint.json', 'r', encoding='utf-8') as f:
        blueprint = json.load(f)
        
    blueprint['functions']['public.fn_resolver_y_poblar_costos']['source_sql'] = func_body
    
    with open('docs/db_flow_blueprint.json', 'w', encoding='utf-8') as f:
        json.dump(blueprint, f, indent=2, ensure_ascii=False)
        
if __name__ == '__main__':
    update_blueprint()
    print("Updated blueprint successfully.")
