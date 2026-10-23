// Schema-only baseline evidence. No rows, credentials, owners or ACL identities.
// Keep definitions exact: a similarly named but obsolete trigger is not proof.
export const schemaEvidenceSQL=`WITH evidence AS (
 SELECT 'column:'||c.relname||'.'||a.attname key,
   concat_ws('|',format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
     pg_get_expr(d.adbin,d.adrelid)) definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 UNION ALL SELECT 'constraint:'||c.relname||'.'||x.conname,pg_get_constraintdef(x.oid)
 FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND x.contype<>'n'
 UNION ALL SELECT 'index:'||c.relname,pg_get_indexdef(c.oid)||'|'||i.indisvalid||'|'||i.indisready
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
 UNION ALL SELECT 'function:'||p.oid::regprocedure::text,pg_get_functiondef(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' AND NOT EXISTS
   (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')
 UNION ALL SELECT 'trigger:'||c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid)||'|'||t.tgenabled::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL SELECT 'view:'||c.relname,pg_get_viewdef(c.oid)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v'
) SELECT key,md5(definition) fingerprint FROM evidence
WHERE key NOT LIKE '%pack1_applied_migrations%' ORDER BY key`;

export async function verifyBaselineSchema(query,expected) {
 const actual=new Map((await query(schemaEvidenceSQL)).rows.map(r=>[r.key,r.fingerprint]));
 const mismatches=Object.entries(expected).filter(([key,value])=>!(Array.isArray(value)?value:[value]).includes(actual.get(key)??null)).map(([key])=>key);
 if(!Object.keys(expected).length||mismatches.length)throw Error('Migration baseline schema mismatch: '+mismatches.slice(0,12).join(', '));
 // Extra triggers can invalidate even when every expected trigger is present.
 const extra=[...actual.keys()].filter(k=>k.startsWith('trigger:')&&!Object.hasOwn(expected,k));
 if(extra.length)throw Error('Unreviewed baseline triggers: '+extra.join(', '));
 return true;
}
