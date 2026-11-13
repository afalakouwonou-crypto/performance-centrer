// Faux client Supabase pour tester l'interface sans réseau (repris de wakabi-recette/tests_interface/stub_id.js).
// Ajouts du 2026-11-12 : codes d'erreur PostgREST réalistes (PGRST116 si aucune ligne avec single()),
// panne réseau simulée (S.netFail), erreurs d'insertion simulées (S.insertError), upsert journalisé et
// enregistré (S.delayMs pour tester le double clic).
(function(){
 const S=window.__S;  // scénario injecté
 const listeners=[];
 const later=(v)=>new Promise(r=>setTimeout(()=>r(v),S.delayMs||0));
 function q(table){
  const st={table,filters:[],single:false};
  const api={
   select(){return api},order(){return api},limit(){return api},
   eq(c,v){st.filters.push(r=>r[c]===v);return api},
   is(c,v){st.filters.push(r=>(r[c]??null)===v);return api},
   in(c,vals){st.filters.push(r=>vals.includes(r[c]));return api},
   single(){st.single=true;return api},
   insert(o){st.insert=o;return api},
   upsert(o,opts){S.log.push("upsert:"+table+":"+JSON.stringify(o));
     const t=S.tables[table]=S.tables[table]||[];const keys=((opts&&opts.onConflict)||"id").split(",");
     const i=t.findIndex(r=>keys.every(k=>r[k]===o[k]));if(i>=0)Object.assign(t[i],o);else t.push({id:"up"+t.length,...o});
     return later({error:null})},
   update(o){st.update=o;return api},
   then(res,rej){
     if((S.netFail||[]).includes(table))return Promise.resolve({data:null,error:{message:"TypeError: Failed to fetch",code:""}}).then(res,rej);
     if(st.insert){S.log.push("insert:"+table+":"+JSON.stringify(st.insert));
       if(S.insertError&&S.insertError[table])return later({data:null,error:S.insertError[table]}).then(res,rej);
       const arr=(Array.isArray(st.insert)?st.insert:[st.insert]).map(o=>({id:"new"+Math.random().toString(36).slice(2,7),revoked_at:null,status:"active",...o}));
       const t=S.tables[table]=S.tables[table]||[];
       if(arr.some(o=>o.name&&t.some(r=>r.name&&r.name.toLowerCase()===o.name.toLowerCase())))return Promise.resolve({data:null,error:{code:"23505",message:"duplicate key value violates unique constraint"}}).then(res,rej);
       if(table==="publications")arr.forEach(o=>{const f=S.tables.platforms.find(x=>x.code===o.platform);o.platform_id=f&&f.id});
       if(table==="metric_readings")arr.forEach(o=>{o.entered_at=new Date().toISOString();o.origin="direct"});
       t.push(...arr);return later({data:st.single?arr[0]:arr,error:null}).then(res,rej)}
     if(!st.update&&(!(table in S.tables)||(S.fail||[]).includes(table)))return Promise.resolve({data:null,error:{code:"42501",message:"permission denied for table "+table}}).then(res,rej);
     let rows=(S.tables[table]||[]).filter(r=>st.filters.every(f=>f(r)));
     if(st.update){S.log.push("update:"+table+":"+JSON.stringify(st.update));
       if(S.failUpdate&&table==="profiles")return Promise.resolve({data:null,error:{message:"Le dernier administrateur actif doit être conservé"}}).then(res,rej);
       rows.forEach(r=>Object.assign(r,st.update));}
     const out=st.single?{data:rows[0]||null,error:rows[0]?null:{code:"PGRST116",message:"JSON object requested, multiple (or no) rows returned"}}:{data:rows,error:null};
     return Promise.resolve(out).then(res,rej)}
  };return api}
 window.supabase={createClient(){return{
  from:q,
  rpc:async(fn,args)=>{S.log.push("rpc:"+fn+":"+JSON.stringify(args||{}));
    if(fn==="wakabi_session_status")return{data:S.status||"ok",error:null};
    if(fn==="wakabi_content_submit"){const c=S.tables.contents.find(x=>x.id===args.p_content);if(c)c.production_status="a_valider";return{data:"a_valider",error:null}}
    if(fn==="wakabi_username_suggestion"){const b=args.p_base;const taken=S.tables.profiles.map(p=>p.username);let t=b,i=1;while(taken.includes(t)){i++;t=b+i}return{data:t,error:null}}
    return{data:null,error:{message:"rpc inconnue"}}},
  storage:{from(b){return{
    upload:async(path,file)=>{S.log.push("upload:"+b+":"+path);return{data:{path},error:null}},
    createSignedUrl:async(path,sec)=>{S.log.push("signed:"+path);return{data:{signedUrl:"about:blank#"+encodeURIComponent(path)},error:null}}}}},
  functions:{invoke:async(name,{body})=>{S.log.push("fn:"+name+":"+JSON.stringify(body));const r=(S.fn&&S.fn(body,S))||{ok:true};return{data:r,error:null}}},
  auth:{
   setSession:async(t)=>{S.log.push("setSession:"+t.access_token.slice(0,10));S.session={user:{id:S.loginUser||"u"},access_token:t.access_token};
     setTimeout(()=>listeners.forEach(cb=>cb("SIGNED_IN",S.session)),0);return{data:{session:S.session},error:null}},
   getSession:async()=>({data:{session:S.session}}),
   onAuthStateChange(cb){listeners.push(cb);return{data:{subscription:{unsubscribe(){}}}}},
   signInWithPassword:async()=>({error:null}),
   signOut:async()=>{S.session=null;S.log.push("signOut");listeners.forEach(cb=>cb("SIGNED_OUT",null));return{error:null}},
   resetPasswordForEmail:async(e)=>{S.log.push("reset:"+e);return{error:null}},
   reauthenticate:async()=>{S.log.push("reauth");return{error:null}},
   updateUser:async(o)=>{S.log.push("updateUser:"+JSON.stringify(o));
     if(S.needNonce&&!o.nonce)return{data:{},error:{code:"reauthentication_needed",message:"Password update requires reauthentication"}};
     const p=S.tables.profiles.find(x=>x.id===S.session.user.id);p.must_change_password=false;  // simule le déclencheur
     setTimeout(()=>listeners.forEach(cb=>cb("USER_UPDATED",S.session)),0);
     return{data:{user:S.session.user},error:null}}
  }}}};
})();
