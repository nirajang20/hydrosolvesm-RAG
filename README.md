# SDSU Water Ask · Human Evaluation Website

A static GitHub Pages frontend with a Cloudflare Worker + D1 backend. No framework, no build step, no server for the frontend. The study presents **30 blinded candidate answers** (10 questions × 3 models), four 1–5 rating dimensions, expandable retrieved-source excerpts, and optional comments. Evaluators enter initials, name, email, affiliation, and acknowledge the research privacy notice.

## Architecture

- `frontend/`: public GitHub Pages site; two large homepage choices: project-learning SharePoint link and **Evaluate Responses**.
- `worker/`: Cloudflare Worker API storing evaluator information and ratings in D1, with bearer resume tokens.
- `scripts/build_packet.py`: converts `human_judge_10_packet.json` into **public, blinded** `frontend/data/evaluations.json` and a **private** position mapping.
- Cloudflare **D1** is the database; no Cloudflare API keys appear in frontend JavaScript.
- **Do not publish** GPT-OSS results, the original private model key, name/email exports, or `private_mapping_DO_NOT_PUBLISH.json`.

## 1. Generate the 30 survey items (locally)

After running your existing `llm_judge_10.py`:

```powershell
cd D:\Hydrology_SE\human
python build_packet.py --input "D:\Hydrology_SE\human\human_judge_10_packet.json"
```

`build_packet.py` lives in this project's `scripts` directory, so from that directory run:

```powershell
cd D:\Hydrology_SE\sdsu-rag-human-eval
python scripts\build_packet.py --input "D:\Hydrology_SE\human\human_judge_10_packet.json"
```

Output: `frontend/data/evaluations.json`, containing real questions, real responses, numbered source excerpts, and **no model labels**. The script requires exactly 30 responses and will stop on missing data. The private mapping is written to `private_mapping_DO_NOT_PUBLISH.json` in this project root. This file is gitignored.

**IMPORTANT:** The original RAG packet shares retrieved excerpts among the three answers to a question because retrieval is model-independent in your backend. The website preserves this design. The intentionally out-of-scope question (`link: null`) is shown to human judges without labeling it out-of-scope, to preserve independent evaluation. If there are no excerpts, that is disclosed.

## 2. Configure Cloudflare D1 and Worker

Install Node.js (18+), then in this project's `worker/` directory:

```powershell
cd worker
npx wrangler login
npx wrangler d1 create sdsu-rag-human-eval
```

Copy the returned `database_id` into `worker/wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

Set `ALLOWED_ORIGIN` to the **exact frontend origin**. For a normal GitHub Pages repo it will be `https://YOUR-GITHUB-USERNAME.github.io` (without a repo path). For a custom domain set that domain instead. This is a CORS allowlist, not user authentication.

```powershell
npx wrangler d1 execute sdsu-rag-human-eval --remote --file=./schema.sql
npx wrangler deploy
```

Record the deployed URL, e.g. `https://sdsu-rag-human-eval-api.YOUR-SUBDOMAIN.workers.dev`.

Edit `frontend/config.js` with this exact URL (without trailing slash):

```js
window.EVAL_API_BASE = 'https://sdsu-rag-human-eval-api.YOUR-SUBDOMAIN.workers.dev';
```

## 3. Publish site with GitHub Pages

Create a new **public** GitHub repository. Commit the **contents of `frontend/`** to the GitHub repository's root. This keeps the Cloudflare backend source and private files off the public site.

In GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**, and save. The site will be at:

`https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPO-NAME/`

GitHub Pages serves the `index.html`, `style.css`, `app.js`, `config.js`, and `data/evaluations.json` files. No server credentials are published.

### Important: GitHub Pages is publicly readable

Anyone who knows your published URL can read the blinded 30 candidate answers and retrieved source excerpts. **Do not upload evaluator data, model-identification keys, or confidential source material.** Make sure your source excerpts may be published in this context. The Cloudflare Worker validates the allowed browser origin and uses per-participant bearer tokens for data access, but this setup is intended for a small supervised research pilot, not high-assurance identity verification or abuse resistance.

## 4. Test the workflow

1. Open the homepage. The **Learn about the RAG** card opens your provided SharePoint resource in a new tab. Check SharePoint permissions allow evaluators to access it.
2. Click **Evaluate AI responses**. Enter initials, name, email, affiliation, and acknowledge the notice.
3. Score response 01, **Save & next**, and confirm progress advances. Reload, reopen evaluation, and confirm prior ratings are restored on the same browser/device.
4. Repeat for 30. Review and submit; submitted ratings become read-only.
5. See data in Cloudflare Dashboard → D1 → `sdsu-rag-human-eval`.

## 5. Export stored data

### Individual, model-blinded ratings (no names or emails)

From `worker/`:

```powershell
npx wrangler d1 execute sdsu-rag-human-eval --remote --command "SELECT participant_id, position, correctness, groundedness, completeness, relevance, comment, updated_at FROM ratings ORDER BY participant_id, position;" --json > ratings_export.json
```

### Completed evaluator counts

```powershell
npx wrangler d1 execute sdsu-rag-human-eval --remote --command "SELECT COUNT(*) AS completed FROM participants WHERE submitted_at IS NOT NULL;"
```

To identify the generating model for each score: join exported `position` to `private_mapping_DO_NOT_PUBLISH.json` (`position` → `sn` + `response_id`), then join to your original `human_judge_10_model_key.json` (`sn` + `response_id` → actual model). Keep both mapping files restricted to your research team. Remember to filter to **submitted** participants when doing final analysis; ratings from unfinished sessions will also be stored in D1.

## Privacy and limitations

- **Names/emails are personally identifying**, and initials are not anonymous. The site stores them in D1, separately from evaluation ratings, joined via `participant_id`. Access to Cloudflare's project must be restricted. Configure appropriate institutional review, consent, data retention, and privacy wording *before* enrolling participants.
- A resume token is stored in **the evaluator's browser localStorage**. Treat it as a password; anyone who has it can view/edit that evaluator's unsubmitted ratings. Losing browser storage means they cannot resume without administrator intervention. Avoid shared devices, and do not collect on untrusted kiosks.
- This version has no email confirmation, CAPTCHA, participant invitation codes, backup recovery, or reviewer sign-in. For an open public study, add Cloudflare Turnstile plus server-side rate limiting and invitation codes to mitigate unwanted submissions.
- The site does **not** automatically sync existing Qualtrics survey results. It is a separate evaluation collection system.
- Ensure Cloudflare D1 and GitHub Pages terms and your university data-security requirements allow this use, especially when collecting names and email addresses.

## Files

```
sdsu-rag-human-eval/
├─ frontend/
│  ├─ index.html
│  ├─ style.css
│  ├─ app.js
│  ├─ config.js
│  └─ data/evaluations.json  # generated real blinded items
├─ worker/
│  ├─ src.js
│  ├─ schema.sql
│  └─ wrangler.toml
├─ scripts/build_packet.py
├─ .gitignore
└─ README.md
```

### Automatic mapping script

After exporting ratings as JSON, run:

```powershell
python scripts\export_join.py --ratings ratings_export.json --mapping private_mapping_DO_NOT_PUBLISH.json --model-key "D:\Hydrology_SE\human\human_judge_10_model_key.json" --out merged_human_ratings.csv
```

This produces a research analysis CSV with `participant_id`, original question number, generator `model`, and the four human scores. Store the joined result privately.
