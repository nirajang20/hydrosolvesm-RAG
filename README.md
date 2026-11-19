# SDSU Water Ask — Side-by-Side Human Evaluation Portal

A small static **GitHub Pages** frontend with a **Cloudflare Worker + D1** backend. The landing page has two choices: **Learn about the RAG** (links to the provided SharePoint folder), and **Evaluate AI responses**.

## What's changed

- **10 pages / 10 source questions**. Every page displays **three anonymous answers (Models A, B, C)** side by side, rather than 30 separate question screens.
- Each anonymous answer has independently expandable retrieved sources, **four 1–5 star ratings**, and optional comments.
- Left panel explains Correctness, Groundedness, Completeness, Relevance. The out-of-scope question is still assessed for an appropriate evidence-limited refusal.
- **Save all 3 & Next** stores three separate rating rows for that question in Cloudflare D1. Back, page progress, existing saved ratings, resume, and final submission work without changing the database schema.
- Initials, full name, email, affiliation, and consent are collected in a separate registration page.
- LLM model identities and GPT-OSS judge results are **never placed in the public data file**.

## Project layout

```text
frontend/
  index.html               Static site with home, register, comparison and completion screens
  style.css                Responsive side-by-side layout
  app.js                   Frontend survey state and D1 API client
  config.js                Put your Worker URL here
  data/evaluations.json    Public blinded evaluation content, generated locally
worker/
  src.js                   Worker API: session, rating save, submit
  schema.sql               D1 participants and ratings tables
  wrangler.toml            Worker/D1 settings
scripts/
  build_packet.py          Converts existing blinded human packet to public site data
  export_join.py           Joins D1 export + private mapping + LLM key
.github/workflows/deploy.yml
```

## 1. Generate the live evaluation packet (on your Windows PC)

Copy the extracted project to a convenient location, for example `D:\Hydrology_SE\sdsu-rag-human-eval`. From that directory run:

```powershell
python scripts\build_packet.py --input "D:\Hydrology_SE\human\human_judge_10_packet.json"
```

This reads the blinded packet from the `llm_judge_10.py` pipeline and creates:

- `frontend/data/evaluations.json`: **safe to publish**; includes 10 questions / 30 answers, sources, `position`, `sn`, anonymous `response_id`.
- `private_mapping_DO_NOT_PUBLISH.json`: **NEVER upload or commit**; position -> `sn` / anonymous `response_id`.

Keep `D:\Hydrology_SE\human\human_judge_10_model_key.json` **private** as well; it maps `(sn, response_id)` to actual model. Both mappings together identify the original model for each position. **Do not rerun the converter or reorder responses after evaluators begin**, because saved D1 `position` values must keep referring to exactly the same response.

Your own private `human_judge_10_model_key.json` contains the real model names. A public response's displayed A/B/C position uses the original order from the blinded packet. Positions are 1–3 for question 1, 4–6 for question 2, and so on; model identities must always be found from the private key, not assumed from their position.

## 2. Cloudflare Worker + D1 (no new migration needed if already deployed)

The old D1 `participants` and `ratings` schema is **unchanged**. Each of the three ratings submitted from a question page is still stored separately with its unique `position` (1 to 30).

First-time setup:

```powershell
cd worker
npx wrangler login
npx wrangler d1 create sdsu-rag-human-eval
```

Paste the returned `database_id` into `worker/wrangler.toml`. Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact GitHub Pages site origin (e.g. `https://username.github.io`, without the repo path), then:

```powershell
npx wrangler d1 execute sdsu-rag-human-eval --remote --file=./schema.sql
npx wrangler deploy
```

If you already deployed the Worker and D1, **you do not need to recreate the database or change its tables**. Just ensure the Worker remains accessible and the `ALLOWED_ORIGIN` matches your GitHub Pages host.

## 3. Configure the GitHub Pages frontend

In `frontend/config.js`, set:

```javascript
window.EVAL_API_BASE = 'https://YOUR-REAL-WORKER.YOUR-SUBDOMAIN.workers.dev';
```

Upload the whole repository, including `.github/workflows/deploy.yml`, to GitHub (but **not private mapping, model keys, or GPT-OSS results**). In **Settings → Pages**, set **Source = GitHub Actions**. On push to `main`, the workflow deploys only `frontend/` (HTML/CSS/JS/data), not the Worker source, private mapping, or any research keys.

If you uploaded the frontend files directly into repo root rather than using a `frontend/` folder, move them under `frontend/` to match the workflow.

## 4. Evaluation process

1. Open public Pages link, click **Evaluate AI responses**.
2. Register initials, full name, email and affiliation, and acknowledge the study notice.
3. Each page shows one question with Models A/B/C. Judges read answers and expand supporting source excerpts when needed.
4. **Each of four metrics must be rated (1–5 stars)** before a response can be saved. Stars start unselected until clicked.
5. Click **Save all 3 & Next**. All three records save to D1; if a network request fails, successful saves remain and retry is possible.
6. Judges may return to prior questions and revise ratings before final submission.
7. After all 30 answers are saved, click **Submit evaluation**. The study is locked against further editing.

For the study, test with one participant first and verify one submission creates 30 rows in `ratings`.

## 5. Export and analyze collected scores

From `worker/` run:

```powershell
npx wrangler d1 execute sdsu-rag-human-eval --remote --json --command "SELECT participant_id, position, correctness, groundedness, completeness, relevance, comment, updated_at FROM ratings ORDER BY participant_id, position" > ratings_export.json
```

Then match the exported `position` to private response IDs and actual LLMs:

```powershell
python scripts\export_join.py --ratings worker\ratings_export.json --mapping private_mapping_DO_NOT_PUBLISH.json --model-key "D:\Hydrology_SE\human\human_judge_10_model_key.json" --out merged_human_ratings.csv
```

The resulting CSV has one row per participant × response, including the actual LLM model (kept private until after judging). The output belongs in a protected local folder, **not on GitHub Pages**.

## Privacy and deployment notes

- This system collects identifying information. Confirm the human-subject research/IRB and data handling requirements with SDSU before distributing a public survey.
- Cloudflare CORS restrictions are **not** an anti-spam or invitation system. The included Worker is a lightweight pilot, without rate limits, invitation verification, or abuse mitigation; add Cloudflare Turnstile/invitations for public high-volume deployment.
- Local browser session tokens allow resume on the same device; people can lose access if storage is erased. Session tokens must be protected as credentials.
- The page does **not** automatically submit until the evaluator explicitly finishes. Ratings are saved to D1 after each Save all 3 click.
- Never commit `private_mapping_DO_NOT_PUBLISH.json`, model keys, GPT-OSS judgments, participant exports, or D1 credentials.
