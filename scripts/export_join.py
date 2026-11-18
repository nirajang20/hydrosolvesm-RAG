#!/usr/bin/env python3
"""Join Wrangler D1 JSON export to blinded position and private LLM model keys.
Usage: python scripts/export_join.py --ratings ratings_export.json --mapping private_mapping_DO_NOT_PUBLISH.json --model-key human_judge_10_model_key.json --out merged_human_ratings.csv
"""
import argparse,csv,json
from pathlib import Path

def read_json(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def main():
    p=argparse.ArgumentParser();p.add_argument('--ratings',required=True);p.add_argument('--mapping',required=True);p.add_argument('--model-key',required=True);p.add_argument('--out',default='merged_human_ratings.csv');args=p.parse_args()
    rows=read_json(args.ratings)
    # Wrangler JSON output can contain an array of response objects or a direct results list.
    if isinstance(rows,list) and rows and isinstance(rows[0],dict) and 'results' in rows[0]:rows=rows[0]['results']
    elif isinstance(rows,dict):rows=rows.get('results',[])
    mapping={int(x['position']):x for x in read_json(args.mapping)['items']}
    key=read_json(args.model_key)
    lookup={(str(x['sn']),str(x['response_id'])):x['model'] for x in key['mapping']}
    output=[]
    for r in rows:
        m=mapping.get(int(r['position']))
        if not m:raise ValueError(f'Unknown position {r["position"]}')
        model=lookup.get((str(m['sn']),str(m['response_id'])))
        if not model:raise ValueError(f'Missing private model identity for {m}')
        output.append({'participant_id':r['participant_id'],'position':r['position'],'question_sn':m['sn'],'response_id':m['response_id'],'model':model,**{k:r.get(k) for k in ('correctness','groundedness','completeness','relevance','comment','updated_at')}})
    if not output:raise SystemExit('No ratings in export')
    with open(args.out,'w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=list(output[0]));w.writeheader();w.writerows(output)
    print(f'Wrote {len(output)} ratings to {args.out}')
if __name__=='__main__':main()
