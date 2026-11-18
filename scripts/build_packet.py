#!/usr/bin/env python3
"""Generate public, model-blind website data from existing human_judge_10_packet.json.

Example:
  python scripts/build_packet.py --input 'D:/Hydrology_SE/human/human_judge_10_packet.json'
Keep the private model key in a protected location: NEVER publish it.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--input',required=True,type=Path)
    p.add_argument('--max-source-chars',type=int,default=5500)
    args=p.parse_args()
    raw=json.loads(args.input.read_text(encoding='utf-8-sig'))
    questions=raw.get('questions') if isinstance(raw,dict) else raw
    if not isinstance(questions,list): raise SystemExit('Expected a list or {"questions": [...]}')
    flat=[]; mapping=[]
    for q in questions:
        if not isinstance(q,dict): continue
        for r in q.get('responses',[]):
            if not isinstance(r,dict) or not str(r.get('answer','')).strip():continue
            pos=len(flat)+1
            excerpts=[]
            for c in (q.get('retrieved_excerpts') or [])[:7]:
                if not isinstance(c,dict):continue
                excerpts.append({'citation_id':c.get('citation_id',len(excerpts)+1),'title':str(c.get('title') or 'Retrieved source'), 'text':str(c.get('text') or '')[:args.max_source_chars]})
            flat.append({'position':pos,'question':str(q.get('question') or ''),'answer':str(r['answer']),'sources':excerpts})
            mapping.append({'position':pos,'sn':q.get('sn'),'response_id':r.get('response_id')})
    if len(flat)!=30:raise SystemExit(f'Required 30 answers (10 questions x 3 models), found {len(flat)}. Run llm_judge_10.py to generate a complete packet.')
    out=ROOT/'frontend'/'data'/'evaluations.json'
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'schema_version':1,'count':30,'items':flat},ensure_ascii=False,indent=2),encoding='utf-8')
    private=ROOT/'private_mapping_DO_NOT_PUBLISH.json'
    private.write_text(json.dumps({'warning':'Never commit/publish this file. Join position -> sn/response_id -> model using human_judge_10_model_key.json','items':mapping},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'Created {out} ({len(flat)} blinded answers)')
    print(f'PRIVATE mapping: {private}')
    print('Do not publish source model key or private_mapping_DO_NOT_PUBLISH.json.')

if __name__=='__main__':main()
