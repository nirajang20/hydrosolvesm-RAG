#!/usr/bin/env python3
"""Build a 10-question, 3-blinded-response-per-question web packet.

Run from repository root:
 python scripts/build_packet.py --input D:/Hydrology_SE/human/human_judge_10_packet.json

IMPORTANT: keep human_judge_10_model_key.json and private_mapping_DO_NOT_PUBLISH.json
outside the public frontend and never commit either. Running this on a live
study changes answer-position mappings; only rebuild before enrolling raters.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--max-source-chars', type=int, default=5500)
    args = parser.parse_args()
    raw = json.loads(args.input.read_text(encoding='utf-8-sig'))
    questions = raw.get('questions') if isinstance(raw, dict) else raw
    if not isinstance(questions, list):
        raise SystemExit('Expected a list of questions or {"questions": [...]}')
    if len(questions) != 10:
        raise SystemExit(f'Expected exactly 10 source questions, got {len(questions)}')

    flat, mapping = [], []
    for q in questions:
        if not isinstance(q, dict) or not q.get('question'):
            raise SystemExit('Every question must include question text.')
        responses = q.get('responses')
        if not isinstance(responses, list) or len(responses) != 3:
            raise SystemExit(f'Question SN={q.get("sn")}: expected exactly 3 responses')
        seen = set()
        for response in responses:
            if not isinstance(response, dict) or not str(response.get('answer', '')).strip():
                raise SystemExit(f'Question SN={q.get("sn")}: missing answer')
            response_id = str(response.get('response_id', '')).strip()
            if not response_id or response_id in seen:
                raise SystemExit(f'Question SN={q.get("sn")}: duplicate/missing blinded response_id')
            seen.add(response_id)
            position = len(flat) + 1
            excerpts = []
            for chunk in (q.get('retrieved_excerpts') or [])[:7]:
                if not isinstance(chunk, dict):
                    continue
                excerpts.append({
                    'citation_id': chunk.get('citation_id', len(excerpts) + 1),
                    'title': str(chunk.get('title') or 'Retrieved source'),
                    'text': str(chunk.get('text') or '')[:args.max_source_chars],
                })
            flat.append({
                'position': position,
                'sn': q.get('sn'),
                'response_id': response_id,
                'question': str(q['question']),
                'out_of_scope': bool(q.get('out_of_scope', q.get('link') is None)),
                'answer': str(response['answer']),
                'sources': excerpts,
            })
            mapping.append({'position': position, 'sn': q.get('sn'), 'response_id': response_id})

    if len(flat) != 30:
        raise SystemExit(f'Expected 30 model answers, got {len(flat)}')
    output = ROOT / 'frontend' / 'data' / 'evaluations.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({'schema_version': 2, 'question_count': 10, 'count': 30, 'items': flat}, ensure_ascii=False, indent=2), encoding='utf-8')
    private = ROOT / 'private_mapping_DO_NOT_PUBLISH.json'
    private.write_text(json.dumps({'warning': 'Do not commit this file. Join position→sn/response_id→model with human_judge_10_model_key.json', 'items': mapping}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Created {output} with 10 questions and 30 blinded answers.')
    print(f'Created PRIVATE mapping {private} (never upload to GitHub).')
    print('The model names and GPT-OSS scores were not included in public frontend data.')

if __name__ == '__main__':
    main()
