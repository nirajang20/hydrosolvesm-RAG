const METRICS=['correctness','groundedness','completeness','relevance'];
const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply = (obj,status=200, extra={})=>new Response(JSON.stringify(obj),{status,headers:{...headers,...extra}});
function cors(req,env){
  const origin=req.headers.get('Origin');
  const expected=(env.ALLOWED_ORIGIN||'').replace(/\/$/,'');
  if(!origin || origin!==expected) return null;
  return {'Access-Control-Allow-Origin':expected,'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin'};
}
async function digest(raw){const bytes=new TextEncoder().encode(raw);const h=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('');}
const uuid=()=>crypto.randomUUID();
const limited=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';
async function body(req){if(Number(req.headers.get('content-length')||0)>12000)throw Error('Request too large');return req.json();}
async function getParticipant(req,env){
  const match=/^Bearer ([a-zA-Z0-9-]{30,150})$/.exec(req.headers.get('Authorization')||'');
  if(!match)return null;
  const hash=await digest(match[1]);
  return env.DB.prepare('SELECT id, initials, submitted_at FROM participants WHERE token_hash=?').bind(hash).first();
}
export default {async fetch(req,env){
  const c=cors(req,env);
  // CORS is not authentication, bearer session tokens still protect each record.
  if(req.method==='OPTIONS')return c?new Response(null,{status:204,headers:c}):new Response(null,{status:403});
  if(!c)return reply({error:'Origin not allowed'},403);
  const send=(o,s=200)=>reply(o,s,c);
  const url=new URL(req.url);
  try{
    if(url.pathname==='/api/health'&&req.method==='GET')return send({ok:true});
    if(url.pathname==='/api/session'&&req.method==='POST'){
      const data=await body(req);
      const initials=limited(data.initials,12), fullName=limited(data.full_name,120), email=limited(data.email,254),affiliation=limited(data.affiliation,200);
      if(!data.consent || !/^[\p{L}\p{N} ._-]{2,12}$/u.test(initials) || !fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)|| !affiliation)
        return send({error:'Fill all fields and acknowledge the privacy notice.'},400);
      const token=`${uuid()}-${uuid()}`, id=uuid(), hash=await digest(token);
      await env.DB.prepare('INSERT INTO participants(id,token_hash,initials,full_name,email,affiliation,consent_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id,hash,initials,fullName,email,affiliation,new Date().toISOString()).run();
      return send({token,participant_id:id,initials,submitted:false});
    }
    const person=await getParticipant(req,env);
    if(!person)return send({error:'Session missing or invalid. Start a new evaluation.'},401);
    if(url.pathname==='/api/session'&&req.method==='GET'){
      const rows=await env.DB.prepare('SELECT position,correctness,groundedness,completeness,relevance,comment FROM ratings WHERE participant_id=? ORDER BY position').bind(person.id).all();
      return send({participant_id:person.id,initials:person.initials,submitted:!!person.submitted_at,ratings:rows.results});
    }
    const ratingPath=/^\/api\/ratings\/(\d+)$/.exec(url.pathname);
    if(ratingPath&&req.method==='PUT'){
      if(person.submitted_at)return send({error:'This evaluation is already submitted.'},409);
      const position=Number(ratingPath[1]);
      if(!Number.isInteger(position)||position<1||position>30)return send({error:'Invalid response number.'},400);
      const data=await body(req);
      for(const m of METRICS)if(!Number.isInteger(data[m])||data[m]<1||data[m]>5)return send({error:`${m} must be a score from 1 to 5.`},400);
      const comment=limited(data.comment||'',3000);
      await env.DB.prepare(`INSERT INTO ratings(participant_id,position,correctness,groundedness,completeness,relevance,comment)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(participant_id,position) DO UPDATE SET
        correctness=excluded.correctness,groundedness=excluded.groundedness,completeness=excluded.completeness,
        relevance=excluded.relevance,comment=excluded.comment,updated_at=CURRENT_TIMESTAMP`)
        .bind(person.id,position,...METRICS.map(m=>data[m]),comment).run();
      return send({saved:true,position});
    }
    if(url.pathname==='/api/submit'&&req.method==='POST'){
      if(person.submitted_at)return send({submitted:true,participant_id:person.id});
      const result=await env.DB.prepare('SELECT COUNT(*) AS n FROM ratings WHERE participant_id=?').bind(person.id).first();
      if(result.n!==30)return send({error:`Complete all 30 responses before submitting (${result.n}/30 saved).`},400);
      await env.DB.prepare('UPDATE participants SET submitted_at=? WHERE id=? AND submitted_at IS NULL').bind(new Date().toISOString(),person.id).run();
      return send({submitted:true,participant_id:person.id});
    }
    return send({error:'Not found'},404);
  }catch(e){console.error(e);return send({error:'Request failed. Try again.'},500);}
}};
