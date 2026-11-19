(() => {
  'use strict';

  const METRICS = [
    ['correctness', 'Correctness'],
    ['groundedness', 'Groundedness'],
    ['completeness', 'Completeness'],
    ['relevance', 'Relevance'],
  ];

  const SCALE_LABELS = {
    1: 'Very poor',
    2: 'Poor',
    3: 'Fair',
    4: 'Good',
    5: 'Excellent',
  };

  const TOKEN_KEY = 'sdsu_water_eval_token_v1';
  const $ = id => document.getElementById(id);

  let questions = [];
  let items = [];
  let current = 0;
  let session = null;
  let ratings = {};
  let drafts = {};
  let busy = false;
  let toastTimer = null;
  let lastOosPrompted = -1;

  function openOosModal() {
    const modal = $('oosModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const closeBtn = $('oosModalClose');
    if (closeBtn) closeBtn.focus();
  }

  function closeOosModal() {
    const modal = $('oosModal');
    if (modal) modal.classList.add('hidden');
  }

  function msg(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4300);
  }

  function show(view) {
    closeOosModal();
    if (view !== 'evaluation') lastOosPrompted = -1;
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    $(view).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\{(\d+)\}/g, '<span class="citation">{$1}</span>');
  }

  function md(s) {
    const lines = String(s || '').replace(/\r/g, '').split('\n');
    let out = '';
    let open = '';

    function close() {
      if (open) {
        out += `</${open}>`;
        open = '';
      }
    }

    function nextNonEmptyType(startIdx) {
      for (let i = startIdx; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (/^[-*+]\s+/.test(trimmed)) return 'ul';
        if (/^\d+[.)]\s+/.test(trimmed)) return 'ol';
        return 'other';
      }
      return 'eof';
    }

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      let m;
      if (!t) {
        // Keep ordered/unordered list open across blank lines when followed by another item of the same list
        if (open && nextNonEmptyType(i + 1) === open) continue;
        close();
        continue;
      }
      if ((m = t.match(/^#{1,4}\s+(.+)/))) {
        close();
        out += `<h3>${inline(m[1])}</h3>`;
      } else if ((m = t.match(/^[-*+]\s+(.+)/))) {
        if (open !== 'ul') {
          close();
          open = 'ul';
          out += '<ul>';
        }
        out += `<li>${inline(m[1])}</li>`;
      } else if ((m = t.match(/^\d+[.)]\s+(.+)/))) {
        if (open !== 'ol') {
          close();
          open = 'ol';
          out += '<ol>';
        }
        out += `<li>${inline(m[1])}</li>`;
      } else {
        close();
        out += `<p>${inline(t)}</p>`;
      }
    }

    close();
    return out || '<p>No answer available.</p>';
  }

  function apiBase() {
    return String(window.EVAL_API_BASE || '').replace(/\/$/, '');
  }

  async function api(path, method = 'GET', data) {
    const token = localStorage.getItem(TOKEN_KEY);
    const req = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) req.headers.Authorization = `Bearer ${token}`;
    if (data !== undefined) req.body = JSON.stringify(data);

    let response;
    try {
      response = await fetch(apiBase() + path, req);
    } catch {
      throw Error('Cannot reach Cloudflare API. Check connection and Worker URL.');
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Error(body.error || `Request failed: ${response.status}`);
    }
    return body;
  }

  function normalizeRating(row) {
    if (!row) return null;
    const out = {
      position: Number(row.position),
      comment: String(row.comment || ''),
    };
    for (const [key] of METRICS) {
      const v = Number(row[key]);
      out[key] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
    }
    return out;
  }

  async function load() {
    try {
      const response = await fetch('data/evaluations.json', { cache: 'no-store' });
      if (!response.ok) throw Error('Evaluation packet not found');
      const data = await response.json();
      if (!Array.isArray(data.items) || data.items.length !== 30) {
        throw Error('Generate your 30-response packet using scripts/build_packet.py before deploying.');
      }
      items = data.items;

      const groups = new Map();
      for (const item of items) {
        const key = String(item.sn ?? item.question);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      questions = [...groups.values()];

      if (
        questions.length !== 10 ||
        questions.some(
          g =>
            g.length !== 3 ||
            new Set(g.map(x => x.position)).size !== 3 ||
            new Set(g.map(x => x.response_id)).size !== 3
        )
      ) {
        throw Error('Packet must contain 10 questions with 3 distinct responses each. Regenerate the packet.');
      }

      if (apiBase().includes('YOUR-WORKER') || !apiBase().startsWith('https://')) {
        throw Error('Set your deployed Cloudflare Worker URL in frontend/config.js.');
      }
    } catch (e) {
      $('setupError').textContent = e.message;
      show('setup');
    }
  }

  function groupDone(i) {
    return questions[i].every(x => Boolean(ratings[x.position]));
  }

  function isPositionChanged(position) {
    const d = drafts[position];
    if (!d) return false;
    const old = ratings[position];
    if (!old) {
      return METRICS.some(([m]) => d[m] !== null) || Boolean(d.comment);
    }
    return (
      METRICS.some(([m]) => Number(old[m]) !== d[m]) ||
      (old.comment || '') !== d.comment
    );
  }

  function changed() {
    if (!questions.length) return false;
    return questions[current].some(item => isPositionChanged(item.position));
  }

  function saveDraft() {
    if (!questions.length || !document.querySelector('[data-position]')) return;
    for (const item of questions[current]) {
      const card = document.querySelector(`[data-position="${item.position}"]`);
      if (!card) continue;
      const result = {
        comment: card.querySelector('textarea').value,
      };
      for (const [key] of METRICS) {
        const choice = card.querySelector(`input[type="radio"][data-metric="${key}"]:checked`);
        result[key] = choice ? Number(choice.value) : null;
      }
      drafts[item.position] = result;
      updateCardMeta(card, item.position);
    }
    updateBottomFeedback();
  }

  function updateCardMeta(card, position) {
    const d = drafts[position] || ratings[position] || {};
    const ratedCount = METRICS.filter(([key]) => Number.isInteger(d[key]) && d[key] >= 1 && d[key] <= 5).length;

    const counter = card.querySelector('.rating-counter');
    if (counter) {
      counter.textContent = ratedCount === 4 ? '4 / 4 rated ✓' : `${ratedCount} / 4 rated`;
      counter.classList.toggle('is-complete', ratedCount === 4);
    }

    const indicator = card.querySelector('.saved-indicator');
    if (indicator) {
      const hasSaved = Boolean(ratings[position]);
      const dirty = isPositionChanged(position);
      if (hasSaved && !dirty) {
        indicator.textContent = '✓ Saved';
        indicator.className = 'saved-indicator is-saved';
      } else if (hasSaved && dirty) {
        indicator.textContent = 'Unsaved edits';
        indicator.className = 'saved-indicator is-unsaved';
      } else if (dirty) {
        indicator.textContent = 'Unsaved';
        indicator.className = 'saved-indicator is-unsaved';
      } else {
        indicator.textContent = '';
        indicator.className = 'saved-indicator';
      }
    }
  }

  function updateBottomFeedback() {
    const feedback = $('saveFeedback');
    if (!feedback || busy) return;
    if (changed()) {
      feedback.textContent = 'Unsaved changes on this page';
    } else if (groupDone(current)) {
      feedback.textContent = '✓ All three responses saved';
    } else {
      feedback.textContent = 'Rate all 3 responses to save and continue';
    }
  }

  function updateStarVisuals(groupEl, selectedValue, hoverValue = 0) {
    const activeLevel = hoverValue > 0 ? hoverValue : selectedValue;
    const isPreview = hoverValue > 0;
    groupEl.dataset.value = String(selectedValue || 0);

    groupEl.querySelectorAll('.star-option').forEach(opt => {
      const starNum = Number(opt.dataset.star);
      opt.classList.toggle('is-preview', isPreview && starNum <= hoverValue);
      opt.classList.toggle('is-filled', !isPreview && starNum <= selectedValue);
    });

    const badge = groupEl.closest('.star-metric')?.querySelector('.star-score-badge');
    if (badge) {
      if (isPreview) {
        badge.textContent = `${hoverValue} / 5 · ${SCALE_LABELS[hoverValue]}`;
        badge.classList.add('is-preview');
        badge.classList.remove('is-rated');
      } else if (activeLevel >= 1 && activeLevel <= 5) {
        badge.textContent = `${activeLevel} / 5 · ${SCALE_LABELS[activeLevel]}`;
        badge.classList.add('is-rated');
        badge.classList.remove('is-preview');
      } else {
        badge.textContent = 'Not rated';
        badge.classList.remove('is-rated', 'is-preview');
      }
    }
  }

  function renderStarMetric(item, modelLetter, key, label, savedVal) {
    const val = Number.isInteger(Number(savedVal)) && Number(savedVal) >= 1 && Number(savedVal) <= 5
      ? Number(savedVal)
      : 0;
    const badgeText = val ? `${val} / 5 · ${SCALE_LABELS[val]}` : 'Not rated';

    const stars = [1, 2, 3, 4, 5].map(v => `
      <label class="star-option${v <= val ? ' is-filled' : ''}" data-star="${v}" title="${v} star${v > 1 ? 's' : ''} — ${SCALE_LABELS[v]}">
        <input
          type="radio"
          name="rating-${item.position}-${key}"
          value="${v}"
          data-metric="${key}"
          ${val === v ? 'checked' : ''}
          aria-label="Model ${modelLetter} ${label}: ${v} out of 5 (${SCALE_LABELS[v]})"
        >
        <svg class="star-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.4l2.92 5.92 6.53.95-4.72 4.6 1.12 6.5L12 17.3l-5.85 3.07 1.12-6.5-4.72-4.6 6.53-.95L12 2.4z"/>
        </svg>
      </label>
    `).join('');

    return `
      <div class="star-metric" data-metric-wrap="${key}">
        <div class="star-metric-head">
          <span class="star-metric-label" id="label-${item.position}-${key}">${label}</span>
          <span class="star-score-badge${val ? ' is-rated' : ''}" id="value-${item.position}-${key}">${badgeText}</span>
        </div>
        <div
          class="star-group"
          role="radiogroup"
          aria-labelledby="label-${item.position}-${key}"
          data-metric="${key}"
          data-value="${val}"
        >
          ${stars}
        </div>
      </div>
    `;
  }

  function render() {
    const group = questions[current];
    const isOutOfScope = Boolean(group[0].out_of_scope) || current === 8;
    $('questionTitle').textContent = group[0].question;
    $('responseCounter').textContent = `QUESTION ${String(current + 1).padStart(2, '0')} OF 10`;
    $('progressCount').textContent = `${Object.keys(ratings).length} / 30 saved ratings`;
    $('outOfScopeBanner').classList.toggle('hidden', !isOutOfScope);
    $('outOfScopeNote').classList.toggle('is-highlighted', isOutOfScope);

    $('questionProgress').replaceChildren();
    for (let i = 0; i < 10; i++) {
      const done = groupDone(i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'page-segment' + (i === current ? ' current' : '') + (done ? ' done' : '');
      b.textContent = done ? `Q${i + 1} ✓` : `Q${i + 1}`;
      b.title = `Question ${i + 1}${done ? ' (saved)' : ''}`;
      b.setAttribute('aria-label', b.title);
      if (i === current) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', () => changePage(i));
      $('questionProgress').appendChild(b);
    }

    $('modelColumns').innerHTML = group.map((item, j) => {
      const modelLetter = 'ABC'[j];
      const saved = drafts[item.position] || ratings[item.position] || {};
      const sources = Array.isArray(item.sources) ? item.sources : [];

      return `
        <article class="model-card" data-position="${item.position}">
          <div class="model-header">
            <span class="model-tag">MODEL ${modelLetter}</span>
            <small>Anonymous response</small>
            <span class="saved-indicator"></span>
          </div>

          <div class="model-answer">${md(item.answer)}</div>

          <details class="model-sources">
            <summary>
              <span>Retrieved sources (${sources.length})</span>
              <span class="sources-chevron" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m6 8 4 4 4-4"/>
                </svg>
              </span>
            </summary>
            <div class="model-source-content">
              ${
                sources.length
                  ? sources.map(src => `
                      <div class="source-item">
                        <strong>Source {${esc(src.citation_id)}} · ${esc(src.title)}</strong>
                        <p>${esc(src.text)}</p>
                      </div>
                    `).join('')
                  : '<p>No retrieved source excerpts were recorded.</p>'
              }
            </div>
          </details>

          <div class="model-rating">
            <div class="rating-head">
              <div class="rating-eyebrow">RATE THIS RESPONSE</div>
              <span class="rating-counter">0 / 4 rated</span>
            </div>

            <div class="star-metrics">
              ${METRICS.map(([key, label]) => renderStarMetric(item, modelLetter, key, label, saved[key])).join('')}
            </div>

            <label class="comment-label" for="comment-${item.position}">
              Additional comments <span>(optional)</span>
            </label>
            <textarea
              id="comment-${item.position}"
              rows="3"
              maxlength="3000"
              placeholder="Errors, missing information, or feedback..."
            ></textarea>
          </div>
        </article>
      `;
    }).join('');

    for (const item of group) {
      const card = document.querySelector(`[data-position="${item.position}"]`);
      const saved = drafts[item.position] || ratings[item.position] || {};
      const textarea = card.querySelector('textarea');
      textarea.value = saved.comment || '';
      textarea.addEventListener('input', saveDraft);

      card.querySelectorAll('.star-group').forEach(groupEl => {
        const getSelected = () => {
          const checked = groupEl.querySelector('input[type="radio"]:checked');
          return checked ? Number(checked.value) : 0;
        };

        groupEl.querySelectorAll('.star-option').forEach(opt => {
          const starNum = Number(opt.dataset.star);
          opt.addEventListener('pointerenter', e => {
            if (e.pointerType === 'mouse') {
              updateStarVisuals(groupEl, getSelected(), starNum);
            }
          });
        });

        groupEl.addEventListener('pointerleave', e => {
          if (e.pointerType === 'mouse') {
            updateStarVisuals(groupEl, getSelected(), 0);
          }
        });

        groupEl.querySelectorAll('input[type="radio"]').forEach(radio => {
          radio.addEventListener('change', () => {
            const val = Number(radio.value);
            const metricWrap = groupEl.closest('.star-metric');
            if (metricWrap) metricWrap.classList.remove('is-missing');
            updateStarVisuals(groupEl, val, 0);
            saveDraft();
          });
        });
      });

      updateCardMeta(card, item.position);
    }

    $('prevBtn').disabled = current === 0;
    $('saveNextBtn').textContent = current === 9 ? 'Save all 3 responses ✓' : 'Save all 3 & next →';
    updateBottomFeedback();
    $('finalActions').classList.toggle('hidden', Object.keys(ratings).length !== 30);
    window.scrollTo(0, 0);

    if (isOutOfScope) {
      if (lastOosPrompted !== current) {
        lastOosPrompted = current;
        openOosModal();
      }
    } else {
      lastOosPrompted = -1;
      closeOosModal();
    }
  }

  function changePage(index) {
    if (busy || index === current || index < 0 || index >= 10) return;
    saveDraft();
    if (
      changed() &&
      !confirm('Unsaved scores on this page will remain only on this device until you save. Continue?')
    ) {
      return;
    }
    current = index;
    render();
  }

  function readGroup() {
    saveDraft();
    document.querySelectorAll('.star-metric.is-missing').forEach(el => el.classList.remove('is-missing'));

    const results = [];
    for (let j = 0; j < questions[current].length; j++) {
      const item = questions[current][j];
      const d = drafts[item.position];
      for (const [key, label] of METRICS) {
        if (!Number.isInteger(d?.[key]) || d[key] < 1 || d[key] > 5) {
          const card = document.querySelector(`[data-position="${item.position}"]`);
          const missingWrap = card?.querySelector(`.star-metric[data-metric-wrap="${key}"]`);
          if (missingWrap) {
            missingWrap.classList.add('is-missing');
            missingWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const firstRadio = missingWrap.querySelector('input[type="radio"]');
            if (firstRadio) firstRadio.focus({ preventScroll: true });
          }
          throw Error(`Please rate ${label} for Model ${'ABC'[j]} (select 1–5 stars).`);
        }
      }
      results.push({ position: item.position, ...d });
    }
    return results;
  }

  async function resume() {
    if (!localStorage.getItem(TOKEN_KEY)) {
      show('register');
      return;
    }
    try {
      const s = await api('/api/session');
      session = s;
      ratings = Object.fromEntries(
        (s.ratings || []).map(r => {
          const norm = normalizeRating(r);
          return [norm.position, norm];
        })
      );
      drafts = {};
      if (s.submitted) {
        $('receiptId').textContent = s.participant_id;
        show('complete');
        return;
      }
      const nextIncomplete = questions.findIndex((_, i) => !groupDone(i));
      current = nextIncomplete === -1 ? 9 : nextIncomplete;
      show('evaluation');
      render();
    } catch (e) {
      if (e.message.includes('Session missing') || e.message.includes('invalid')) {
        localStorage.removeItem(TOKEN_KEY);
        show('register');
      } else {
        msg(e.message);
      }
    }
  }

  $('homeLink').addEventListener('click', e => {
    e.preventDefault();
    if (!$('evaluation').classList.contains('hidden')) {
      saveDraft();
      if (
        changed() &&
        !confirm('You have unsaved scores. Save all 3 responses before leaving, or continue and risk losing unsaved changes.')
      ) {
        return;
      }
    }
    show('landing');
  });

  document.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => show(b.dataset.goto))
  );

  $('openEvaluation').addEventListener('click', () => {
    if (questions.length !== 10) {
      show('setup');
      return;
    }
    resume();
  });

  $('registerForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const payload = {
      initials: f.get('initials'),
      full_name: f.get('full_name'),
      email: f.get('email'),
      affiliation: f.get('affiliation'),
      consent: f.get('consent') === 'on',
    };
    $('registerBtn').disabled = true;
    try {
      const s = await api('/api/session', 'POST', payload);
      localStorage.setItem(TOKEN_KEY, s.token);
      session = s;
      ratings = {};
      drafts = {};
      current = 0;
      show('evaluation');
      render();
    } catch (err) {
      msg(err.message);
    } finally {
      $('registerBtn').disabled = false;
    }
  });

  $('prevBtn').addEventListener('click', () => changePage(current - 1));

  $('saveNextBtn').addEventListener('click', async () => {
    if (busy) return;
    let rows;
    try {
      rows = readGroup();
    } catch (e) {
      msg(e.message);
      return;
    }

    busy = true;
    const b = $('saveNextBtn');
    b.disabled = true;
    $('saveFeedback').textContent = 'Saving to Cloudflare…';

    try {
      for (const row of rows) {
        const body = Object.fromEntries([
          ...METRICS.map(([m]) => [m, row[m]]),
          ['comment', row.comment || ''],
        ]);
        await api(`/api/ratings/${row.position}`, 'PUT', body);
        ratings[row.position] = normalizeRating({ position: row.position, ...body });
        delete drafts[row.position];
      }

      const savedQuestionNum = current + 1;
      if (current < 9) current++;
      busy = false;
      render();

      if (Object.keys(ratings).length === 30) {
        msg('All 30 responses saved. You may now submit your evaluation.');
      } else {
        msg(`Question ${savedQuestionNum} saved.`);
      }
    } catch (e) {
      $('saveFeedback').textContent = 'Could not save all responses';
      msg(e.message);
      render();
    } finally {
      busy = false;
      b.disabled = false;
    }
  });

  $('exitEval').addEventListener('click', () => {
    saveDraft();
    if (
      changed() &&
      !confirm('You have unsaved scores. Save all 3 responses before leaving, or continue and lose unsaved changes when the page closes.')
    ) {
      return;
    }
    show('landing');
  });

  $('submitBtn').addEventListener('click', async () => {
    if (Object.keys(ratings).length !== 30) {
      msg('Save all 30 ratings before submitting.');
      return;
    }
    if (!confirm('Submit all 30 evaluations? You cannot edit scores afterward.')) return;

    const b = $('submitBtn');
    b.disabled = true;
    try {
      const res = await api('/api/submit', 'POST');
      $('receiptId').textContent = res.participant_id;
      show('complete');
    } catch (e) {
      msg(e.message);
    } finally {
      b.disabled = false;
    }
  });

  $('oosModalClose').addEventListener('click', closeOosModal);
  $('oosModal').addEventListener('click', e => {
    if (e.target === $('oosModal')) closeOosModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('oosModal').classList.contains('hidden')) {
      closeOosModal();
    }
  });

  load();
})();
